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

test("returns a configurable-only product in a dynamically discovered successor family", async () => {
  const productClient = {
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
    resolveFamilyMetadata: async () => null,
    searchFamily: async () => [],
    resolveOrderCode: async () => null,
    verifyStandardProduct: async () => null,
  };
  const configuratorClient = {
    validateControlChange: async ({ configuratorId, requirements }) => ({
      validated: true,
      description: "DN610B 40S/TW927-965 DIA-E C WH PGO",
      orderCode: "",
      configuratorId,
      configId: "official-session",
      appliedRequirements: requirements.features,
    }),
  };
  const engine = createEngine({ productClient, configuratorClient });
  const result = await engine("DN571B LED40S/930H PSU-E C WH PGO");
  assert.equal(result.status, "VERIFIED_CONFIGURABLE_PRODUCT");
  assert.equal(result.currentFamily, "DN610B");
  assert.equal(result.recommended.configuratorId, "DN610BI");
  assert.equal(result.recommended.orderCode, null);
  assert.equal(result.familyMigration.oldFamily, "DN571B");
  assert.equal(result.familyMigration.currentFamily, "DN610B");
  assert.equal(result.recommended.description, "DN610B 40S/TW927-965 DIA-E C WH PGO");
  assert.equal(result.familyMigration.discoveryMode, "UNIQUE_TECHNICAL_SIGNATURE");
});

test("uses a same-family configurator id supplied by official family metadata", async () => {
  const productClient = {
    searchProducts: async () => ({ products: [], families: [] }),
    searchFamily: async () => [],
    resolveOrderCode: async () => null,
    verifyStandardProduct: async () => null,
    resolveFamilyMetadata: async () => ({
      code: "DN500B",
      name: "CoreLine Downlight",
      configuratorId: "DN500BI",
      raw: {},
    }),
  };
  const configuratorClient = {
    validateControlChange: async ({ configuratorId }) => ({
      validated: true,
      description: "DN500B 20S/840 DIA-E WR WH PCO",
      orderCode: "",
      configuratorId,
      configId: "official-session",
    }),
  };
  const engine = createEngine({ productClient, configuratorClient });
  const result = await engine("DN500B 20S/840 PSU-E WR WH PCO");
  assert.equal(result.status, "VERIFIED_CONFIGURABLE_PRODUCT");
  assert.equal(result.currentFamily, "DN500B");
  assert.equal(result.recommended.configuratorId, "DN500BI");
  assert.equal(result.recommended.orderCode, null);
  assert.equal(result.recommended.description, "DN500B 20S/840 DIA-E WR WH PCO");
});

for (const regression of [
  {
    input: "WT120C G3 60S/840 PSU L1200",
    output: "WT120C G3 60S/840 PSD L1200",
    orderCode: "911401838588",
  },
  {
    input: "BY120P G6 LED150/UE840 PSU WB",
    output: "BY120P G6 LED150/UE840 PSD WB",
    orderCode: "911401899999",
  },
]) {
  test(`preserves the verified same-family path for ${regression.input.split(" ")[0]}`, async () => {
    const original = apiProduct(regression.input, "910500000001", "FK_LP_DIMMING_CONTROLS_NO");
    const candidate = apiProduct(regression.output, regression.orderCode, "FK_LP_DIMMING_CONTROLS_DALI");
    const productClient = {
      searchProducts: async ({ controlClass }) => ({ products: controlClass === "DALI" ? [candidate] : [original] }),
      searchFamily: async () => [candidate],
      resolveOrderCode: async (code) => code === candidate.orderCode ? candidate : null,
      verifyStandardProduct: async (product) => product.orderCode === candidate.orderCode ? candidate : null,
    };
    const engine = createEngine({ productClient, configuratorClient: noConfigurator });
    const result = await engine(regression.input);
    assert.equal(result.status, "DIRECT_VERIFIED_MATCH");
    assert.equal(result.recommended.orderCode, regression.orderCode);
  });
}
