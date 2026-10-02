import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../src/lib/engine.js";
import { createProduct } from "../src/lib/product-api.js";
import { parseReference } from "../src/lib/normalization.js";

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
      description: "DN610B 40S/930UE PSD-E C WH PGO",
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
  assert.equal(result.recommended.description, "DN610B 40S/930UE PSD-E C WH PGO");
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

test("returns the exact configurator failure stage for live diagnostics", async () => {
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
  const engine = createEngine({
    productClient,
    configuratorClient: {
      validateControlChange: async () => ({
        validated: false,
        reason: "TARGET_CONTROL_NOT_SELECTABLE",
        httpStatus: null,
      }),
    },
  });
  const result = await engine("DN500B 20S/840 PSU-E WR WH PCO");
  assert.equal(result.status, "NO_VERIFIED_ALTERNATIVE");
  assert.equal(result.configurators[0].id, "DN500BI");
  assert.equal(result.configurators[0].reason, "TARGET_CONTROL_NOT_SELECTABLE");
});

for (const regression of [
  {
    input: "WT120C G3 60S/840 PSU L1200",
    output: "WT120C G3 60S/840 PSD L1200",
    orderCode: "911401838588",
  },
  {
    input: "BY120P G6 LED150/UE840 PSU WB",
    output: "BY120P G6 LED150/840 PSD WB",
    orderCode: "911401554345",
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

test("carries current-family efficiency metadata into successor configuration without family hardcodes", async () => {
  const parsedCarrier = parseReference("ZX200B 20S/840UE PSU-E C WH PGO");
  const carrier = {
    description: "ZX200B 20S/840UE PSU-E C WH PGO",
    orderCode: "",
    is12nc: false,
    family: "ZX200B",
    familyIds: [],
    familyName: "ExampleSpace Compact",
    configuratorId: "ZX200BI",
    configuratorSeed: { configId: "seed", existingAssignments: [{ variableName: "driver", valueName: "PSU-E" }] },
    parsed: parsedCarrier,
    controlClass: "ON_OFF",
    source: { query: "ZX100B LED40S/930H PSU-E C WH PGO" },
  };
  const productClient = {
    searchProducts: async ({ query }) => query === "ZX100B LED40S/930H PSU-E C WH PGO"
      ? { products: [carrier], families: [] }
      : { products: [], families: [] },
    searchFacets: async ({ query }) => ({
      products: [],
      families: query === "ZX100B LED40S/930H PSU-E C WH PGO" ? [{
        code: "ZX200B", name: "ExampleSpace Compact", configuratorId: "ZX200BI", source: { query },
      }] : [],
    }),
    resolveFamilyMetadata: async () => ({ code: "ZX100B", name: "", raw: null }),
    verifyStandardProduct: async () => null,
  };
  let receivedRequirements = null;
  const configuratorClient = {
    validateControlChange: async ({ configuratorId, requirements }) => {
      receivedRequirements = requirements;
      return {
        validated: true,
        description: "ZX200B 40S/930UE PSD-E C WH PGO",
        orderCode: "",
        configuratorId,
        configId: "configured",
      };
    },
  };
  const engine = createEngine({ productClient, configuratorClient });
  const result = await engine("ZX100B LED40S/930H PSU-E C WH PGO");
  assert.equal(receivedRequirements.efficiency, "UE");
  assert.equal(result.recommended.configuratorId, "ZX200BI");
  assert.equal(result.recommended.description, "ZX200B 40S/930UE PSD-E C WH PGO");
});

test("surfaces a current-family configuration when the official successor is known but configurator session returns 500", async () => {
  const carrier = createProduct({
    displayed_order_code_description: { value: "DN610B 20S/840UE PSU-E C WH PGO" },
    configuratorId: "DN610BI",
    filter_keys: { value: ["FK_LP_DIMMING_CONTROLS_NO"] },
    family_id: { value: "LP_CF_DN610B_EU" },
  }, { query: "DN571B LED40S/930H PSU-E C WH PGO" });
  const productClient = {
    searchProducts: async ({ query }) => ({ products: query === "DN571B LED40S/930H PSU-E C WH PGO" ? [carrier] : [], families: [] }),
    searchFacets: async () => ({ products: [], families: [] }),
    resolveFamilyMetadata: async () => null,
    searchFamily: async () => [],
    resolveOrderCode: async () => null,
    verifyStandardProduct: async () => null,
  };
  const configuratorClient = {
    validateControlChange: async () => ({
      validated: false,
      reason: "CONFIGURATOR_SESSION_NOT_AVAILABLE",
      errorCode: "HTTP_ERROR",
      httpStatus: 500,
    }),
  };
  const engine = createEngine({ productClient, configuratorClient });
  const result = await engine("DN571B LED40S/930H PSU-E C WH PGO");
  assert.equal(result.status, "CURRENT_FAMILY_CONFIGURATION_IDENTIFIED");
  assert.equal(result.recommended.configuratorId, "DN610BI");
  assert.equal(result.recommended.description, "DN610B 40S/930UE PSD-E C WH PGO");
  assert.equal(result.validation.verified, false);
  assert.equal(result.configurators.length, 1);
  assert.equal(result.configurators[0].httpStatus, 500);
});

test('unknown outdoor control defaults the requested alternative to DALI, not UNKNOWN', async()=>{
 const productClient={searchProducts:async()=>({products:[],families:[]}),searchFamily:async()=>[],verifyStandardProduct:async()=>null};
 const quoteProductDiscoveryClient={discover:async()=>({candidates:[{id:'BGP702I'}],diagnostics:[]})};
 const quoteMaterialClient={validate:async({model,parsed,targetControlClass})=>({validated:true,familyProven:true,unresolved:[],applied:[{role:'FAMILY',value:'BGP702'},{role:'FLUX',value:'LED90'},{role:'COLOR',value:'730'}],selectedControl:'PSD',complete:true})};
 const fn=createEngine({productClient,quoteProductDiscoveryClient,quoteMaterialClient,configuratorClient:{validateControlChange:async()=>({validated:false})}});
 const r=await fn('BGP702 LED90/730 DX10P LGR 7035 SRG10 42'); assert.equal(r.status,'VERIFIED_CONFIGURABLE_PRODUCT'); assert.equal(r.recommended.configuratorId,'BGP702I');
});

test('site pipeline never replaces a discovered current-family Configit model with a successor', async () => {
  let successorCalls = 0;
  const productClient = {
    searchProducts: async () => ({ products: [], families: [] }),
    searchFamily: async () => [], resolveOrderCode: async () => null, verifyStandardProduct: async () => null,
    resolveFamilyMetadata: async () => null,
    searchFacets: async () => { successorCalls++; return {products:[],families:[{code:'BDS492',name:'wrong successor',configuratorId:'BDS490I'}]}; },
  };
  const quoteProductDiscoveryClient = { discover: async () => ({mode:'PROGRESSIVE_PREFIX',candidates:[{id:'BDS650N',evidence:'QUOTE_CONFIGURABLE_ITEM'}]}) };
  const quoteMaterialClient = { validate: async () => { const e=new Error('blocked'); e.code='HTTP_ERROR'; e.details={status:403}; throw e; } };
  const engine = createEngine({ productClient, configuratorClient:noConfigurator, quoteProductDiscoveryClient, quoteMaterialClient });
  const result = await engine('BDS670 LED50/730 MDA BK SRT SRG10 60P');
  assert.equal(result.status,'NO_VERIFIED_ALTERNATIVE');
  assert.equal(result.configurators[0].id,'BDS650N');
  assert.equal(result.currentFamily, undefined);
  assert.equal(successorCalls,0);
});

for (const c of [
  ['BGP702 LED90/730 DX10P LGR 7035 SRG10 42','BGP702I','BGP702','PSD'],
  ['BVP656 LED400-4S/730 PSU II A35-MB GR','BVP656I','BVP656','PSD'],
  ['BDS670 LED50/730 MDA BK SRT SRG10 60P','BDS650N','BDS670','PSD'],
  ['BDS670 LED40/730 MDM BK SRT SRG10 60P','BDS650N','BDS670','PSD'],
]) {
  test(`full site engine returns current-family Configit result for ${c[0]}`, async () => {
    const [input,model,family,control]=c;
    const productClient={searchProducts:async()=>({products:[],families:[]}),searchFamily:async()=>[],resolveOrderCode:async()=>null,verifyStandardProduct:async()=>null,resolveFamilyMetadata:async()=>null};
    const quoteProductDiscoveryClient={discover:async()=>({mode:'TEST',candidates:[{id:model,evidence:'QUOTE_CONFIGURABLE_ITEM'}]})};
    const parsed=parseReference(input);
    const applied=[{role:'FAMILY',value:family},{role:'FLUX',value:parsed.package},{role:'COLOR',value:parsed.colorCode},...(parsed.features||[]).map(value=>({role:'FEATURE',value}))];
    const quoteMaterialClient={validate:async({model:m})=>({validated:true,familyProven:true,unresolved:[],applied,selectedControl:control,complete:true,model:m})};
    const engine=createEngine({productClient,configuratorClient:noConfigurator,quoteProductDiscoveryClient,quoteMaterialClient});
    const result=await engine(input);
    assert.equal(result.status,'VERIFIED_CONFIGURABLE_PRODUCT');
    assert.equal(result.recommended.configuratorId,model);
    assert.equal(result.recommended.family,family);
    assert.match(result.recommended.description,new RegExp(`^${family}\\b`));
    assert.match(result.recommended.description,/PSD/);
  });
}
