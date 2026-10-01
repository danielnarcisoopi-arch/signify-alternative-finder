import test from "node:test";
import assert from "node:assert/strict";
import { createProduct } from "../src/lib/product-api.js";
import { parseReference } from "../src/lib/normalization.js";
import { discoverSuccessorFamilies } from "../src/lib/successor-discovery.js";

function product(description, familyName, familyId) {
  return createProduct({
    displayed_order_code_description: { value: description },
    filter_keys: { value: ["FK_LP_DIMMING_CONTROLS_DALI"] },
    family_id: { value: familyId },
    family_name: { value: familyName },
  });
}

test("discovers a current family from official name and technical continuity without a fixed map", async () => {
  const current = product("DN610B 40S/930 PSD-E C WH PGO", "LuxSpace Compact, recessed", "LP_CF_DN610B_EU");
  const unrelated = product("RS771B 40S/930 PSD-E C WH PGO", "GreenSpace recessed", "LP_CF_RS771B_EU");
  const client = {
    searchProducts: async () => ({ products: [unrelated, current], families: [] }),
    searchFacets: async () => ({
      products: [],
      families: [
        { code: "RS771B", name: "GreenSpace recessed", configuratorId: "RS-CONFIG" },
        { code: "DN610B", name: "LuxSpace Compact, recessed", configuratorId: "DN610BI" },
      ],
    }),
  };
  const result = await discoverSuccessorFamilies(
    client,
    parseReference("DN571B LED40S/930H PSU-E C WH PGO"),
    { code: "DN571B", name: "LuxSpace, recessed", raw: {} },
  );
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "DN610B");
  assert.equal(result.candidate.family.configuratorId, "DN610BI");
  assert.equal(result.evidence.explicitSuccessor, false);
});

test("the same discovery logic works for unknown family codes", async () => {
  const current = product("AB250C 20S/840 PSD WB", "ExampleLine Compact recessed", "LP_CF_AB250C_EU");
  const client = {
    searchProducts: async () => ({ products: [current], families: [] }),
    searchFacets: async () => ({
      products: [],
      families: [{ code: "AB250C", name: "ExampleLine Compact recessed", configuratorId: "AB-CONFIG" }],
    }),
  };
  const result = await discoverSuccessorFamilies(
    client,
    parseReference("AB100C 20S/840 PSU WB"),
    { code: "AB100C", name: "ExampleLine recessed", raw: {} },
  );
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "AB250C");
});
