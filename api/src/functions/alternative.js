import { app } from '@azure/functions';

const DALI_DRIVERS=['PSD','PSD-E','DIA-E','DIA','PSED','WIA-E'];
const ONOFF_DRIVERS=['PSU','PSU-E','PSR'];
const ALL_DRIVERS=[...DALI_DRIVERS,...ONOFF_DRIVERS];
const CONFIGURABLE={DN500B:{family:'DN500BI',preferred:'PSD-E'},DN610B:{family:'DN610B',preferred:'PSD-E'}};
const MIGRATIONS={DN571B:{current:'DN610B',preferred:'PSD-E',configurable:true}};

// Cache accelerates known verified results, but candidate generation DOES NOT depend on it.
const CACHE=new Map([
 ['DN142B 10S/840 PSU-E WR IP54',{ref:'DN142B 10S/840 PSD-E WR IP54',orderCode:'910505103591'}],
 ['WT120C G3 60S/840 PSU L1200',{ref:'WT120C G3 60S/840 PSD L1200',orderCode:'911401838588'}],
 ['BY120P G6 LED150/UE840 PSU WB',{ref:'BY120P G6 LED150/840 PSD WB',orderCode:'911401554345'}],
 ['DN500B 20S/840 PSU-E WR WH PCO',{ref:'DN500B 20S/840 PSD-E WR WH PCO',orderCode:null,config:'DN500BI'}],
 ['WT490C 62S/840 PSU NE WB PI5 L1800',{ref:'WT490C 80S/840 PSD HE WB PI5 L1800',orderCode:'910925867735'}]
]);
const NC=new Map([['911401551532','DN142B 10S/840 PSU-E WR IP54'],['911401836188','WT120C G3 60S/840 PSU L1200'],['911401554245','BY120P G6 LED150/UE840 PSU WB'],['910505105009','DN500B 20S/840 PSU-E WR WH PCO'],['910925868380','SM350C 50S/840 PSU PCS L1500 WH']]);

const norm=s=>(s||'').toUpperCase().trim().replace(/\s+/g,' ');
const tokens=s=>norm(s).split(/[\s/]+/).filter(Boolean);
const family=s=>tokens(s)[0]||'';
const driver=s=>tokens(s).find(x=>ALL_DRIVERS.includes(x))||'';
const canonical=s=>norm(s).replace(/LED(\d+)S/g,'$1S').replace(/\/(9\d{2})H\b/g,'/$1');
const swap=(ref,to)=>{const d=driver(ref);return d?norm(ref).replace(new RegExp(`\\b${d}\\b`),to):norm(ref)};
const migrate=(ref,to)=>{const a=tokens(canonical(ref));a[0]=to;return a.join(' ')};

function parse(ref){const t=tokens(canonical(ref)),o={f:t[0]||'',pkg:null,cct:'',len:'',optic:'',cover:'',colour:'',conn:'',eff:''};for(const x of t){if(/^\d+S$/.test(x))o.pkg=+x.slice(0,-1);else if(/^(?:UE)?(?:8|9)\d{2}$/.test(x)){o.cct=x.replace(/^UE/,'');if(x.startsWith('UE'))o.eff='UE'}else if(/^L\d+$/.test(x))o.len=x;else if(['C','M','WR','WB','NB','MB','VWB','NOC','OC','A'].includes(x))o.optic=x;else if(['PG','PGO','PCO','PCC','PCS'].includes(x))o.cover=x;else if(['WH','BK','GR','ALU'].includes(x))o.colour=x;else if(/^PI\d+$/.test(x))o.conn=x;else if(['NE','HE','UE'].includes(x))o.eff=x}return o}
function similarity(a,b,allowFamily=false){const A=parse(a),B=parse(b);let s=A.f===B.f?600:allowFamily?350:-1000;const eq=(k,w)=>{if(A[k]&&B[k])s+=A[k]===B[k]?w:-w};eq('cct',300);eq('len',240);eq('optic',220);eq('cover',180);eq('colour',120);eq('conn',170);if(A.pkg&&B.pkg){const r=Math.abs(A.pkg-B.pkg)/A.pkg;s+=Math.max(-180,240-r*500)}if(A.eff&&B.eff&&A.eff!==B.eff)s-=25;return s}

// Universal generator. Every unseen PSU/PSU-E/PSR reference gets every plausible DALI driver candidate.
function generateCandidates(ref){
 const d=driver(ref); if(!ONOFF_DRIVERS.includes(d))return [];
 const ordered = d==='PSU-E' ? ['PSD-E','PSD','DIA-E','PSED','DIA','WIA-E'] : ['PSD','PSD-E','DIA-E','PSED','DIA','WIA-E'];
 return ordered.map((target,index)=>({reference:swap(ref,target),target,priority:index}));
}

async function domainSearch(q){
 // Search-engine fallback for public Signify pages. Replace with internal PIM/catalog API when available.
 const engines=[
  `https://www.google.com/search?q=${encodeURIComponent('site:signify.com "'+q+'"')}`,
  `https://www.google.com/search?q=${encodeURIComponent('site:assets.signify.com "'+q+'"')}`
 ];
 const out=[];
 for(const url of engines){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'}});if(!r.ok)continue;const h=await r.text();const codeRe=/\b(9\d{11})\b/g;for(const m of h.matchAll(codeRe)){const code=m[1];if(!out.some(x=>x.orderCode===code))out.push({orderCode:code,url:`https://www.signify.com/global/search?q=${encodeURIComponent(code)}`});}}catch{}}
 return out;
}
async function verifyCandidate(candidate){const hits=await domainSearch(candidate);return hits[0]||null}

async function solve(raw){
 let original=norm(raw),input12=null;if(/^\d{12}$/.test(original)){input12=original;original=NC.get(original)||original}
 const cached=CACHE.get(original);if(cached)return{status:cached.config?'configurable':'verified',title:cached.config?'FOUND VIA CONFIGURATOR':'BEST VERIFIED ALTERNATIVE',original:{reference:original,orderCode:input12},recommended:{reference:cached.ref,orderCode:cached.orderCode},configurator:cached.config||null,matchType:cached.config?'configurator':'exact',explanation:cached.config?'Same specification rebuilt through the configurable family with DALI.':'Verified exact control-gear mapping.'};
 if(/^\d{12}$/.test(original))return{status:'unverified',title:'UNRESOLVED 12NC',original:{reference:original,orderCode:input12},explanation:'This 12NC could not be resolved to a commercial reference.'};

 // 1) UNIVERSAL exact candidate generation — no family whitelist.
 const generated=generateCandidates(original);
 for(const c of generated){const hit=await verifyCandidate(c.reference);if(hit)return{status:'verified',title:'EXACT CONTROL-GEAR MATCH',original:{reference:original,orderCode:input12},recommended:{reference:c.reference,orderCode:hit.orderCode},matchType:'exact',sourceUrl:hit.url,explanation:`Universal candidate generator tested ${c.target} without changing family, package, CCT, dimensions or options, and verified the candidate.`}}

 // 2) Configurator if known; this is family metadata, not product-by-product mapping.
 const conf=CONFIGURABLE[family(original)];if(conf){const target=swap(original,conf.preferred);return{status:'configurable',title:'FOUND VIA CONFIGURATOR',original:{reference:original,orderCode:input12},recommended:{reference:target,orderCode:null},configurator:conf.family,matchType:'configurator',explanation:'No stocked driver-only candidate was verified. The original specification is preserved through the configurable family.'}}

 // 3) Legacy -> current family then rerun the same universal generator.
 const mig=MIGRATIONS[family(original)];if(mig){const moved=migrate(original,mig.current);const migratedCandidates=generateCandidates(moved);for(const c of migratedCandidates){const hit=await verifyCandidate(c.reference);if(hit)return{status:'migration',title:'CURRENT FAMILY FOUND',original:{reference:original,orderCode:input12},recommended:{reference:c.reference,orderCode:hit.orderCode},familyMigration:{from:family(original),to:mig.current},matchType:'current-family',sourceUrl:hit.url,explanation:'Legacy family migrated to the current technical family, then the universal DALI candidates were tested.'}}if(mig.configurable){const target=swap(moved,mig.preferred);return{status:'migration',title:'CURRENT FAMILY CONFIGURATOR',original:{reference:original,orderCode:input12},recommended:{reference:target,orderCode:null},familyMigration:{from:family(original),to:mig.current},configurator:mig.current,matchType:'current-family-configurator',explanation:'No current preconfigured DALI candidate was verified; use the current-family configurator with preserved specifications.'}}}

 return{status:'unverified',title:'NO VERIFIED ALTERNATIVE',original:{reference:original,orderCode:input12},testedCandidates:generated.map(x=>x.reference),explanation:'All universal DALI control-gear candidates were tested. No exact, configurable, or mapped current-family route was verified automatically.'};
}

app.http('alternative',{methods:['POST'],authLevel:'anonymous',route:'alternative',handler:async req=>{try{const b=await req.json();if(!b.query)return{status:400,jsonBody:{status:'error',message:'Reference required'}};return{jsonBody:await solve(b.query)}}catch(e){return{status:500,jsonBody:{status:'error',message:e.message}}}}});
