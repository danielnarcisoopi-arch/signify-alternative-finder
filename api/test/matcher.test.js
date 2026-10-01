import test from "node:test";
import assert from "node:assert/strict";
import { assessCandidate, rankCandidates } from "../src/lib/matcher.js";
import { parseReference } from "../src/lib/normalization.js";
import { createProduct } from "../src/lib/product-api.js";

function product(description, sku, controlKey) {
  return createProduct({
    displayed_order_code_description: { value: description },
    sku: { value: sku },
    filter_keys: { value: [controlKey] },
    family_id: { value: `LP_CF_${parseReference(description).family}_EU` },
  });
}

test("classifies a like-for-like control change as direct", () => {
  const input = parseReference("DN142B 10S/840 PSU-E WR IP54");
  const candidate = product("DN142B 10S/840 PSD-E WR IP54", "910505103591", "FK_LP_DIMMING_CONTROLS_DALI");
  const result = assessCandidate(input, candidate, { verified: true });
  assert.equal(result.safeToRecommend, true);
  assert.equal(result.resultType, "DIRECT_VERIFIED_MATCH");
});

test("missing values never create a false exact match", () => {
  const input = parseReference("WT120C G3 60S/840 PSU L1200");
  const candidate = product("WT120C PSD", "911401800000", "FK_LP_DIMMING_CONTROLS_DALI");
  const result = assessCandidate(input, candidate, { verified: true });
  assert.equal(result.safeToRecommend, false);
  assert.ok(result.blockers.some((item) => item.includes("Geração")));
  assert.notEqual(result.resultType, "DIRECT_VERIFIED_MATCH");
});

test("allows a clearly reported closest lumen-package match", () => {
  const input = parseReference("WT490C 62S/840 PSU NE WB PI5 L1800");
  const candidate = product("WT490C 80S/840 PSD HE WB PI5 L1800", "910925867735", "FK_LP_DIMMING_CONTROLS_DALI");
  const result = assessCandidate(input, candidate, { verified: true });
  assert.equal(result.safeToRecommend, true);
  assert.equal(result.resultType, "CLOSEST_VERIFIED_TECHNICAL_MATCH");
  assert.ok(result.changes.some((change) => change.field === "Pacote luminoso"));
  assert.ok(result.changes.some((change) => change.field === "Designação de eficiência"));
});

test("ranks an exact 60S package above a 40S package", () => {
  const input = parseReference("WT120C G3 60S/840 PSU L1200");
  const exact = product("WT120C G3 60S/840 PSD L1200", "911401838588", "FK_LP_DIMMING_CONTROLS_DALI");
  const worse = product("WT120C G3 40S/840 PSD L1200", "911401838500", "FK_LP_DIMMING_CONTROLS_DALI");
  const ranked = rankCandidates(input, [worse, exact], { verified: true });
  assert.equal(ranked[0].candidate.orderCode, "911401838588");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("supports the inverse DALI to On/Off direction", () => {
  const input = parseReference("DN142B 10S/840 PSD-E WR IP54");
  const candidate = product("DN142B 10S/840 PSU-E WR IP54", "910505103592", "FK_LP_DIMMING_CONTROLS_NO");
  const result = assessCandidate(input, candidate, { verified: true });
  assert.equal(input.targetControlClass, "ON_OFF");
  assert.equal(result.safeToRecommend, true);
});

test("accepts a current tunable-white range that covers the requested CRI and CCT", () => {
  const input = parseReference("DN571B LED40S/930H PSU-E C WH PGO");
  const candidate = product("DN610B 40S/TW927-965 DIA-E C WH PGO", "", "FK_LP_DIMMING_CONTROLS_DALI");
  const result = assessCandidate(input, candidate, { verified: true, requires12nc: false, allowFamilyChange: true });
  assert.equal(result.safeToRecommend, true);
  assert.ok(result.changes.some((change) => change.field === "CRI/CCT" && change.to === "TW927-965"));
});
