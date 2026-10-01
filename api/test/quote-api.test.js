import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteApiClient } from '../src/lib/quote-api.js';

function response(body, status=200){ return { ok:status>=200&&status<300, status, async text(){return JSON.stringify(body);} }; }
function seed({description='DN610B 20S/840UE PSU-E C WH PGO', driver='PSU-E', materialName='DN610BI', name='000910505104694'}={}) { return {name, materialName, productModelName:`${materialName}_${materialName}`, description, isConfigurable:true, assignments:[
 {variableName:'PLM_TRAFO',valueName:driver},{variableName:'PLM_PFAM',valueName:description.split(' ')[0]},{variableName:'PLM_PFC',valueName:description.split(' ')[0]},
 {variableName:'PLM_LAMPFAM',valueName:(description.match(/(?:LED)?(\d+S)/)||[])[1]||'20S'}, {variableName:'PLM_COLLAMP',valueName:(description.match(/\/(\d{3})/)||[])[1]||'840'},
 {variableName:'PLM_LED_BOARD_TYPE',valueName:'UE'},{variableName:'PLM_OPTGRP',valueName:'C'},{variableName:'PLM_CLR',valueName:'WH'},{variableName:'PLM_CVR',valueName:'PGO'} ]}; }
function validFromPayload(payload){ const a=payload.rootConfiguration.existingAssignments; const val=n=>a.find(x=>x.variableName===n)?.valueName||''; const code=`${val('PLM_PFC')} ${val('PLM_LAMPFAM')}/${val('PLM_COLLAMP')}${val('PLM_LED_BOARD_TYPE')} ${val('PLM_TRAFO')} ${val('PLM_OPTGRP')} ${val('PLM_CLR')} ${val('PLM_CVR')}`; return {materialBomConfiguration:{root:{configuration:{valid:true,complete:true,hasConflict:false,newAssignments:[...a,{variableName:'CATALOGCODE1',valueName:code}]}}},bomStatus:{configurationStatus:{valid:true,complete:true,hasConflict:false}}}; }

test('discovers DN610BI from Product API data and validates legacy DN571B -> DALI without family hardcode', async()=>{
 const calls=[]; const client=new QuoteApiClient({fetchImpl:async(url,opt={})=>{calls.push([String(url),opt]); if(String(url).includes('/products/search')) return response({items:[seed()]}); const p=JSON.parse(opt.body); return response(validFromPayload(p));}});
 const r=await client.findAlternative('DN571B LED40S/930H PSU-E C WH PGO');
 assert.equal(r.configuratorId,'DN610BI'); assert.equal(r.description,'DN610B 40S/930UE PSD-E C WH PGO');
 const payload=JSON.parse(calls.find(c=>c[0].includes('getFromExisting'))[1].body); assert.equal(payload.rootConfiguration.configurableMaterialName,'DN610BI'); assert.equal(payload.rootConfiguration.existingAssignments.find(a=>a.variableName==='PLM_TRAFO').valueName,'PSD-E');
});

test('inverse current configurable DALI -> PSU uses same generic flow', async()=>{
 const client=new QuoteApiClient({fetchImpl:async(url,opt={})=>String(url).includes('/products/search')?response({items:[seed({description:'DN610B 40S/930UE PSD-E C WH PGO',driver:'PSD-E'})]}):response(validFromPayload(JSON.parse(opt.body)))});
 const r=await client.findAlternative('DN610B 40S/930UE PSD-E C WH PGO'); assert.equal(r.description,'DN610B 40S/930UE PSU-E C WH PGO');
});

test('SM350C DALI description and embedded 12NC resolve dynamically to SM350CI PSU', async()=>{
 const sm=seed({description:'SM350C 50S/840 PSD PCS L1500 WH',driver:'PSD',materialName:'SM350CI',name:'910925868386'}); sm.assignments=[{variableName:'PLM_TRAFO',valueName:'PSD'},{variableName:'PLM_PFC',valueName:'SM350C'},{variableName:'PLM_PFAM',valueName:'SM350C'},{variableName:'PLM_LAMPFAM',valueName:'50S'},{variableName:'PLM_COLLAMP',valueName:'840'},{variableName:'PLM_OPTGRP',valueName:'PCS'},{variableName:'PLM_LENGTH',valueName:'L1500'},{variableName:'PLM_CLR',valueName:'WH'}];
 const fetchImpl=async(url,opt={})=>{ if(String(url).includes('/products/search')) return response({items:[sm]}); const p=JSON.parse(opt.body); const a=p.rootConfiguration.existingAssignments; const val=n=>a.find(x=>x.variableName===n)?.valueName||''; return response({materialBomConfiguration:{root:{configuration:{valid:true,complete:true,hasConflict:false,newAssignments:[...a,{variableName:'CATALOGCODE1',valueName:`SM350C 50S/840 ${val('PLM_TRAFO')} PCS L1500 WH`}]}}},bomStatus:{configurationStatus:{valid:true,complete:true,hasConflict:false}}}); };
 for(const q of ['SM350C 50S/840 PSD PCS L1500 WH','SM350C 50S/840 PSD PCS L1500 WH 910925868386','910925868386']) { const r=await new QuoteApiClient({fetchImpl}).findAlternative(q); assert.equal(r.configuratorId,'SM350CI'); assert.equal(r.description,'SM350C 50S/840 PSU PCS L1500 WH'); }
});
