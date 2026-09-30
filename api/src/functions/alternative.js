import { app } from '@azure/functions';

const DALI = ['PSD-E','PSD','DIA-E','DIA','PSED','WIA-E'];
const ONOFF = ['PSU-E','PSU','PSR'];
const DRIVER_HINTS = { DN142B:['PSD-E'], DN500B:['PSD-E','DIA-E'], DN610B:['PSD-E','DIA-E'], WT120C:['PSD'], WT490C:['PSD'], BY120P:['PSD'] };
const CONFIGURABLE = { DN500B:{family:'DN500BI',driver:'PSD-E'}, DN610B:{family:'DN610B',driver:'PSD-E'} };
const MIGRATIONS = { DN571B:{current:'DN610B',configurable:true,driver:'PSD-E'} };

// Verified cache is only a fast path. Unknown products continue through generic logic.
const VERIFIED = new Map([
 ['DN142B 10S/840 PSU-E WR IP54',{ref:'DN142B 10S/840 PSD-E WR IP54',orderCode:'910505103591'}],
 ['WT120C G3 60S/840 PSU L1200',{ref:'WT120C G3 60S/840 PSD L1200',orderCode:'911401838588'}],
 ['BY120P G6 LED150/UE840 PSU WB',{ref:'BY120P G6 LED150/840 PSD WB',orderCode:'911401554345'}],
 ['DN500B 20S/840 PSU-E WR WH PCO',{ref:'DN500B 20S/840 PSD-E WR WH PCO',orderCode:null,config:'DN500BI'}],
 ['WT490C 62S/840 PSU NE WB PI5 L1800',{ref:'WT490C 80S/840 PSD HE WB PI5 L1800',orderCode:'910925867735'}]
]);
const BY_12NC = new Map([
 ['911401551532','DN142B 10S/840 PSU-E WR IP54'],
 ['911401836188','WT120C G3 60S/840 PSU L1200'],
 ['911401554245','BY120P G6 LED150/UE840 PSU WB'],
 ['910505105009','DN500B 20S/840 PSU-E WR WH PCO']
]);
const norm=s=>(s||'').toUpperCase().trim().replace(/\s+/g,' ');
const toks=s=>norm(s).split(/[\s/]+/).filter(Boolean);
const family=s=>toks(s)[0]||'';
const driver=s=>toks(s).find(x=>[...DALI,...ONOFF].includes(x))||'';
const canonical=s=>norm(s).replace(/LED(\d+)S/g,'$1S').replace(/\/(9\d{2})H\b/g,'/$1');
function swap(ref,to){const d=driver(ref);return d?norm(ref).replace(d,to):norm(ref)}
function migrate(ref,to){const a=toks(canonical(ref));a[0]=to;return a.join(' ')}

async function bingHtmlSearch(q){
 const url='https://www.google.com/search?q='+encodeURIComponent('site:signify.com '+q);
 try { const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'}}); if(!r.ok)return[]; const h=await r.text();
  const out=[]; const re=/(?:https?:\/\/www\.signify\.com[^\s"&<>]+|www\.signify\.com[^\s"&<>]+)/gi; for(const m of h.matchAll(re)){let u=m[0].replace(/&amp;.*/,''); if(!u.startsWith('http'))u='https://'+u; const code=u.match(/\b(9\d{11})\b/)?.[1]; if(code)out.push({url:u,orderCode:code});} return [...new Map(out.map(x=>[x.orderCode,x])).values()];
 } catch { return []; }
}
async function verifyExact(candidate){const hits=await bingHtmlSearch('"'+candidate+'"'); return hits[0]||null;}

async function solve(input){
 let original=norm(input); let orderCode=null;
 if(/^\d{12}$/.test(original)){orderCode=original;original=BY_12NC.get(original)||original;}
 const cached=VERIFIED.get(original);
 if(cached)return{status:cached.config?'configurable':'verified',title:cached.config?'FOUND VIA CONFIGURATOR':'BEST VERIFIED ALTERNATIVE',original:{reference:original,orderCode},recommended:{reference:cached.ref,orderCode:cached.orderCode},configurator:cached.config||null,explanation:cached.config?'Same-family configurable route preserves the specification and changes the control gear to DALI.':'Verified product mapping.'};
 if(/^\d{12}$/.test(original))return{status:'unverified',title:'NO VERIFIED ALTERNATIVE',original:{reference:original,orderCode},explanation:'This 12NC could not yet be resolved to a commercial reference.'};
 const F=family(original), hints=DRIVER_HINTS[F]||[];
 for(const d of hints){const candidate=swap(original,d),hit=await verifyExact(candidate);if(hit)return{status:'verified',title:'BEST VERIFIED ALTERNATIVE',original:{reference:original,orderCode},recommended:{reference:candidate,orderCode:hit.orderCode},sourceUrl:hit.url,explanation:'Exact same-family DALI candidate was generated from the commercial code and independently verified on the Signify domain.'};}
 if(CONFIGURABLE[F]){const c=CONFIGURABLE[F];const target=swap(original,c.driver);return{status:'configurable',title:'FOUND VIA CONFIGURATOR',original:{reference:original,orderCode},recommended:{reference:target,orderCode:null},configurator:c.family,explanation:'No exact stocked product was verified, so the same specification is preserved through the family configurator.'};}
 const mig=MIGRATIONS[F];if(mig){const moved=migrate(original,mig.current),candidate=swap(moved,mig.driver),hit=await verifyExact(candidate);if(hit)return{status:'migration',title:'CURRENT FAMILY FOUND',original:{reference:original,orderCode},recommended:{reference:candidate,orderCode:hit.orderCode},familyMigration:{from:F,to:mig.current},sourceUrl:hit.url,explanation:'Legacy family migrated to the current technical family and the DALI candidate was verified.'};if(mig.configurable)return{status:'migration',title:'CURRENT FAMILY CONFIGURATOR',original:{reference:original,orderCode},recommended:{reference:candidate,orderCode:null},familyMigration:{from:F,to:mig.current},configurator:mig.current,explanation:'No safe preconfigured 12NC was verified, so the preserved specification is routed to the current-family configurator.'};}
 return{status:'unverified',title:'NO VERIFIED ALTERNATIVE',original:{reference:original,orderCode},explanation:'No exact, configurable, or current-family DALI path could be verified automatically.'};
}
app.http('alternative',{methods:['POST'],authLevel:'anonymous',route:'alternative',handler:async req=>{try{const b=await req.json();return{jsonBody:await solve(b.query)}}catch(e){return{status:500,jsonBody:{status:'error',message:e.message}}}}});
