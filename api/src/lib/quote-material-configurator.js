import { normalizeControlCode, normalizeText } from './normalization.js';

const DEFAULT_URL = 'https://www.quote.signify.com/api/material/getFromExistingConfigurationWithStatus';
const MATERIAL_INFO_URL = 'https://www.quote.signify.com/api/materialinfo';
const TEMPLATE_URL = 'https://www.quote.signify.com/api/material/getMaterialTemplateData';
const QUOTE_ORIGIN = 'https://www.quote.signify.com';

export class QuoteMaterialConfiguratorError extends Error {
  constructor(code, message, details = {}) { super(message); this.name='QuoteMaterialConfiguratorError'; this.code=code; this.details=details; }
}

function stateIsAvailable(state) { return Number(state) === 2 || Number(state) === 3 || Number(state) === 4; }
function stateIsSelected(state) { return Number(state) === 3 || Number(state) === 4; }
function clean(v='') { return normalizeText(v).replace(/[\s_/-]+/g,''); }

function variables(payload) {
  return payload?.materialBomConfiguration?.root?.configuration?.variableStates || [];
}
function fq(v) { return v?.fullyQualifiedName || ''; }
function options(v) { return (v?.valueStates || []).map(x=>({ id:x.name, text:x.text||x.name, state:x.state, available:stateIsAvailable(x.state), selected:stateIsSelected(x.state) })); }
function variableMap(payload) {
  const links = new Map((payload?.materialBomConfiguration?.root?.configuration?.variableLinks || []).map(x => [x.reference, x.displayName || '']));
  return new Map(variables(payload).map(v=>[fq(v), { id:fq(v), displayName:v.displayName||links.get(fq(v))||'', required:Boolean(v.required), valid:v.valid!==false, show:v.show!==false, options:options(v) }]));
}
function semanticRole(variable) {
  const key = normalizeText(`${variable.id} ${variable.displayName}`);
  if (/CONTROL GEAR|DRIVER|TRAFO/.test(key)) return 'CONTROL';
  if (/HOUSING VARIANT|PRODUCT FAMILY CODE|(?:^|[._ ])PFC(?:$|[._ ])|(?:^|[._ ])PFAM(?:$|[._ ])|PLM_PFC|PLM_PFAM/.test(key)) return 'FAMILY';
  if (/LUMINOUS FLUX|LED FAMILY CODE|LAMPFAM/.test(key)) return 'FLUX';
  if (/LIGHT SOURCE COLOR|LAMP COLOR|COLLAMP/.test(key)) return 'COLOR';
  if (/OPTIC TYPE|OPTIC$|OPTGRP/.test(key)) return 'OPTIC';
  if (/OPTICAL COVER|LUMINAIRE \/ OPTICAL COVER|COVER|PLM_CVR/.test(key)) return 'COVER';
  return 'FEATURE';
}
function variableForRole(map, role) {
  return [...map.values()].filter(v=>semanticRole(v)===role).sort((a,b)=>Number(b.show)-Number(a.show))[0] || null;
}

const DIRECT = {
  PLM_PFC: p=>[p.family], PLM_LAMPFAM:p=>[p.package,p.packageCanonical], PLM_COLLAMP:p=>[`${p.colorCode||''}${p.colorSuffix||''}`,p.colorCode],
  PLM_OPTGRP:p=>p.features||[], PLM_CVR:p=>p.features||[], PLM_CLO:p=>p.features||[], PLM_EL:p=>p.features||[],
};

function matchOption(variable, candidates=[]) {
  const wanted = candidates.filter(Boolean).map(clean);
  if (!wanted.length) return null;
  return variable.options.find(o=>o.available && wanted.includes(clean(o.id))) ||
    variable.options.find(o=>o.available && wanted.some(w=> clean(o.text).split(/[^A-Z0-9]+/).includes(w)));
}
function controlClass(id) { const c=normalizeControlCode(id); if(c!=='UNKNOWN') return c; const t=normalizeText(id); if(/DALI|DIA|PSD|PSED/.test(t)) return 'DALI'; if(/PSU|ON.?OFF/.test(t)) return 'ON_OFF'; return 'UNKNOWN'; }
function preferredControl(variable, target, sourceDriver='') {
  const candidates=variable.options.filter(o=>o.available && controlClass(o.id)===target);
  const src=normalizeText(sourceDriver);
  return candidates.sort((a,b)=>{
    const score=o=>{ const v=normalizeText(o.id); let s=0; if(target==='DALI'){ if(/^PS[UR]/.test(src)&&/^PSD-E$/.test(v))s+=100; if(/^DIA-E$/.test(v))s+=80; if(/^PSD/.test(v))s+=60; } else { if(/^PSU-E$/.test(v))s+=100; if(/^PSU$/.test(v))s+=80; } return s; }; return score(b)-score(a);
  })[0]||null;
}

export class QuoteMaterialConfiguratorClient {
  constructor({fetchImpl=globalThis.fetch,url=process.env.SIGNIFY_QUOTE_MATERIAL_API||DEFAULT_URL,materialInfoUrl=process.env.SIGNIFY_MATERIAL_INFO_API||MATERIAL_INFO_URL,templateUrl=process.env.SIGNIFY_MATERIAL_TEMPLATE_API||TEMPLATE_URL,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.url=url;this.materialInfoUrl=materialInfoUrl;this.templateUrl=templateUrl;this.timeoutMs=timeoutMs;this.metaCache=new Map();this.templateReady=new Map();}
  headers(){return {'Content-Type':'application/json','Accept':'application/json, text/plain, */*','Origin':QUOTE_ORIGIN,'Referer':QUOTE_ORIGIN+'/quotes/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0','Accept-Language':'en-GB,en;q=0.9'};}
  buildDate(){
    if(process.env.SIGNIFY_BUILD_DATE) return process.env.SIGNIFY_BUILD_DATE;
    const now=new Date();
    return new Date(Date.UTC(now.getUTCFullYear(),11,31,12,0,0,0)).toISOString();
  }
  body(model, assignments=[], plant='PL06', materialEnvironment=[]){
    return {name:model,plant,usage:'5',languages:['en-GB','en'],rootConfiguration:{existingAssignments:assignments.map(a=>({isDefault:false,isLive:true,isUserAssignment:true,variableName:a.variableName,valueName:a.valueName,...(a.fromAssignmentMapping?{fromAssignmentMapping:true}:{})})),itemId:'',materialName:model,configurableMaterialName:model,useServerDefaultValues:true,bomItemAssignments:[]},salesAreaName:'CSU Portugal',salesAreaId:'PT02/05/01',soldTo:null,shipTo:null,environment:{rootEnvironment:{salesArea:{salesOrganization:'PT02',distributionChannel:'05'},salesDocumentType:'ZQU'},materialEnvironment}};
  }
  templateBody(model,plant){
    const body=this.body(model,[{variableName:'DIM_BUILDDATE',valueName:this.buildDate(),fromAssignmentMapping:true}],plant);
    delete body.environment;
    return body;
  }
  async metadata(model){ if(this.metaCache.has(model))return this.metaCache.get(model); try { const r=await this.fetchImpl(this.materialInfoUrl,{method:'POST',headers:this.headers(),body:JSON.stringify({salesAreaId:'PT02/05/01',salesAreaName:'CSU Portugal',soldTo:null,shipTo:null,materials:[{materialName:model}]})}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const data=await r.json(); const row=Array.isArray(data)?data[0]:data; const meta={plant:row?.materialDeliveringPlant||process.env.SIGNIFY_PLANT||'PL06',isConfigurable:row?.isConfigurable!==false,name:row?.name||model}; this.metaCache.set(model,meta); return meta; } catch { const meta={plant:process.env.SIGNIFY_PLANT||'PL06',isConfigurable:true,name:model}; this.metaCache.set(model,meta); return meta; } }
  async warmTemplate(model,plant){
    const key=`${model}|${plant}`; if(this.templateReady.has(key))return this.templateReady.get(key);
    const c=new AbortController(); const timer=setTimeout(()=>c.abort(),this.timeoutMs);
    try{
      const body=this.templateBody(model,plant);
      const r=await this.fetchImpl(this.templateUrl,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal:c.signal});
      if(!r.ok){let text='';try{text=await r.text();}catch{} throw new QuoteMaterialConfiguratorError('TEMPLATE_HTTP_ERROR',`Quote template returned HTTP ${r.status}`,{status:r.status,plant,response:text.slice(0,500)});}
      const data=await r.json();
      // The template response declares model-specific material environment keys.
      // Example observed in the real BDS650N HAR: [{name:'BDS650N', environment:['Quantity']}].
      // Recreate the environment generically instead of hardcoding a family.
      const declared=data?.environment?.materialEnvironment || data?.materialEnvironment || [];
      const materialEnvironment=(Array.isArray(declared)?declared:[]).map(entry=>{
        const env={};
        for(const keyName of (entry?.environment||[])){
          if(String(keyName).toLowerCase()==='quantity') env.quantity=1;
        }
        return entry?.name ? {name:entry.name,environment:env} : null;
      }).filter(Boolean);
      this.templateReady.set(key,{materialEnvironment});
      return {materialEnvironment};
    } finally{clearTimeout(timer);}
  }
  async request(model, assignments=[]){
    const meta=await this.metadata(model);
    // The Quote HAR shows that the delivering plant is material-specific (for
    // example BGP702I/BDS650N use PL02 while DN500BI uses PL06). If materialinfo
    // cannot be reached from the Azure worker, do not lock the model to a wrong
    // generic plant: retry the two observed production plants and accept only a
    // server-validated model response.
    const plants=[...new Set([meta.plant, process.env.SIGNIFY_PLANT, 'PL02', 'PL06'].filter(Boolean))];
    let last=null;
    for(const plant of plants){
      const c=new AbortController(); const timer=setTimeout(()=>c.abort(),this.timeoutMs);
      try {
        let templateWarning=null; let templateContext={materialEnvironment:[]};
        try { templateContext=await this.warmTemplate(model,plant); }
        catch(e){ templateWarning=e; }
        const r=await this.fetchImpl(this.url,{method:'POST',headers:this.headers(),body:JSON.stringify(this.body(model,assignments,plant,templateContext?.materialEnvironment||[])),signal:c.signal});
        if(!r.ok){ let text=''; try{text=await r.text();}catch{} last=new QuoteMaterialConfiguratorError('HTTP_ERROR',`Quote Configurator returned HTTP ${r.status}`,{status:r.status,plant,response:text.slice(0,500),templateWarning:templateWarning?.details||templateWarning?.code||null}); continue; }
        const data=await r.json();
        const root=data?.materialBomConfiguration?.root;
        if(root?.isConfigurable===false){ last=new QuoteMaterialConfiguratorError('NOT_CONFIGURABLE','Material is not configurable',{plant}); continue; }
        return data;
      } catch(e){ last=e instanceof QuoteMaterialConfiguratorError?e:new QuoteMaterialConfiguratorError(e?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR','Quote Configurator model could not be loaded',{cause:String(e),plant}); }
      finally {clearTimeout(timer);}
    }
    throw last||new QuoteMaterialConfiguratorError('MODEL_UNAVAILABLE','Quote Configurator model could not be loaded');
  }
  async validate({model, parsed, targetControlClass}){
    let assignments=[]; let payload=await this.request(model,assignments); let map=variableMap(payload); const applied=[]; const unresolved=[];
    const roleCandidates = {
      FAMILY: [parsed.family],
      FLUX: [parsed.package, parsed.packageCanonical],
      COLOR: [`${parsed.colorCode||''}${parsed.colorSuffix||''}`, parsed.colorCode],
      OPTIC: parsed.features||[],
      COVER: parsed.features||[],
    };
    for (const role of ['FAMILY','FLUX','COLOR','OPTIC','COVER']) {
      const variable=variableForRole(map,role); if(!variable) continue;
      const candidate=matchOption(variable,roleCandidates[role]);
      if(!candidate){ if(['FAMILY','FLUX','COLOR'].includes(role)) unresolved.push(role); continue; }
      assignments.push({variableName:variable.id,valueName:candidate.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:variable.id,value:candidate.id,text:candidate.text,role});
    }
    const already = new Set(applied.map(x=>clean(x.value))); const featureUnresolved=[];
    for (const feature of (parsed.features||[])) {
      if (already.has(clean(feature))) continue;
      const escaped=normalizeText(feature).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const boundaryRe=escaped.length>=3 ? new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`) : null;
      // A token can be a human-readable expansion of an already selected code
      // (e.g. LGR has text 'RAL 7035'). In that case it is already represented.
      if (boundaryRe && applied.some(a=>boundaryRe.test(normalizeText(`${a.value||''} ${a.text||''}`)))) {
        applied.push({variable:null,value:feature,text:feature,sourceToken:feature,role:'REPRESENTED_BY_SELECTED_OPTION'});
        continue;
      }
      const exactMatches=[]; const fuzzyMatches=[];
      for (const variable of map.values()) {
        if (semanticRole(variable)==='CONTROL' || ['FAMILY','FLUX','COLOR'].includes(semanticRole(variable))) continue;
        for (const o of variable.options) {
          if(!o.available) continue;
          const exact=clean(o.id)===clean(feature);
          const safeShort=/^(WH|BK|GR)$/i.test(feature) && /CLR|COL|MAT|COLOR/i.test(`${variable.id} ${variable.displayName}`) && clean(o.id).startsWith(clean(feature));
          const boundary=boundaryRe && boundaryRe.test(normalizeText(`${o.id} ${o.text}`));
          const rec={variable,option:o};
          if(exact) exactMatches.push(rec); else if(safeShort||boundary) fuzzyMatches.push(rec);
        }
      }
      let pool=exactMatches.length?exactMatches:fuzzyMatches;
      pool=[...new Map(pool.map(m=>[m.variable.id+'\0'+m.option.id,m])).values()];
      if(pool.length>1 && exactMatches.length){
        // If the same exact commercial code exists in an optional/internal and a
        // required variable, prefer the required variable (observed for SRG10).
        const required=pool.filter(m=>m.variable.required);
        if(required.length===1) pool=required;
      }
      if(pool.length!==1){
        // Pure numeric suffixes can be descriptive/calculated data rather than a
        // selectable Configit option. Preserve them in the output but do not invent
        // an assignment when the model offers no unique exact value.
        if(/^\d+$/.test(String(feature)) && exactMatches.length===0){
          applied.push({variable:null,value:feature,text:feature,sourceToken:feature,role:'OPAQUE_PRESERVED',validatedByModel:false});
          continue;
        }
        featureUnresolved.push(feature); continue;
      }
      const m=pool[0]; assignments.push({variableName:m.variable.id,valueName:m.option.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:m.variable.id,value:m.option.id,text:m.option.text,sourceToken:feature,role:'FEATURE'});
    }
    unresolved.push(...featureUnresolved.map(x=>'feature:'+x));
    const control=variableForRole(map,'CONTROL'); if(!control) return {validated:false,reason:'CONTROL_VARIABLE_NOT_DISCOVERED',applied,unresolved};
    const target=preferredControl(control,targetControlClass,parsed.driver); if(!target) return {validated:false,reason:'TARGET_CONTROL_NOT_SELECTABLE',applied,unresolved,availableControls:control.options.filter(o=>o.available).map(o=>o.id)};
    assignments.push({variableName:control.id,valueName:target.id}); payload=await this.request(model,assignments); map=variableMap(payload);
    const status=payload?.bomStatus?.configurationStatus || {}; const root=payload?.materialBomConfiguration?.root?.configuration || {}; const finalControl=variableForRole(map,'CONTROL');
    const selected=finalControl?.options.some(o=>o.id===target.id && o.available); const conflict=Boolean(status.hasConflict||root.hasConflict); const valid=status.valid!==false && root.valid!==false && !conflict && selected;
    return {validated:Boolean(valid),reason:valid?null:'CONFIGURATION_REJECTED',model,controlVariable:control.id,selectedControl:target.id,assignments,applied,unresolved,complete:Boolean(status.complete||root.complete),valid:Boolean(valid),hasConflict:conflict,familyProven:applied.some(a=>a.role==='FAMILY'),availableControls:finalControl?.options.filter(o=>o.available).map(o=>o.id)||[],validationSource:'SIGNIFY_QUOTE_CONFIGIT_MODEL'};
  }
}
