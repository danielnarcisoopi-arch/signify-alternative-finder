import { app } from "@azure/functions";

const BASE="https://api.microservices.signify.com/api/product/v1/smc/pt_PT/search/facets";
const ONOFF=new Set(["PSU","PSU-E","PSUE","PSR"]),DALI=new Set(["PSD","PSD-E","PSDE","PSD-SR","PSD-SRE","DIA","DIA-E","PSED"]);
const U=s=>String(s||"").replace(/\s+/g," ").trim().toUpperCase();
const family=q=>(U(q).match(/\b[A-Z]{1,4}\d{2,4}[A-Z]?\b/)||[])[0]||"";
const driver=q=>U(q).split(/[\s/]+/).find(x=>ONOFF.has(x)||DALI.has(x))||"";
const parts=q=>{let t=U(q).replace(/^\d{12,18}\s*[-:]?\s*/,"").split(/\s+/);return{family:family(q),driver:driver(q),pack:(t.find(x=>/^(LED)?\d+S$/.test(x))||"").replace(/^LED/,""),cct:(t.find(x=>/^\d{3}[A-Z]*$/.test(x))||"").slice(0,3),length:t.find(x=>/^L\d+$/.test(x))||"",optic:t.find(x=>["C","WR","WB","NB","MB","PCS","PCO","PGO"].includes(x))||"",color:t.find(x=>["WH","BK","GR","SI"].includes(x))||""}};
async function getJson(url){try{let r=await fetch(url),text=await r.text();if(!r.ok||!text.trim())return null;return JSON.parse(text)}catch{return null}}
function mkUrl(filters,size=10){let u=new URL(BASE);u.searchParams.set("page","1");u.searchParams.set("size",String(size));u.searchParams.set("facets","v:category,v:filter_keys");u.searchParams.set("filters",filters);u.searchParams.set("sort","a:rank");u.searchParams.set("enrichData","true");return u}
const ROOT="filter_keys:FK_LP_TIER_B_BETTER;FK_LP_TIER_C_BEST:ALL,category:SMC_CINDOOR_GR;SMC_OCOUTD_GR:ALL";
async function catalogue(filters=ROOT,size=10){return getJson(mkUrl(filters,size))}
function families(j){let map=new Map();for(const f of(j?.facets?.filter_keys||[]))for(const x of(f.data||[])){let m=String(x.value||"").match(/^FK_LP_HOUSING_VARIANT_([A-Z0-9]+)_(.+)$/);if(m&&!map.has(m[1]))map.set(m[1],{family:m[1],raw:m[2],label:m[2].replaceAll("_"," "),count:x.count})}return[...map.values()]}
function facetCount(j,prefix){let n=0;for(const f of(j?.facets?.filter_keys||[]))for(const x of(f.data||[]))if(String(x.value||"").startsWith(prefix))n+=Number(x.count||0);return n}
function filterId(f){return`FK_LP_HOUSING_VARIANT_${f.family}_${f.raw}`}
async function testFamily(f, p, wantDali){let filters=`filter_keys:${filterId(f)}:ALL${wantDali?",filter_keys:FK_LP_DIMMING_CONTROLS_DALI:ALL":",filter_keys:FK_LP_DIMMING_CONTROLS_NO:ALL"}`;let j=await catalogue(filters,10),total=j?.meta?.page?.total_results||0,score=0,reasons=[];
 if(total){score+=35;reasons.push(`${total} produto(s) com controlo alvo`)}
 let label=f.label;
 if(label.includes("LUXSPACE")&&U(p.family).startsWith("DN")){score+=25;reasons.push("mesma gama LuxSpace")}
 if(label.includes("RECESSED")){score+=12;reasons.push("encastrada")}
 if(label.includes("MINI")&&/57\d|56\d/.test(p.family)){score-=12}
 // technical facets available after family/control scoping
 let cct=p.cct?facetCount(j,`FK_LP_COLOR_TEMP_${p.cct.slice(1)}`):0;if(cct){score+=10;reasons.push(`CCT ${p.cct.slice(1)}00K disponível`)}
 let optic=p.optic?facetCount(j,`FK_LP_LIGHT_DISTRIBUTION_${p.optic}`):0;if(optic){score+=8;reasons.push(`ótica ${p.optic} disponível`)}
 return{...f,total,score,reasons}}
async function rankSuccessors(fs,p,wantDali){let prefix=p.family.match(/^[A-Z]+/)?.[0]||"",pool=fs.filter(x=>x.family!==p.family&&(x.family.startsWith(prefix)||x.label.includes("LUXSPACE"))).slice(0,30);let tested=[];for(const f of pool)tested.push(await testFamily(f,p,wantDali));tested=tested.filter(x=>x.total>0).sort((a,b)=>b.score-a.score);return tested}
async function engine(query){let p=parts(query),base=await catalogue();if(!base)return{status:"SOURCE UNAVAILABLE",message:"O catálogo Signify não respondeu. Nenhuma referência foi criada."};let fs=families(base),cur=fs.find(x=>x.family===p.family);if(!p.family)return{status:"NEEDS REVIEW",message:"Família não identificada."};if(!p.driver)return{status:"NEEDS REVIEW",message:"Driver PSU/PSD não identificado."};let wantDali=ONOFF.has(p.driver);
 if(cur){let v=await testFamily(cur,p,wantDali);return{status:v.total?"ALTERNATIVE EXISTS IN CURRENT FAMILY":"NO VERIFIED ALTERNATIVE",currentFamily:cur.family,familyLabel:cur.label,target:wantDali?"DALI / PSD":"ON/OFF / PSU",totalCompatible:v.total,reasons:v.reasons,message:v.total?"A família é atual e o catálogo confirma produtos desta mesma família com o controlo alternativo. A referência concreta/12NC continua bloqueada até termos o endpoint de resultados/SKU ou validação do configurador.":"A família é atual, mas o catálogo não confirmou produtos com o controlo alternativo."}}
 let ranked=await rankSuccessors(fs,p,wantDali),best=ranked[0];if(!best)return{status:"OLD / NON-CURRENT FAMILY",oldFamily:p.family,message:"A família já não aparece no catálogo atual e não foi possível confirmar uma família atual compatível."};let lead=ranked[1];let confident=!lead||best.score-lead.score>=8;return{status:confident?"CURRENT FAMILY MATCH FOUND":"CURRENT FAMILY CANDIDATE",oldFamily:p.family,currentFamily:best.family,familyLabel:best.label,target:wantDali?"DALI / PSD":"ON/OFF / PSU",totalCompatible:best.total,reasons:best.reasons,confidence:confident?"HIGH":"REVIEW",message:confident?"Foi selecionada automaticamente a família atual com melhor correspondência entre as famílias que o catálogo confirma com o controlo alvo. A referência final continua bloqueada até validação SKU/configurador.":"Foi encontrada uma família atual provável, mas a diferença para o segundo candidato não é suficiente para assumir sucessão sem validação adicional."}}
app.http("alternative",{methods:["GET","POST"],authLevel:"anonymous",handler:async req=>{if(req.method==="GET")return{jsonBody:{status:"OK",source:"Signify current catalogue",mode:"verified-only"}};let b;try{b=await req.json()}catch{return{status:400,jsonBody:{status:"ERROR",message:"JSON inválido"}}}return{jsonBody:await engine(b?.query||"")}}});
