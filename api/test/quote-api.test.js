import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteApiClient } from '../src/lib/quote-api.js';

function response(body, status=200){ return { ok:status>=200&&status<300, status, async text(){return JSON.stringify(body);} }; }
function seed({description='DN610B 20S/840UE PSU-E C WH PGO', driver='PSU-E', materialName='DN610BI', name='000910505104694'}={}) { return {name, materialName, productModelName:`${materialName}_${materialName}`, description, isConfigurable:true, assignments:[
 {variableName:'PLM_TRAFO',valueName:driver},{variableName:'PLM_PFAM',valueName:description.split(' ')[0]},{variableName:'PLM_PFC',valueName:description.split(' ')[0]},
 {variableName:'PLM_LAMPFAM',valueName:(description.match(/(?:LED)?(\d+S)/)||[])[1]||'20S'}, {variableName:'PLM_COLLAMP',valueName:(description.match(/\/(\d{3})/)||[])[1]||'840'},
 {variableName:'PLM_LED_BOARD_TYPE',valueName:'UE'},{variableName:'PLM_OPTGRP',valueName:'C'},{variableName:'PLM_CLR',valueName:'WH'},{variableName:'PLM_CVR',valueName:'PGO'} ]}; }
function validFromPayload(payload){ const a=payload.rootConfiguration.existingAssignments.map(x=>({...x,isUserAssignment:true})); const val=n=>a.find(x=>x.variableName===n)?.valueName||''; const code=`${val('PLM_PFC')} ${val('PLM_LAMPFAM')}/${val('PLM_COLLAMP')}${val('PLM_LED_BOARD_TYPE')} ${val('PLM_TRAFO')} ${val('PLM_OPTGRP')} ${val('PLM_CLR')} ${val('PLM_CVR')}`; return {materialBomConfiguration:{root:{configuration:{valid:true,complete:true,hasConflict:false,newAssignments:[...a.map(x=>({...x,isUserAssignment:true})),{variableName:'CATALOGCODE1',valueName:code}]}}},bomStatus:{configurationStatus:{valid:true,complete:true,hasConflict:false}}}; }

test('discovers DN610BI from Product API data and validates legacy DN571B -> DALI without family hardcode', async()=>{
 const calls=[]; const client=new QuoteApiClient({fetchImpl:async(url,opt={})=>{calls.push([String(url),opt]); if(String(url).includes('/products/search')) return response({items:[seed()]}); const p=JSON.parse(opt.body); return response(validFromPayload(p));}});
 const r=await client.findAlternative('DN571B LED40S/930H PSU-E C WH PGO');
 assert.equal(r.configuratorId,'DN610BI'); assert.equal(r.description,'DN610B 40S/930UE PSD-E C WH PGO');
 const validations=calls.filter(c=>c[0].includes('getFromExisting')); assert.equal(validations.length,2); const first=JSON.parse(validations[0][1].body); const second=JSON.parse(validations[1][1].body); assert.equal(first.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_TRAFO').valueName,'PSU-E'); assert.equal(second.rootConfiguration.configurableMaterialName,'DN610BI'); assert.equal(second.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_TRAFO').valueName,'PSD-E');
});

test('inverse current configurable DALI -> PSU uses same generic flow', async()=>{
 const client=new QuoteApiClient({fetchImpl:async(url,opt={})=>String(url).includes('/products/search')?response({items:[seed({description:'DN610B 40S/930UE PSD-E C WH PGO',driver:'PSD-E'})]}):response(validFromPayload(JSON.parse(opt.body)))});
 const r=await client.findAlternative('DN610B 40S/930UE PSD-E C WH PGO'); assert.equal(r.description,'DN610B 40S/930UE PSU-E C WH PGO');
});

test('SM350C DALI description and embedded 12NC resolve dynamically to SM350CI PSU', async()=>{
 const sm=seed({description:'SM350C 50S/840 PSD PCS L1500 WH',driver:'PSD',materialName:'SM350CI',name:'910925868386'}); sm.assignments=[{variableName:'PLM_TRAFO',valueName:'PSD'},{variableName:'PLM_PFC',valueName:'SM350C'},{variableName:'PLM_PFAM',valueName:'SM350C'},{variableName:'PLM_LAMPFAM',valueName:'50S'},{variableName:'PLM_COLLAMP',valueName:'840'},{variableName:'PLM_OPTGRP',valueName:'PCS'},{variableName:'PLM_LENGTH',valueName:'L1500'},{variableName:'PLM_CLR',valueName:'WH'}];
 const fetchImpl=async(url,opt={})=>{ if(String(url).includes('/products/search')) return response({items:[sm]}); const p=JSON.parse(opt.body); const a=p.rootConfiguration.existingAssignments; const val=n=>a.find(x=>x.variableName===n)?.valueName||''; return response({materialBomConfiguration:{root:{configuration:{valid:true,complete:true,hasConflict:false,newAssignments:[...a.map(x=>({...x,isUserAssignment:true})),{variableName:'CATALOGCODE1',valueName:`SM350C 50S/840 ${val('PLM_TRAFO')} PCS L1500 WH`}]}}},bomStatus:{configurationStatus:{valid:true,complete:true,hasConflict:false}}}); };
 for(const q of ['SM350C 50S/840 PSD PCS L1500 WH','SM350C 50S/840 PSD PCS L1500 WH 910925868386','910925868386']) { const r=await new QuoteApiClient({fetchImpl}).findAlternative(q); assert.equal(r.configuratorId,'SM350CI'); assert.equal(r.description,'SM350C 50S/840 PSU PCS L1500 WH'); }
});

test('replays the captured real DN571 search and opens the seed before changing it', async()=>{
 const fs = await import('node:fs/promises');
 const productSearch = JSON.parse(await fs.readFile(new URL('./fixtures/dn571-product-search.json', import.meta.url), 'utf8'));
 const seedValidation = JSON.parse(await fs.readFile(new URL('./fixtures/dn610-seed-validation.json', import.meta.url), 'utf8'));
 const calls=[];
 const fetchImpl=async(url,opt={})=>{
   calls.push([String(url),opt]);
   if(String(url).includes('/products/search')) return response(productSearch);
   const validationCalls=calls.filter(c=>c[0].includes('getFromExistingConfigurationWithStatus')).length;
   if(validationCalls===1) return response(seedValidation);
   return response(validFromPayload(JSON.parse(opt.body)));
 };
 const r=await new QuoteApiClient({fetchImpl}).findAlternative('DN571B LED40S/930H PSU-E C WH PGO');
 assert.equal(r.validated,true);
 assert.equal(r.configuratorId,'DN610BI');
 assert.equal(r.description,'DN610B 40S/930UE PSD-E C WH PGO');
 const validations=calls.filter(c=>c[0].includes('getFromExistingConfigurationWithStatus'));
 assert.equal(validations.length,2);
 const seedPayload=JSON.parse(validations[0][1].body);
 assert.equal(seedPayload.name,'DN610BI');
 assert.equal(seedPayload.plant,'PL06');
 assert.equal(seedPayload.usage,'5');
 assert.equal(seedPayload.rootConfiguration.materialName,'000910505104694');
 assert.equal(seedPayload.rootConfiguration.configurableMaterialName,'DN610BI');
 assert.equal(seedPayload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_TRAFO').valueName,'PSU-E');
 const targetPayload=JSON.parse(validations[1][1].body);
 assert.equal(targetPayload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_LAMPFAM').valueName,'40S');
 assert.equal(targetPayload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_COLLAMP').valueName,'930');
 assert.equal(targetPayload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_LED_BOARD_TYPE').valueName,'UE');
 assert.equal(targetPayload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_TRAFO').valueName,'PSD-E');
});
