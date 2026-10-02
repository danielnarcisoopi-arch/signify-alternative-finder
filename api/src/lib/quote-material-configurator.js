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
  constructor({fetchImpl=globalThis.fetch,url=process.env.SIGNIFY_QUOTE_MATERIAL_API||DEFAULT_URL,materialInfoUrl=process.env.SIGNIFY_MATERIAL_INFO_API||MATERIAL_INFO_URL,templateUrl=process.env.SIGNIFY_MATERIAL_TEMPLATE_API||TEMPLATE_URL,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.url=url;this.materialInfoUrl=materialInfoUrl;this.templateUrl=templateUrl;this.timeoutMs=timeoutMs;this.metaCache=new Map();this.templateReady=new Set();}
  headers(){return {'Content-Type':'application/json','Accept':'application/json, text/plain, */*','Origin':QUOTE_ORIGIN,'Referer':QUOTE_ORIGIN+'/'};}
  buildDate(){
    if(process.env.SIGNIFY_BUILD_DATE) return process.env.SIGNIFY_BUILD_DATE;
    const now=new Date();
    return new Date(Date.UTC(now.getUTCFullYear(),11,31,12,0,0,0)).toISOString();
  }
  body(model, assignments=[], plant='PL06'){
    return {name:model,plant,usage:'5',languages:['en-GB','en'],rootConfiguration:{existingAssignments:assignments.map(a=>({isDefault:false,isLive:true,isUserAssignment:true,variableName:a.variableName,valueName:a.valueName,...(a.fromAssignmentMapping?{fromAssignmentMapping:true}:{})})),itemId:'',materialName:model,configurableMaterialName:model,useServerDefaultValues:true,bomItemAssignments:[]},salesAreaName:'CSU Portugal',salesAreaId:'PT02/05/01',soldTo:null,shipTo:null,environment:{rootEnvironment:{salesArea:{salesOrganization:'PT02',distributionChannel:'05'},salesDocumentType:'ZQU'},materialEnvironment:[]}};
  }
  templateBody(model,plant){
    const body=this.body(model,[{variableName:'DIM_BUILDDATE',valueName:this.buildDate(),fromAssignmentMapping:true}],plant);
    delete body.environment;
    return body;
  }
  async metadata(model){ if(this.metaCache.has(model))return this.metaCache.get(model); try { const r=await this.fetchImpl(this.materialInfoUrl,{method:'POST',headers:this.headers(),body:JSON.stringify({salesAreaId:'PT02/05/01',salesAreaName:'CSU Portugal',soldTo:null,shipTo:null,materials:[{materialName:model}]})}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const data=await r.json(); const row=Array.isArray(data)?data[0]:data; const meta={plant:row?.materialDeliveringPlant||process.env.SIGNIFY_PLANT||'PL06',isConfigurable:row?.isConfigurable!==false,name:row?.name||model}; this.metaCache.set(model,meta); return meta; } catch { const meta={plant:process.env.SIGNIFY_PLANT||'PL06',isConfigurable:true,name:model}; this.metaCache.set(model,meta); return meta; } }
  async warmTemplate(model,plant){
    const key=`${model}|${plant}`; if(this.templateReady.has(key))return;
    const c=new AbortController(); const timer=setTimeout(()=>c.abort(),this.timeoutMs);
    try{const body=this.templateBody(model,plant); const r=await this.fetchImpl(this.templateUrl,{method:'POST',headers:this.headers(),body:JSON.stringify(body),signal:c.signal}); if(!r.ok)throw new QuoteMaterialConfiguratorError('TEMPLATE_HTTP_ERROR',`Quote template returned HTTP ${r.status}`,{status:r.status,plant}); await r.json(); this.templateReady.add(key);} finally{clearTimeout(timer);}
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
        await this.warmTemplate(model,plant); const r=await this.fetchImpl(this.url,{method:'POST',headers:this.headers(),body:JSON.stringify(this.body(model,assignments,plant)),signal:c.signal});
        if(!r.ok){ last=new QuoteMaterialConfiguratorError('HTTP_ERROR',`Quote Configurator returned HTTP ${r.status}`,{status:r.status,plant}); continue; }
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
      assignments.push({variableName:variable.id,valueName:candidate.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:variable.id,value:candidate.id,role});
    }
    const already = new Set(applied.map(x=>clean(x.value))); const featureUnresolved=[];
    for (const feature of (parsed.features||[])) {
      if (already.has(clean(feature))) continue; const matches=[];
      for (const variable of map.values()) {
        if (semanticRole(variable)==='CONTROL' || ['FAMILY','FLUX','COLOR'].includes(semanticRole(variable))) continue;
        for (const o of variable.options) {
          if(!o.available) continue;
          const exact=clean(o.id)===clean(feature);
          const safeShort=/^(WH|BK|GR)$/i.test(feature) && /CLR|COL|MAT|COLOR/i.test(`${variable.id} ${variable.displayName}`) && clean(o.id).startsWith(clean(feature));
          // Many outdoor models encode a commercial token inside a longer option
          // label. Accept it only when the token occurs as a real boundary and the
          // match is globally unique across the model. This preserves strictness
          // while allowing codes such as DX10P, MDM, SRT, SRG10 and 60P to map to
          // model-specific variables without family-specific code.
          const escaped=normalizeText(feature).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          const boundary=escaped.length>=3 && new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(normalizeText(`${o.id} ${o.text}`));
          if(exact||safeShort||boundary) matches.push({variable,option:o});
        }
      }
      const unique=[...new Map(matches.map(m=>[m.variable.id+'\0'+m.option.id,m])).values()];
      if(unique.length!==1){ featureUnresolved.push(feature); continue; }
      const m=unique[0]; assignments.push({variableName:m.variable.id,valueName:m.option.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:m.variable.id,value:m.option.id,sourceToken:feature,role:'FEATURE'});
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
