import { normalizeText } from './normalization.js';

const DEFAULT_BASE='https://www.quote.signify.com/api/products/search';
const MODEL_RE=/^[A-Z]{1,8}\d{2,5}[A-Z]{0,6}$/;
const MODEL_TOKEN_RE=/(?:^|[^A-Z0-9])([A-Z]{1,8}\d{2,5}[A-Z]{0,6})(?=$|[^A-Z0-9])/g;
function walk(v,out=[],path=[]){ if(Array.isArray(v)){v.forEach((x,i)=>walk(x,out,[...path,i]));return out;} if(!v||typeof v!=='object')return out; out.push({value:v,path}); Object.entries(v).forEach(([k,x])=>{if(x&&typeof x==='object')walk(x,out,[...path,k])}); return out; }
function strings(v,out=[]){ if(v==null)return out; if(Array.isArray(v)){v.forEach(x=>strings(x,out));return out;} if(typeof v==='object'){Object.values(v).forEach(x=>strings(x,out));return out;} out.push(String(v)); return out; }
function tokens(text){ const n=normalizeText(text); const out=[]; for(const m of n.matchAll(MODEL_TOKEN_RE)) if(MODEL_RE.test(m[1])) out.push(m[1]); return out; }
function explicitModels(payload,family){
 const result=[]; const fam=normalizeText(family);
 for(const {value:o,path} of walk(payload)) for(const [k,v] of Object.entries(o)){
   const vals=strings(v); const strong=/(configurableMaterialName|configurable_material_name|configurator|configuratorId|configuratorName|configurationModel|configuration_model|modelMaterial)/i.test(k);
   const catalogueText=/(configur|configuration|model)/i.test(k) || path.some(p=>/(configur|catalog|family|range|technical)/i.test(String(p)));
   for(const raw of vals){
     const n=normalizeText(raw).trim();
     if(strong && MODEL_RE.test(n)) result.push({id:n,key:k,explicit:true,evidence:'EXPLICIT_FIELD'});
     // Catalog/family services sometimes expose a comma-separated "Configurators"
     // field rather than a dedicated configurableMaterialName. Parse that list,
     // but only from configuration/catalog context. This is data extraction, not
     // a family->model naming rule.
     if(strong || catalogueText || /CONFIGURAT(?:OR|ORS|ION)/i.test(n)) for(const id of tokens(n)) {
       if(id===fam) continue;
       result.push({id,key:k,explicit:strong,evidence:strong?'EXPLICIT_FIELD':'CATALOG_TEXT'});
     }
   }
 }
 return result;
}
export class QuoteProductDiscoveryClient{
 constructor({fetchImpl=globalThis.fetch,baseUrl=process.env.SIGNIFY_QUOTE_PRODUCT_SEARCH||DEFAULT_BASE,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.baseUrl=baseUrl;this.timeoutMs=timeoutMs;}
 async search(query,{configurable=true}={}){ const u=new URL(this.baseUrl); u.searchParams.set('query',query);u.searchParams.set('page','0');u.searchParams.set('pageSize','100');u.searchParams.set('configurable',String(configurable));u.searchParams.set('language','en-GB');u.searchParams.set('salesOrganization','PT02');u.searchParams.set('distributionChannel','05');u.searchParams.set('soldTo','');u.searchParams.set('shipTo',''); const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs); try{const r=await this.fetchImpl(u,{headers:{Accept:'application/json'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);} }
 async discover(family,{familyName=''}={}){
   const f=normalizeText(family); const all=[];
   // Do not manufacture a configurator id. Ask the official Quote search with
   // several exact-family/catalog-oriented queries and extract only ids actually
   // present in its payloads.
   const queries=[f, familyName&&`${f} ${familyName}`, `${f} CONFIGURATOR`, familyName&&`${familyName} CONFIGURATOR`].filter(Boolean);
   for(const q of [...new Set(queries)]) for(const configurable of [true,false]){
     try{const p=await this.search(q,{configurable});for(const m of explicitModels(p,f))all.push({...m,query:q,configurable,source:'QUOTE_CATALOG_DISCOVERY'});}catch(e){all.push({error:String(e),query:q,configurable,source:'QUOTE_CATALOG_DISCOVERY'});}
   }
   const scored=new Map();
   for(const m of all){if(!m.id)continue;let s=m.explicit?180:90;if(m.evidence==='CATALOG_TEXT')s+=40;if(m.query===f)s+=20;const cur=scored.get(m.id);if(!cur||s>cur.score)scored.set(m.id,{...m,score:s});}
   return {candidates:[...scored.values()].sort((a,b)=>b.score-a.score),diagnostics:all};
 }
}
