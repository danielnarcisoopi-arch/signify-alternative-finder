import { normalizeText } from './normalization.js';

const DEFAULT_BASE='https://www.quote.signify.com/api/products/search';
const MODEL_RE=/^[A-Z]{1,8}\d{2,5}[A-Z]{0,6}$/;
function walk(v,out=[]){ if(Array.isArray(v)){v.forEach(x=>walk(x,out));return out;} if(!v||typeof v!=='object')return out; out.push(v); Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x,out)}); return out; }
function strings(v,out=[]){ if(v==null)return out; if(Array.isArray(v)){v.forEach(x=>strings(x,out));return out;} if(typeof v==='object'){Object.values(v).forEach(x=>strings(x,out));return out;} out.push(String(v)); return out; }
function explicitModels(payload){
 const result=[];
 for(const o of walk(payload)) for(const [k,v] of Object.entries(o)){
   if(!/(configurableMaterialName|configurable_material_name|configurator|configuratorId|configuratorName|materialName|materialCode)/i.test(k))continue;
   for(const raw of strings(v)){ const n=normalizeText(raw).trim(); if(MODEL_RE.test(n))result.push({id:n,key:k,explicit:/configur|configurable/i.test(k)}); }
 }
 return result;
}
export class QuoteProductDiscoveryClient{
 constructor({fetchImpl=globalThis.fetch,baseUrl=process.env.SIGNIFY_QUOTE_PRODUCT_SEARCH||DEFAULT_BASE,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.baseUrl=baseUrl;this.timeoutMs=timeoutMs;}
 async search(family,{configurable=true}={}){ const u=new URL(this.baseUrl); u.searchParams.set('query',family);u.searchParams.set('page','0');u.searchParams.set('pageSize','100');u.searchParams.set('configurable',String(configurable));u.searchParams.set('language','en-GB');u.searchParams.set('salesOrganization','PT02');u.searchParams.set('distributionChannel','05');u.searchParams.set('soldTo','');u.searchParams.set('shipTo',''); const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs); try{const r=await this.fetchImpl(u,{headers:{Accept:'application/json'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);} }
 async discover(family){
   const f=normalizeText(family); const all=[];
   for(const configurable of [true,false]){try{const p=await this.search(f,{configurable});for(const m of explicitModels(p))all.push({...m,configurable,source:'QUOTE_PRODUCTS_SEARCH'});}catch(e){all.push({error:String(e),configurable,source:'QUOTE_PRODUCTS_SEARCH'});}}
   const scored=new Map();
   for(const m of all){if(!m.id)continue;let s=m.explicit?140:30;if(m.id===f)s+=10;if(m.id.startsWith(f))s+=40;const cur=scored.get(m.id);if(!cur||s>cur.score)scored.set(m.id,{...m,score:s});}
   return {candidates:[...scored.values()].sort((a,b)=>b.score-a.score),diagnostics:all};
 }
}
