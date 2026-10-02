import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEngine } from '../src/lib/engine.js';
import { QuoteMaterialConfiguratorClient } from '../src/lib/quote-material-configurator.js';
const models=JSON.parse(fs.readFileSync(new URL('./fixtures/real-configit-models.json',import.meta.url),'utf8'));
function response(data){return {ok:true,status:200,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)};}
function materialClient(model){
 const fetchImpl=async (url,opts={})=>{
  const u=String(url); let b={}; try{b=JSON.parse(opts.body||'{}')}catch{}
  if(u.endsWith('/api/materialinfo')) return response([{materialDeliveringPlant:'PL02',isConfigurable:true,name:model}]);
  if(u.includes('getMaterialTemplateData')) return response({environment:{materialEnvironment:model==='BDS650N'?[{name:'BDS650N',environment:['Quantity']}]:[]}});
  if(u.includes('getFromExistingConfigurationWithStatus')) return response(models[model]);
  return {ok:false,status:599,json:async()=>({}),text:async()=>''};
 };
 return new QuoteMaterialConfiguratorClient({fetchImpl});
}
const productClient={searchProducts:async()=>{throw new Error('legacy path must not run')},searchFamily:async()=>[],resolveOrderCode:async()=>null,verifyStandardProduct:async()=>null};
for(const [input,model,family] of [
 ['BGP702 LED90/730 DX10P LGR 7035 SRG10 42','BGP702I','BGP702'],
 ['BDS670 LED50/730 MDA BK SRT SRG10 60P','BDS650N','BDS670'],
 ['BDS670 LED40/730 MDM BK SRT SRG10 60P','BDS650N','BDS670'],
]) test(`real Configit model pipeline: ${input}`,async()=>{
 const fn=createEngine({productClient,quoteProductDiscoveryClient:{discover:async()=>({mode:'HAR_REAL',candidates:[{id:model,evidence:'QUOTE_CONFIGURABLE_ITEM'}]})},quoteMaterialClient:materialClient(model),configuratorClient:{validateControlChange:async()=>({validated:false})}});
 const r=await fn(input);
 assert.equal(r.status,'VERIFIED_CONFIGURABLE_PRODUCT');
 assert.equal(r.recommended.family,family);
 assert.equal(r.recommended.configuratorId,model);
 assert.equal(r.configurators[0].unresolved.length,0);
 assert.match(r.recommended.description,/\bPSD\b/);
});
