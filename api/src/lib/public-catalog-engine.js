import { parseReference, displayControl } from './normalization.js';

const SEARCH_URL = 'https://www.google.com/search?q=';
const SIGNIFY_HOSTS = ['www.signify.com','signify.com'];

function stripHtml(s='') { return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
function esc(s=''){ return encodeURIComponent(s); }
function unique(a){ return [...new Set(a.filter(Boolean))]; }
function familyPrefixes(f){ const x=(f||'').toUpperCase(); const out=[]; for(let n=x.length;n>=4;n--) out.push(x.slice(0,n)); return unique(out); }
function configuratorIds(text=''){ return unique((text.toUpperCase().match(/\b[A-Z]{2,5}\d{2,4}[A-Z]{1,3}\b/g)||[]).filter(x=>/[IN]$/.test(x))); }
function signifyLinks(html=''){ const out=[]; for(const m of html.matchAll(/https?:\/\/(?:www\.)?signify\.com\/[^\s"'<>]+/gi)) out.push(m[0].replace(/&amp;/g,'&')); for(const m of html.matchAll(/\/url\?q=(https%3A%2F%2F(?:www\.)?signify\.com%2F[^&"']+)/gi)){ try{out.push(decodeURIComponent(m[1]));}catch{}} return unique(out); }
async function fetchText(url, timeout=8000){ const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout); try{ const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 SignifyAlternativeFinder/32','accept':'text/html,application/xhtml+xml'}}); return {ok:r.ok,status:r.status,url:r.url,text:await r.text()}; } finally {clearTimeout(t);} }
async function searchWeb(q){ const urls=[`https://www.signify.com/global/search.html?q=${esc(q)}`, `${SEARCH_URL}${esc('site:signify.com '+q)}`]; const evidence=[]; for(const url of urls){ try{const r=await fetchText(url); evidence.push({url,status:r.status,text:r.text}); if(r.ok && r.text.length>500) break;}catch(e){evidence.push({url,status:0,text:'',error:e.message});} } return evidence; }
async function inspectSignifyPages(query,family){ const search=await searchWeb(query); const links=unique(search.flatMap(x=>signifyLinks(x.text))).filter(u=>SIGNIFY_HOSTS.some(h=>u.includes(h))).slice(0,8); const pages=[]; for(const url of links){ try{const r=await fetchText(url); if(r.ok) pages.push({url,text:stripHtml(r.text)});}catch{} } const combined=[...search.map(x=>stripHtml(x.text)),...pages.map(x=>x.text)].join(' '); return {search,pages,combined}; }
function scoreConfigurator(id,family,text){ let score=0; const reasons=[]; const f=(family||'').toUpperCase(), i=id.toUpperCase(), t=text.toUpperCase(); if(i===f+'I'){score+=100;reasons.push('EXACT_FAMILY_PLUS_I');} if(i.startsWith(f.slice(0,Math.max(4,f.length-1)))){score+=25;reasons.push('FAMILY_PREFIX');} if(t.includes(f) && t.includes(i)){score+=40;reasons.push('CO_OCCURS_IN_OFFICIAL_CONTEXT');} return {id,score,reasons}; }
export async function publicCatalogEngine(input){
 const parsed=parseReference(input); const family=parsed.family; if(!family) return {status:'NEEDS_REVIEW',statusLabel:'Referência por rever',original:{input,family:null},recommended:null,validation:{verified:false,source:'Signify public catalog'},message:'Não foi possível identificar a família na referência.'};
 const queries=unique([input, family, ...familyPrefixes(family)]); let allText='', pages=[], attempts=[];
 for(const q of queries){ const r=await inspectSignifyPages(q,family); attempts.push({query:q,searchStatus:r.search.map(x=>x.status),pages:r.pages.map(x=>x.url)}); allText+=' '+r.combined; pages.push(...r.pages); const ids=configuratorIds(allText); if(ids.some(x=>x===family.toUpperCase()+'I')) break; }
 const ids=configuratorIds(allText); const ranked=ids.map(id=>scoreConfigurator(id,family,allText)).sort((a,b)=>b.score-a.score); const best=ranked[0]||null;
 const exactOfficial=best && best.id===family.toUpperCase()+'I' && best.score>=100;
 const relatedEvidence=pages.some(p=>p.text.toUpperCase().includes(family.toUpperCase()));
 return {
  status: exactOfficial?'OFFICIAL_CONFIGURATOR_IDENTIFIED':best?'CONFIGURATOR_CANDIDATE_IDENTIFIED':'NO_VERIFIED_ALTERNATIVE',
  statusLabel: exactOfficial?'Configurador oficial identificado':best?'Candidato a configurador identificado':'Sem alternativa verificada',
  compatibility:'CONFIGURABLE',
  original:{input,description:parsed.reference||input,family,control:displayControl(parsed.controlClass)},
  recommended: best?{description:`Configurador ${best.id}`,family,control:displayControl(parsed.targetControlClass),configuratorId:best.id,productUrl:pages[0]?.url||null}:null,
  configurators:ranked.slice(0,8).map(x=>({id:x.id,validated:exactOfficial&&x.id===best.id,score:x.score,reasons:x.reasons})),
  validation:{verified:Boolean(exactOfficial&&relatedEvidence),source:'Signify public catalog',method:'Official public-page evidence; no Quote authentication',checkedAt:new Date().toISOString()},
  evidence:{pages:unique(pages.map(p=>p.url)).slice(0,10),queries:attempts},
  message: exactOfficial?'O configurador foi identificado a partir de evidência pública oficial da Signify. A configuração final ainda requer validação antes de ser apresentada como produto confirmado.':best?'Foi encontrado um candidato, mas a relação família → configurador ainda não tem evidência pública suficiente para ser marcada como oficial.':'Não foi encontrada evidência pública suficiente para identificar o configurador sem inventar uma relação.'
 };
}
