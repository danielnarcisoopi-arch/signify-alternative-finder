import { app } from '@azure/functions';
import { publicCatalogEngine } from '../lib/public-catalog-engine.js';
const VERSION='32.0.0'; const PIPELINE='PUBLIC_CATALOG_EVIDENCE_V1';
app.http('health',{methods:['GET'],authLevel:'anonymous',handler:async()=>({jsonBody:{status:'OK',version:VERSION,pipeline:PIPELINE,fingerprint:'v32-public-catalog-20261002'}})});
app.http('alternative',{methods:['GET','POST'],authLevel:'anonymous',handler:async(request)=>{if(request.method==='GET')return{jsonBody:{status:'OK',version:VERSION,pipeline:PIPELINE}};let body;try{body=await request.json();}catch{return{status:400,jsonBody:{status:'ERROR',message:'Invalid JSON'}}} const q=String(body?.query||'').trim(); if(!q)return{status:400,jsonBody:{status:'NEEDS_REVIEW',message:'Enter a Signify reference or 12NC.'}}; return{jsonBody:await publicCatalogEngine(q)};}});
