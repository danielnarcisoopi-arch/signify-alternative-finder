import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReference, displayControl } from './normalization.js';

const kbPath = fileURLToPath(new URL('../data/catalog-2026-kb.json', import.meta.url));
const KB = JSON.parse(readFileSync(kbPath, 'utf8'));

function cleanFamilyName(s='') {
  return String(s).split(/\s{2,}/)[0].trim().replace(/\s+/g,' ');
}
function lookupFamily(family='') {
  const f=family.toUpperCase();
  return KB.entries[f] || null;
}
export function catalogStats(){ return {catalog:KB.version, entries:Object.keys(KB.entries).length, groups:KB.groups.length}; }

export async function publicCatalogEngine(input){
  const parsed=parseReference(input);
  const family=(parsed.family||'').toUpperCase();
  if(!family) return {status:'NEEDS_REVIEW',statusLabel:'Referência por rever',original:{input,family:null},recommended:null,validation:{verified:false,source:'Catálogo Signify 2026'},message:'Não foi possível identificar a família na referência.'};
  const hit=lookupFamily(family);
  if(!hit){
    return {status:'NO_VERIFIED_ALTERNATIVE',statusLabel:'Família sem configurador indexado',compatibility:'NONE',original:{input,description:parsed.reference||input,family,control:displayControl(parsed.controlClass)},recommended:null,validation:{verified:false,source:'Catálogo Signify 2026',method:'Índice local extraído do catálogo; sem Quote/API',checkedAt:new Date().toISOString()},message:'A família foi identificada, mas o catálogo 2026 indexado não contém uma relação suficientemente explícita com um configurador.'};
  }
  const familyName=cleanFamilyName(hit.familyName);
  return {
    status:'OFFICIAL_CONFIGURATOR_IDENTIFIED',
    statusLabel:'Configurador oficial identificado',
    compatibility:'CONFIGURABLE',
    original:{input,description:parsed.reference||input,family,control:displayControl(parsed.controlClass)},
    recommended:{description:`Configurador ${hit.configuratorId}`,family,control:displayControl(parsed.targetControlClass),configuratorId:hit.configuratorId,catalogPage:hit.catalogPage,familyName},
    configurators:[{id:hit.configuratorId,validated:true,score:100,reasons:[hit.method]}],
    validation:{verified:true,source:'Catálogo de iluminação profissional Signify 2026',method:`${hit.method}; índice local, sem Quote/API`,catalogPage:hit.catalogPage,checkedAt:new Date().toISOString()},
    evidence:{catalog:'Catálogo de iluminação profissional 2026_LR.pdf',page:hit.catalogPage,familyName,method:hit.method},
    message:`O catálogo 2026 associa ${family}${familyName?` (${familyName})`:''} ao configurador ${hit.configuratorId}. A configuração comercial final PSU/PSD só deve ser apresentada depois de validada pelo configurador.`
  };
}
