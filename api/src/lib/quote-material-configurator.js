import { normalizeControlCode, normalizeText } from './normalization.js';

const DEFAULT_URL = 'https://www.quote.signify.com/api/material/getFromExistingConfigurationWithStatus';

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
function variableMap(payload) { return new Map(variables(payload).map(v=>[fq(v), { id:fq(v), displayName:v.displayName||'', required:Boolean(v.required), valid:v.valid!==false, options:options(v) }])); }

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
  constructor({fetchImpl=globalThis.fetch,url=process.env.SIGNIFY_QUOTE_MATERIAL_API||DEFAULT_URL,timeoutMs=Number(process.env.SIGNIFY_API_TIMEOUT_MS||12000)}={}){this.fetchImpl=fetchImpl;this.url=url;this.timeoutMs=timeoutMs;}
  body(model, assignments=[]){ return {name:model,plant:process.env.SIGNIFY_PLANT||'PL06',usage:'5',languages:['en-GB','en'],rootConfiguration:{existingAssignments:assignments.map(a=>({isDefault:false,isLive:true,isUserAssignment:true,variableName:a.variableName,valueName:a.valueName})),itemId:'',materialName:model,configurableMaterialName:model,useServerDefaultValues:true,bomItemAssignments:[]},salesAreaName:'CSU Portugal',salesAreaId:'PT02/05/01',soldTo:null,shipTo:null,environment:{rootEnvironment:{salesArea:{salesOrganization:'PT02',distributionChannel:'05'},salesDocumentType:'ZQU'},materialEnvironment:[]}}; }
  async request(model, assignments=[]){ const c=new AbortController(); const timer=setTimeout(()=>c.abort(),this.timeoutMs); try { const r=await this.fetchImpl(this.url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(this.body(model,assignments)),signal:c.signal}); if(!r.ok) throw new QuoteMaterialConfiguratorError('HTTP_ERROR',`Quote Configurator returned HTTP ${r.status}`,{status:r.status}); return await r.json(); } catch(e){ if(e instanceof QuoteMaterialConfiguratorError) throw e; throw new QuoteMaterialConfiguratorError(e?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR','Quote Configurator model could not be loaded',{cause:String(e)}); } finally {clearTimeout(timer);} }
  async validate({model, parsed, targetControlClass}){
    let assignments=[]; let payload=await this.request(model,assignments); let map=variableMap(payload); const applied=[]; const unresolved=[];
    const ordered=['PLM_PFC','PLM_LAMPFAM','PLM_COLLAMP','PLM_OPTGRP','PLM_CVR'];
    for(const id of ordered){ const variable=map.get(id); if(!variable) continue; const candidate=matchOption(variable,(DIRECT[id]?.(parsed)||[])); if(!candidate){ if(id==='PLM_PFC'||id==='PLM_LAMPFAM'||id==='PLM_COLLAMP') unresolved.push(id); continue; } assignments.push({variableName:id,valueName:candidate.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:id,value:candidate.id}); }
    // Preserve remaining commercial tokens by resolving them against the live model,
    // not against a family-specific dictionary. A token is applied only when it has
    // one unique official option match. Short colour tokens (WH/BK/GR) may match a
    // unique option prefix only in colour/material variables (e.g. WH201).
    const already = new Set(applied.map(x=>clean(x.value)));
    const featureUnresolved=[];
    for (const feature of (parsed.features||[])) {
      if (already.has(clean(feature))) continue;
      const matches=[];
      for (const variable of map.values()) {
        if (['PLM_TRAFO','PLM_PFC','PLM_LAMPFAM','PLM_COLLAMP'].includes(variable.id)) continue;
        for (const o of variable.options) {
          if (!o.available) continue;
          const exact=clean(o.id)===clean(feature);
          const safeShort=/^(WH|BK|GR)$/i.test(feature) && /CLR|COL|MAT/i.test(variable.id) && clean(o.id).startsWith(clean(feature));
          if (exact||safeShort) matches.push({variable,option:o});
        }
      }
      const unique=[...new Map(matches.map(m=>[m.variable.id+'\0'+m.option.id,m])).values()];
      if (unique.length!==1) { featureUnresolved.push(feature); continue; }
      const m=unique[0]; assignments.push({variableName:m.variable.id,valueName:m.option.id}); payload=await this.request(model,assignments); map=variableMap(payload); applied.push({variable:m.variable.id,value:m.option.id,sourceToken:feature});
    }
    unresolved.push(...featureUnresolved.map(x=>'feature:'+x));

    const trafo=map.get('PLM_TRAFO'); if(!trafo) return {validated:false,reason:'CONTROL_VARIABLE_NOT_DISCOVERED',applied,unresolved};
    const target=preferredControl(trafo,targetControlClass,parsed.driver); if(!target) return {validated:false,reason:'TARGET_CONTROL_NOT_SELECTABLE',applied,unresolved,availableControls:trafo.options.filter(o=>o.available).map(o=>o.id)};
    assignments.push({variableName:'PLM_TRAFO',valueName:target.id}); payload=await this.request(model,assignments); map=variableMap(payload);
    const status=payload?.bomStatus?.configurationStatus || {}; const root=payload?.materialBomConfiguration?.root?.configuration || {};
    const finalTrafo=map.get('PLM_TRAFO'); const selected=finalTrafo?.options.some(o=>o.id===target.id && o.available);
    const conflict=Boolean(status.hasConflict||root.hasConflict); const valid=status.valid!==false && root.valid!==false && !conflict && selected;
    return {validated:Boolean(valid),reason:valid?null:'CONFIGURATION_REJECTED',model,selectedControl:target.id,assignments,applied,unresolved,complete:Boolean(status.complete||root.complete),valid:Boolean(valid),hasConflict:conflict,availableControls:finalTrafo?.options.filter(o=>o.available).map(o=>o.id)||[],validationSource:'SIGNIFY_QUOTE_CONFIGIT_MODEL'};
  }
}
