import test from "node:test";
import assert from "node:assert/strict";
import { ProductApiClient, ProductApiError, createProduct, familyCodeFromId } from "../src/lib/product-api.js";

test("rejects an empty Product API response with a structured error", async () => {
  const client = new ProductApiClient({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "" }),
  });
  await assert.rejects(() => client.searchProducts({ query: "DN142B" }), (error) => {
    assert.ok(error instanceof ProductApiError);
    assert.equal(error.code, "EMPTY_RESPONSE");
    return true;
  });
});

test("paginates catalogue results", async () => {
  const pages = [];
  const client = new ProductApiClient({
    maxPages: 3,
    fetchImpl: async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      pages.push(page);
      const rows = page === 1
        ? [
            { displayed_order_code_description: { value: "DN142B 10S/840 PSD-E WR IP54" }, sku: { value: "910505103591" } },
            { displayed_order_code_description: { value: "DN142B 20S/840 PSD-E WR IP54" }, sku: { value: "910505103592" } },
          ]
        : [{ displayed_order_code_description: { value: "DN142B 30S/840 PSD-E WR IP54" }, sku: { value: "910505103593" } }];
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: rows, total: 3 }) };
    },
  });
  const result = await client.searchProducts({ query: "DN142B", size: 2 });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.products.length, 3);
});

test("extracts family metadata and the official configurator id from enriched facets", async () => {
  const client = new ProductApiClient({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        dataEnrichment: {
          familyData: {
            results: [{
              family_id: { value: "LP_CF_DN610B_EU" },
              family_name: { value: "LuxSpace Compact, recessed" },
              configurator_id: { value: "DN610BI" },
            }],
          },
        },
      }),
    }),
  });
  const result = await client.searchFacets({ query: "LuxSpace 40S 930 DALI" });
  assert.equal(result.families[0].code, "DN610B");
  assert.equal(result.families[0].configuratorId, "DN610BI");
  assert.equal(familyCodeFromId("LP_CF_WT120C_EU"), "WT120C");
});

test("reads current family and configurator from a Quote-style configurable search result", () => {
  const product = createProduct({
    name: "000910500000001",
    description: "ZX610B 20S/840UE PSU-E C WH PGO",
    materialName: "ZX610BI",
    productModelName: "ZX610BI_ZX610BI",
    isConfigurable: true,
    assignments: [
      { variableName: "PLM_PFC", valueName: "ZX610B" },
      { variableName: "PLM_TRAFO", valueName: "PSU-E" },
    ],
  }, { query: "ZX500B 20S/840 PSU-E WR WH PCO", controlClass: "DALI" });

  assert.equal(product.description, "ZX610B 20S/840UE PSU-E C WH PGO");
  assert.equal(product.family, "ZX610B");
  assert.equal(product.configuratorId, "ZX610BI");
  assert.equal(product.controlClass, "ON_OFF");
});
