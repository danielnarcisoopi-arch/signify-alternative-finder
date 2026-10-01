import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../src/lib/engine.js";
import { createProduct } from "../src/lib/product-api.js";

function apiProduct(description, sku, controlKey) {
  return createProduct({
    displayed_order_code_description: { value: description },
    sku: { value: sku },
    filter_keys: { value: [controlKey] },
    family_id: { value: `LP_CF_${description.split(" ")[0]}_EU` },
  });
}

const noConfigurator = { validateControlChange: async () => ({ validated: false, reason: "NO_SESSION" }) };

test("does not guess a successor family for an unverified old family", async () => {
  const productClient = {
    searchProducts: async () => ({ products: [] }),
    searchFamily: async () => [],
    resolveOrderCode: async () => null,
    verifyStandardProduct: async () => null,
  };
  const engine = createEngine({ productClient, configuratorClient: noConfigurator });
  const result = await engine("DN571B LED40S/930H PSU-E C WH PGO");
  assert.equal(result.status, "NO_VERIFIED_ALTERNATIVE");
  assert.equal(result.reason, "ORIGINAL_FAMILY_NOT_VERIFIED");
  assert.equal(result.currentFamily, undefined);
});

test("returns a same-family product only after exact-code verification", async () => {
  const original = apiProduct("DN142B 10S/840 PSU-E WR IP54", "910500000001", "FK_LP_DIMMING_CONTROLS_NO");
  const candidate = apiProduct("DN142B 10S/840 PSD-E WR IP54", "910505103591", "FK_LP_DIMMING_CONTROLS_DALI");
  const productClient = {
    searchProducts: async ({ controlClass }) => ({ products: controlClass === "DALI" ? [candidate] : [original] }),
    searchFamily: async () => [candidate],
    resolveOrderCode: async (code) => code === candidate.orderCode ? candidate : null,
    verifyStandardProduct: async (product) => product.orderCode === candidate.orderCode ? candidate : null,
  };
  const engine = createEngine({ productClient, configuratorClient: noConfigurator });
  const result = await engine("DN142B 10S/840 PSU-E WR IP54");
  assert.equal(result.status, "DIRECT_VERIFIED_MATCH");
  assert.equal(result.recommended.orderCode, "910505103591");
  assert.equal(result.validation.verified, true);
});

