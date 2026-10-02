import { parseReference, normalizeText, displayControl } from './normalization.js';
import { QuoteMaterialConfiguratorClient } from './quote-material-configurator.js';

const SEARCH='https://www.quote.signify.com/api/products/search';
const VERSION='31.0.0';
const PIPELINE='DIAGNOSTIC_CONFIGIT_ONLY_V1';
const MODEL_RE=/^[A-Z]{1,8}\d{2,5}[A-Z]{0,6}$/;

function prop(item,name){ return (item?.properties||[]).find(p=>String(p?.name||'').toLowerCase()===name.toLowerCase())?.value || ''; }
function isConfigurationMaterial(item){
  const mt=normalizeText(prop(item,'MaterialType'));
  if(mt==='CONFIGURATION MATERIAL') return true;
  const ext=normalizeText(item?.externalId||'');
  const name=normalizeText(item?.name||'');
  return item?.isConfigurable===true && ((MODEL_RE.test(ext)&&!/^[0-9]+$/.test(ext)) || (MODEL_RE.test(name)&&!/^[0-9]+$/.test(name))) && !normalizeText(item?.materialName||'');
}
function candidateId(item){
  for(const raw of [item?.externalId,item?.name,item?.materialName,String(item?.productModelName||'').split('_')[0]]){
    const id=normalizeText(raw||'').trim();
    if(MODEL_RE.test(id) && !/^\d+$/.test(id)) return id;
  }
  return null;
}
function itemSummary(x){return {externalId:x?.externalId||null,name:x?.name||null,materialName:x?.materialName||null,productModelName:x?.productModelName||null,description:x?.description||null,isConfigurable:Boolean(x?.isConfigurable),materialType:prop(x,'MaterialType')||null,configurationMaterial:isConfigurationMaterial(x)};}

async function fetchJson(url,options={},timeoutMs=15000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{...options,signal:c.signal});
    const text=await r.text(); let data=null; try{data=JSON.parse(text);}catch{}
    return {ok:r.ok,status:r.status,data,text:text.slice(0,1000),contentType:r.headers.get('content-type')};
  }catch(e){return {ok:false,status:0,data:null,text:String(e),error:e?.name||'ERROR'};} finally{clearTimeout(t);}
}

async function searchQuote(query,pageSize=56){
  const u=new URL(SEARCH); for(const [k,v] of Object.entries({query,page:'0',pageSize:String(pageSize),configurable:'false',language:'en-GB',salesOrganization:'PT02',distributionChannel:'05',soldTo:'null',shipTo:'null'}))u.searchParams.set(k,v);
  const res=await fetchJson(u,{headers:{Accept:'application/json, text/plain, */*','Accept-Language':'en-GB,en;q=0.9'}});
  const items=Array.isArray(res.data?.items)?res.data.items:[];
  return {...res,url:u.toString(),items};
}

async function discover(family,trace){
  const f=normalizeText(family); const letters=f.match(/^[A-Z]+/)?.[0]?.length||0; const min=Math.max(4,letters+1);
  const queries=[f]; for(let n=f.length-1;n>=min;n--)queries.push(f.slice(0,n));
  for(const q of queries){
    const r=await searchQuote(q,56);
    const summaries=r.items.map(itemSummary);
    const configItems=r.items.filter(isConfigurationMaterial).map(x=>({id:candidateId(x),item:x})).filter(x=>x.id);
    trace.push({stage:'PRODUCT_SEARCH',status:r.ok?'PASS':'ERROR',query:q,httpStatus:r.status,totalCount:r.data?.totalCount??null,itemCount:r.items.length,configurationMaterials:configItems.map(x=>x.id),items:summaries.slice(0,15),error:r.ok?null:r.text});
    if(configItems.length) return {query:q,candidates:[...new Map(configItems.map(x=>[x.id,x])).values()]};
  }
  return {query:null,candidates:[]};
}

export function createDiagnosticEngine({materialClient=new QuoteMaterialConfiguratorClient()}={}){
 return async function diagnosticEngine(query){
  const trace=[]; const parsed=parseReference(query); const family=parsed.family;
  trace.push({stage:'PARSE',status:family?'PASS':'FAIL',family:family||null,controlClass:parsed.controlClass||null,features:parsed.features||[]});
  if(!family) return {status:'FAIL',engineVersion:VERSION,pipeline:PIPELINE,trace,reason:'FAMILY_NOT_PARSED'};
  const target=parsed.controlClass && parsed.controlClass!=='UNKNOWN' ? parsed.targetControlClass : 'DALI';
  const discovery=await discover(family,trace);
  if(!discovery.candidates.length){trace.push({stage:'CONFIGURATOR_DISCOVERY',status:'FAIL',family});return {status:'FAIL',engineVersion:VERSION,pipeline:PIPELINE,trace,reason:'NO_CONFIGURATION_MATERIAL',original:{family,description:query}};}
  trace.push({stage:'CONFIGURATOR_DISCOVERY',status:'PASS',family,query:discovery.query,candidates:discovery.candidates.map(x=>x.id)});
  for(const c of discovery.candidates){
    const model=c.id;
    try{
      trace.push({stage:'MODEL_VALIDATE',status:'START',model,family,target});
      const v=await materialClient.validate({model,parsed:{...parsed,targetControlClass:target},targetControlClass:target});
      trace.push({stage:'MODEL_VALIDATE',status:v.validated&&v.familyProven&&!v.unresolved?.length?'PASS':'FAIL',model,familyProven:Boolean(v.familyProven),validated:Boolean(v.validated),complete:Boolean(v.complete),selectedControl:v.selectedControl||null,unresolved:v.unresolved||[],applied:v.applied||[],availableControls:v.availableControls||[],reason:v.reason||null});
      if(v.validated&&v.familyProven&&(v.unresolved||[]).length===0){
        const vals=(v.applied||[]).map(a=>a.value).filter(Boolean); const description=[family,...vals.filter(x=>normalizeText(x)!==normalizeText(family)),v.selectedControl].filter(Boolean).join(' ');
        trace.push({stage:'SUCCESSOR_SEARCH',status:'SKIPPED',reason:'DIAGNOSTIC_ENGINE_HAS_NO_SUCCESSOR_PATH'});
        trace.push({stage:'FINAL',status:'PASS',model,family,control:v.selectedControl});
        return {status:'VERIFIED_CONFIGURABLE_PRODUCT',engineVersion:VERSION,pipeline:PIPELINE,trace,original:{family,description:query,control:displayControl(parsed.controlClass)},recommended:{family,configuratorId:model,description,control:displayControl(target)},validation:{verified:true,source:'Signify Quote / Configit model'},reason:null};
      }
    }catch(e){trace.push({stage:'MODEL_VALIDATE',status:'ERROR',model,code:e?.code||e?.name||'ERROR',message:e?.message||String(e),details:e?.details||null});}
  }
  trace.push({stage:'SUCCESSOR_SEARCH',status:'SKIPPED',reason:'DIAGNOSTIC_ENGINE_HAS_NO_SUCCESSOR_PATH'});
  trace.push({stage:'FINAL',status:'FAIL',reason:'CURRENT_FAMILY_CONFIGIT_NOT_VALIDATED'});
  return {status:'FAIL',engineVersion:VERSION,pipeline:PIPELINE,trace,reason:'CURRENT_FAMILY_CONFIGIT_NOT_VALIDATED',original:{family,description:query},configurators:discovery.candidates.map(x=>({id:x.id}))};
 };
}
export const diagnosticEngine=createDiagnosticEngine();
export {VERSION,PIPELINE};
