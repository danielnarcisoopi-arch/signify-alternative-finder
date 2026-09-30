import { app } from "@azure/functions";

const DRIVERS_ONOFF = new Set(["PSU","PSU-E","PSR"]);
const DRIVERS_DALI = ["PSD","PSD-E","DIA-E","PSED","DIA","WIA-E"];
const ATTR = {family:["PLM_PFAM","PLM_PFC"],driver:["PLM_TRAFO"],pack:["PLM_LAMPFAM"],cct:["PLM_COLLAMP"],optic:["PLM_OPTGRP"],cover:["PLM_CVR"],color:["PLM_CLR"],mounting:["PLM_MOUNTING"]};
const norm=s=>(s||"").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim().toUpperCase();
const tokens=s=>norm(s).split(/[\s/]+/).filter(Boolean);
function parse(s){let t=tokens(s), driver=t.find(x=>DRIVERS_ONOFF.has(x)||DRIVERS_DALI.includes(x));return{raw:norm(s),family:t.find(x=>/^[A-Z]{1,4}\d{2,4}[A-Z]?$/.test(x)),driver,pack:t.find(x=>/^(LED)?\d+S$/.test(x))?.replace(/^LED/,""),cct:t.find(x=>/^\d{3}[A-Z]?$/.test(x))?.replace(/[A-Z]$/,""),tokens:new Set(t)}}
function assignmentMap(item){return Object.fromEntries((item.assignments||[]).map(a=>[a.variableName,norm(a.valueName)]))}
function prop(item,n){return (item.properties||[]).find(p=>p.name===n)?.value||""}
function value(item,names){let a=assignmentMap(item);for(const n of names)if(a[n])return a[n];return""}
function configuredFamily(item){return value(item,ATTR.family)||norm(item.description).split(" ")[0]}
function configuratorName(item){return norm(item.materialName)||(norm(item.productModelName).split("_")[0])}
function technicalScore(input,item){let a=assignmentMap(item),d=norm(item.description),score=0,diff=[];
 const wanted={pack:input.pack,cct:input.cct,optic:[...input.tokens].find(x=>["C","WR","WB","PCS","PCO","PGO"].includes(x)),color:[...input.tokens].find(x=>["WH","BK","GR"].includes(x))};
 const got={pack:a.PLM_LAMPFAM,cct:(a.PLM_COLLAMP||"").replace(/[A-Z]$/,""),optic:a.PLM_OPTGRP||a.PLM_CVR,color:a.PLM_CLR};
 for(const [k,w] of Object.entries(wanted)){if(!w)continue;if(got[k]===w)score+=k==="pack"||k==="cct"?20:10;else if(got[k]){score-=k==="pack"||k==="cct"?15:6;diff.push(`${k}: ${w} → ${got[k]}`)}}
 for(const x of input.tokens)if(d.includes(x))score+=1;return{score,diff}}
function desiredDescription(original,newFamily,targetDriver){let p=parse(original),t=tokens(original);if(p.family){let i=t.indexOf(p.family);if(i>=0)t[i]=newFamily}if(p.driver){let i=t.indexOf(p.driver);if(i>=0)t[i]=targetDriver}return t.join(" ").replace(/\bLED(\d+S)\b/g,"$1")}
async function quoteSearch(query,ctx,env){const base=env?.QUOTE_API_BASE||process.env.QUOTE_API_BASE;const token=env?.QUOTE_API_TOKEN||process.env.QUOTE_API_TOKEN;if(!base||!token)return null;const u=new URL("/api/products/search",base);Object.entries({query,page:0,pageSize:30,configurable:false,language:"en-GB",salesOrganization:"PT02",distributionChannel:"05",soldTo:"null",shipTo:"null"}).forEach(([k,v])=>u.searchParams.set(k,v));let r=await fetch(u,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});if(!r.ok)throw new Error(`Catalog API ${r.status}`);return r.json()}
async function engine(query,ctx){let input=parse(query);let directTarget= input.driver&&DRIVERS_ONOFF.has(input.driver)?DRIVERS_DALI[0]:"PSU";
 // Provider deliberately uses approved server-side credentials only. Never browser/user tokens.
 let data=await quoteSearch(query,ctx,null);if(!data)return{status:"AUTH_REQUIRED",message:"Catalog provider is not configured. Configure an approved Quote/Product API authentication method on the server."};
 let items=data.items||[];
 // 1 direct family exact/near variants with opposite driver
 let direct=items.filter(i=>{let dr=value(i,ATTR.driver);return input.driver&&DRIVERS_ONOFF.has(input.driver)?DRIVERS_DALI.includes(dr):DRIVERS_ONOFF.has(dr)}).map(i=>({i,...technicalScore(input,i)})).sort((a,b)=>b.score-a.score);
 if(direct[0]&&direct[0].score>=45)return{status:"DIRECT MATCH",recommended:direct[0].i.description,orderCode:(direct[0].i.externalId||"").replace(/^0+/,""),differences:direct[0].diff};
 // 2 discover configurable models from same search, including current/new families returned for an old full description
 let cfg=[...new Map(items.filter(i=>i.isConfigurable).map(i=>[configuratorName(i),i])).values()];
 if(cfg.length){let ranked=cfg.map(i=>({i,...technicalScore(input,i),family:configuredFamily(i)})).sort((a,b)=>b.score-a.score),best=ranked[0];let target=input.driver&&DRIVERS_ONOFF.has(input.driver)?(value(best.i,ATTR.driver).startsWith("PSD")?"PSD-E":"PSD-E"):"PSU-E";return{status: input.family&&best.family!==input.family?"NEW-FAMILY CONFIGURABLE MATCH":"SAME-FAMILY CONFIGURABLE MATCH",configurator:configuratorName(best.i),recommended:desiredDescription(query,best.family,target),orderCode:null,differences:best.diff,message:"Configurator takes priority over a poorer standard SKU. Validate the generated configuration in the configurator; no 12NC is invented."}}
 // 3 progressively relax query to let catalog reveal current family
 const relaxed=[...input.tokens].filter(x=>!x.match(/^\d{3}[A-Z]?$/)&&!x.match(/^(LED)?\d+S$/)&&x!==input.family).join(" ");
 if(relaxed){let d2=await quoteSearch(relaxed,ctx,null);let c2=(d2?.items||[]).filter(i=>i.isConfigurable);if(c2.length){let best=c2.map(i=>({i,...technicalScore(input,i),family:configuredFamily(i)})).sort((a,b)=>b.score-a.score)[0];return{status:"NEW-FAMILY CONFIGURABLE MATCH",configurator:configuratorName(best.i),recommended:desiredDescription(query,best.family,input.driver&&DRIVERS_ONOFF.has(input.driver)?"PSD-E":"PSU-E"),message:"Current configurable family discovered from product characteristics; validate final configuration in configurator.",differences:best.diff}}}
 if(direct[0])return{status:"CLOSEST STANDARD MATCH",recommended:direct[0].i.description,orderCode:(direct[0].i.externalId||"").replace(/^0+/,""),differences:direct[0].diff};
 return{status:"NO SAFE MATCH",message:"No sufficiently supported direct, configurable, or current-family alternative was found."};}
app.http("alternative",{methods:["POST"],authLevel:"anonymous",handler:async(req,ctx)=>{try{let b=await req.json(),q=b?.query;if(!q)return{status:400,jsonBody:{message:"query is required"}};return{jsonBody:await engine(q,ctx)}}catch(e){ctx.error(e);return{status:500,jsonBody:{status:"ERROR",message:e.message}}}}});
