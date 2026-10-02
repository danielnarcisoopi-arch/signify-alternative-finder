import { normalizeText } from './normalization.js';

const DEFAULT_BASE='https://www.quote.signify.com/api/products/search';
const MODEL_RE=/^[A-Z]{1,8}\d{2,5}[A-Z]{0,6}$/;
const MODEL_TOKEN_RE=/(?:^|[^A-Z0-9])([A-Z]{1,8}\d{2,5}[A-Z]{0,6})(?=$|[^A-Z0-9])/g;
function walk(v,out=[],path=[]){ if(Array.isArray(v)){v.forEach((x,i)=>walk(x,out,[...path,i]));return out;} if(!v||typeof v!=='object')return out; out.push({value:v,path}); Object.entries(v).forEach(([k,x])=>{if(x&&typeof x==='object')walk(x,out,[...path,k])}); return out; }
function strings(v,out=[]){ if(v==null)return out; if(Array.isArray(v)){v.forEach(x=>strings(x,out));return out;} if(typeof v==='object'){Object.values(v).forEach(x=>strings(x,out));return out;} out.push(String(v)); return out; }
function tokens(text){ const n=normalizeText(text); const out=[]; for(const m of n.matchAll(MODEL_TOKEN_RE)) if(MODEL_RE.test(m[1])) out.push(m[1]); return out; }
function explicitModels(payload,family){
 const result=[]; const fam=normalizeText(family);
 // IMPORTANT: this is the shape observed in the real Quote HAR. An exact family
 // search may return a configurable item even when configurable=false. In that
 // case externalId/name is the configurator material and is authoritative.
 const items=payload?.items || payload?.results || [];
 for(const item of Array.isArray(items)?items:[]){
   if(item?.isConfigurable===true){
     for(const raw of [item.externalId,item.name,item.configurableMaterialName]){
       const id=normalizeText(raw||'').trim();
       if(MODEL_RE.test(id)) result.push({id,key:'configurable-search-item',explicit:true,evidence:'QUOTE_CONFIGURABLE_ITEM',description:item.description||'',plant:item.plant||null});
     }
   }
 }
 for(const {value:o,path} of walk(payload)) for(const [k,v] of Object.entries(o)){
   const vals=strings(v); const strong=/(configurableMaterialName|configurable_material_name|configurator|configuratorId|configuratorName|configurationModel|configuration_model|modelMaterial)/i.test(k);
   const catalogueText=/(configur|configuration|model)/i.test(k) || path.some(p=>/(configur|catalog|family|range|technical)/i.test(String(p)));
   for(const raw of vals){ const n=normalizeText(raw).trim(); if(strong && MODEL_RE.test(n)) result.push({id:n,key:k,explicit:true,evidence:'EXPLICIT_FIELD'}); if(strong||catalogueText||/CONFIGURAT(?:OR|ORS|ION)/i.test(n)) for(const id of tokens(n)){ if(id===fam)continue; result.push({id,key:k,explicit:strong,evidence:strong?'EXPLICIT_FIELD':'CATALOG_TEXT'}); } }
 }
 return result;
}
export class QuoteProductDiscoveryClient{
 constructor({fetchImpl=globalThis.fetch,baseUrl=process.env.SIGNIFY_QUOTE_PRODUCT_SEARCH||DEFAULT_BASE,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.baseUrl=baseUrl;this.timeoutMs=timeoutMs;}
 async search(query,{configurable=false,pageSize=6}={}){ const u=new URL(this.baseUrl); u.searchParams.set('query',query);u.searchParams.set('page','0');u.searchParams.set('pageSize',String(pageSize));u.searchParams.set('configurable',String(configurable));u.searchParams.set('language','en-GB');u.searchParams.set('salesOrganization','PT02');u.searchParams.set('distributionChannel','05');u.searchParams.set('soldTo','null');u.searchParams.set('shipTo','null'); const c=new AbortController(),t=setTimeout(()=>c.abort(),this.timeoutMs); try{const r=await this.fetchImpl(u,{headers:{Accept:'application/json'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);} }
 async discover(family,{familyName=''}={}){
   const f=normalizeText(family); const all=[];
   // First replay the exact request pattern observed in the official Quote UI.
   // Do not broaden until exact family discovery has been exhausted.
   for(const configurable of [false,true]){ try{const p=await this.search(f,{configurable});for(const m of explicitModels(p,f))all.push({...m,query:f,configurable,source:'QUOTE_EXACT_FAMILY_SEARCH'});}catch(e){all.push({error:String(e),query:f,configurable,source:'QUOTE_EXACT_FAMILY_SEARCH'});} }
   const exact=[...new Map(all.filter(x=>x.id).map(x=>[x.id,x])).values()];
   const exactStrong=[...new Map(all.filter(x=>x.id&&(x.evidence==='QUOTE_CONFIGURABLE_ITEM'||x.evidence==='EXPLICIT_FIELD')).map(x=>[x.id,x])).values()];
   if(exactStrong.length) return {candidates:exactStrong.map(x=>({...x,score:300})),diagnostics:all,mode:'EXACT_FAMILY'};

   // Progressive-prefix discovery mirrors the safe manual workflow used in Quote:
   // BDS670 -> BDS67 -> BDS6 -> ... . Prefix hits are ONLY candidates; the engine
   // must still open the Configit model and prove that it contains the original
   // family before it can be recommended. This supports non-lexical relationships
   // such as BDS670 being carried by BDS650N without hardcoding that mapping.
   const minPrefix = Math.max(4, (f.match(/^[A-Z]+/)?.[0]?.length || 0) + 1);
   const prefixes=[];
   for(let n=f.length-1;n>=minPrefix;n--) prefixes.push(f.slice(0,n));
   for(const q of prefixes){
     for(const configurable of [false,true]){
       try{
         const p=await this.search(q,{configurable,pageSize:56});
         for(const m of explicitModels(p,f)) all.push({...m,query:q,configurable,source:'QUOTE_PROGRESSIVE_PREFIX',prefixLength:q.length});
       }catch(e){ all.push({error:String(e),query:q,configurable,source:'QUOTE_PROGRESSIVE_PREFIX'}); }
     }
     // Stop broadening once an official configurable material has been exposed.
     // Model proof in the engine will reject unrelated prefix siblings.
     if(all.some(x=>x.id && x.source==='QUOTE_PROGRESSIVE_PREFIX' && x.query===q && (x.evidence==='QUOTE_CONFIGURABLE_ITEM'||x.evidence==='EXPLICIT_FIELD'))) break;
   }
   const prefixModels=[...new Map(all.filter(x=>x.id&&x.source==='QUOTE_PROGRESSIVE_PREFIX'&&(x.evidence==='QUOTE_CONFIGURABLE_ITEM'||x.evidence==='EXPLICIT_FIELD')).map(x=>[x.id,x])).values()];
   if(prefixModels.length) return {candidates:prefixModels.map(x=>({...x,score:240+x.prefixLength})),diagnostics:all,mode:'PROGRESSIVE_PREFIX'};

   // Only if exact and progressive-prefix discovery return no configurable material
   // do we use broader catalog text queries.
   const queries=[familyName&&`${f} ${familyName}`, `${f} CONFIGURATOR`, familyName&&`${familyName} CONFIGURATOR`].filter(Boolean);
   for(const q of [...new Set(queries)]) for(const configurable of [false,true]){ try{const p=await this.search(q,{configurable,pageSize:56});for(const m of explicitModels(p,f))all.push({...m,query:q,configurable,source:'QUOTE_CATALOG_DISCOVERY'});}catch(e){all.push({error:String(e),query:q,configurable,source:'QUOTE_CATALOG_DISCOVERY'});} }
   const scored=new Map(); for(const m of all){if(!m.id)continue;let s=m.explicit?180:90;if(m.evidence==='CATALOG_TEXT')s+=40;const cur=scored.get(m.id);if(!cur||s>cur.score)scored.set(m.id,{...m,score:s});}
   return {candidates:[...scored.values()].sort((a,b)=>b.score-a.score),diagnostics:all,mode:'FALLBACK'};
 }
}
