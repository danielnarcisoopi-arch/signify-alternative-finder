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


test("finds a successor through relaxed API queries instead of a preloaded answer", async () => {
  const current = product("ZX220B 40S/930UE PSD-E C WH PGO", "ExampleSpace Compact recessed", "LP_CF_ZX220B_EU");
  const calls = [];
  const client = {
    searchProducts: async ({ query }) => { calls.push(query); const q=String(query).toUpperCase(); const hit=q.includes("40S")&&q.includes("930")&&q.includes("C")&&q.includes("WH")&&!q.includes("930H"); return {products:hit?[current]:[],families:[]}; },
    searchFacets: async ({ query }) => { const q=String(query).toUpperCase(); const hit=q.includes("40S")&&q.includes("930")&&!q.includes("930H"); return {products:[],families:hit?[{code:"ZX220B",name:"ExampleSpace Compact recessed",configuratorId:"ZX220BI",source:{query}}]:[]}; },
  };
  const result = await discoverSuccessorFamilies(client, parseReference("ZX100B LED40S/930H PSU-E C WH PGO"), {code:"ZX100B",name:"ExampleSpace recessed",raw:{}});
  assert.equal(result.validated,true); assert.equal(result.candidate.code,"ZX220B"); assert.equal(result.candidate.family.configuratorId,"ZX220BI");
  assert.ok(calls.some((query)=>query.includes("40S 930")));
});
