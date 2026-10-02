import { app } from '@azure/functions';
import { diagnosticEngine, VERSION, PIPELINE } from '../lib/diagnostic-engine.js';

const FINGERPRINT='v31-diagnostic-configit-only-20261002';
const CASES=[
 {id:'BGP702',query:'BGP702 LED90/730 DX10P LGR 7035 SRG10 42',family:'BGP702',configurator:'BGP702I'},
 {id:'BVP656',query:'BVP656 LED400-4S/730 PSU II A35-MB GR',family:'BVP656',configurator:'BVP656I'},
 {id:'BDS670_LED50',query:'BDS670 LED50/730 MDA BK SRT SRG10 60P',family:'BDS670',configurator:'BDS650N'},
 {id:'BDS670_LED40',query:'BDS670 LED40/730 MDM BK SRT SRG10 60P',family:'BDS670',configurator:'BDS650N'},
];
function summarize(c,r){
 const text=JSON.stringify(r); const gates={version:r.engineVersion===VERSION,pipeline:r.pipeline===PIPELINE,family:r.original?.family===c.family,configurator:r.recommended?.configuratorId===c.configurator,verified:r.status==='VERIFIED_CONFIGURABLE_PRODUCT'&&r.validation?.verified===true,noLegacySuccessor:!text.includes('BDS492')&&!text.includes('BDS490I')};
 return {id:c.id,query:c.query,expected:{family:c.family,configurator:c.configurator},pass:Object.values(gates).every(Boolean),gates,status:r.status,reason:r.reason||null,recommended:r.recommended||null,trace:r.trace||[]};
}
app.http('diag-health',{methods:['GET'],authLevel:'anonymous',handler:async()=>({jsonBody:{status:'OK',version:VERSION,pipeline:PIPELINE,fingerprint:FINGERPRINT}})});
app.http('diag-alternative',{methods:['GET','POST'],authLevel:'anonymous',handler:async(req)=>{if(req.method==='GET')return {jsonBody:{status:'OK',version:VERSION,pipeline:PIPELINE,fingerprint:FINGERPRINT}};let b={};try{b=await req.json();}catch{return {status:400,jsonBody:{status:'ERROR',message:'Invalid JSON'}}}const q=String(b?.query||'').trim();if(!q)return {status:400,jsonBody:{status:'ERROR',message:'Missing query'}};return {jsonBody:await diagnosticEngine(q)};}});
app.http('diag-selftest',{methods:['GET'],authLevel:'anonymous',handler:async()=>{const out=[];for(const c of CASES){try{out.push(summarize(c,await diagnosticEngine(c.query)));}catch(e){out.push({id:c.id,pass:false,error:e?.message||String(e)})}}const pass=out.every(x=>x.pass);return {status:pass?200:503,jsonBody:{status:pass?'PASS':'FAIL',version:VERSION,pipeline:PIPELINE,fingerprint:FINGERPRINT,cases:out}};}});
