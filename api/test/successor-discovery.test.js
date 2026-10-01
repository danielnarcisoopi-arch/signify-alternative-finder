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

test("discovers a unique technical successor when the legacy family has left the current catalogue", async () => {
  const current = product("DN610B 40S/TW927-965 DIA-E C WH PGO", "LuxSpace Compact, recessed", "LP_CF_DN610B_EU");
  const unrelated = product("RS771B 40S/TW927-965 DIA-E C WH PGO", "GreenSpace recessed", "LP_CF_RS771B_EU");
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
    { code: "DN571B", name: "", raw: null },
  );
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "DN610B");
  assert.equal(result.evidence.discoveryMode, "UNIQUE_TECHNICAL_SIGNATURE");
});

test("can use repeated enriched-facet evidence for a configurator-only current family", async () => {
  const client = {
    searchProducts: async () => ({ products: [], families: [] }),
    searchFacets: async ({ query }) => ({
      products: [],
      families: [{
        code: "DN610B",
        name: "LuxSpace Compact, recessed",
        configuratorId: "DN610BI",
        source: { query },
      }],
    }),
  };
  const result = await discoverSuccessorFamilies(
    client,
    parseReference("DN571B LED40S/930H PSU-E C WH PGO"),
    { code: "DN571B", name: "", raw: null },
  );
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "DN610B");
  assert.equal(result.candidate.products.length, 0);
  assert.ok(result.evidence.queryEvidence >= 2);
});

test("prioritizes a configurable successor returned for the complete original reference", async () => {
  const parsed = parseReference("ZX100B LED40S/930H PSU-E C WH PGO");
  const calls = [];
  const current = createProduct({
    displayed_order_code_description: { value: "ZX200B 20S/840UE PSU-E C WH PGO" },
    family_id: { value: "LP_CF_ZX200B_EU" },
    family_name: { value: "ExampleSpace Compact, recessed" },
    configurator_id: { value: "ZX200BI" },
  }, { query: parsed.input });
  const client = {
    searchProducts: async ({ query }) => {
      calls.push(query);
      return query === parsed.input ? { products: [current], families: [] } : { products: [], families: [] };
    },
    searchFacets: async ({ query }) => ({
      products: [],
      families: query === parsed.input ? [{
        code: "ZX200B",
        name: "ExampleSpace Compact, recessed",
        configuratorId: "ZX200BI",
        source: { query },
      }] : [],
    }),
  };
  const result = await discoverSuccessorFamilies(client, parsed, { code: "ZX100B", name: "", raw: null });
  assert.equal(calls[0], parsed.input);
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "ZX200B");
  assert.equal(result.candidate.family.configuratorId, "ZX200BI");
  assert.equal(result.evidence.exactInputEvidence, true);
});

test("a unique exact-reference configurable family wins over ambiguous relaxed-search candidates", async () => {
  const parsed = parseReference("ZX500B 20S/840 PSU-E WR WH PCO");
  const direct = createProduct({
    displayed_order_code_description: { value: "ZX610B 20S/840UE PSU-E WR WH PCO" },
    family_id: { value: "LP_CF_ZX610B_EU" },
    family_name: { value: "ExampleSpace Compact recessed" },
    configurator_id: { value: "ZX610BI" },
  }, { query: parsed.input });
  const distractor = createProduct({
    displayed_order_code_description: { value: "ZX572B 20S/840 PSD-E WR WH PCO" },
    family_id: { value: "LP_CF_ZX572B_EU" },
    family_name: { value: "ExampleSpace recessed" },
    configurator_id: { value: "ZX572BI" },
  }, { query: "20S 840 WR WH PCO DALI" });
  const client = {
    searchProducts: async ({ query }) => query === parsed.input
      ? { products: [direct], families: [] }
      : { products: [distractor], families: [] },
    searchFacets: async ({ query }) => ({
      products: [],
      families: query === parsed.input ? [{
        code: "ZX610B", name: "ExampleSpace Compact recessed", configuratorId: "ZX610BI", source: { query },
      }] : [{
        code: "ZX572B", name: "ExampleSpace recessed", configuratorId: "ZX572BI", source: { query },
      }],
    }),
  };
  const result = await discoverSuccessorFamilies(client, parsed, { code: "ZX500B", name: "", raw: null });
  assert.equal(result.validated, true);
  assert.equal(result.candidate.code, "ZX610B");
  assert.equal(result.candidate.family.configuratorId, "ZX610BI");
  assert.equal(result.evidence.exactInputEvidence, true);
});
