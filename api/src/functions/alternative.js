import { app } from "@azure/functions";

const ONOFF = new Set(["PSU", "PSU-E", "PSR"]);
const DALI = ["PSD", "PSD-E", "DIA-E", "PSED", "DIA", "WIA-E"];
const norm = (s = "") => String(s).replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
const words = (s) => norm(s).split(/\s+/).filter(Boolean);
const assignmentMap = (item) => Object.fromEntries((item.assignments || []).map(a => [a.variableName, norm(a.valueName)]));
const prop = (item, name) => (item.properties || []).find(p => p.name === name)?.value || "";
const strip12nc = s => norm(s).replace(/^\d{12,18}\s*[-:]?\s*/, "");
const familyOf = s => words(strip12nc(s)).find(x => /^(?:[A-Z]{1,4}\d{2,4}[A-Z]?)(?:I)?$/.test(x));
const driverOf = s => words(s).find(x => ONOFF.has(x) || DALI.includes(x));
const targetDrivers = driver => ONOFF.has(driver) ? (driver.endsWith("-E") ? ["PSD-E","PSD","DIA-E","PSED","DIA","WIA-E"] : ["PSD","PSD-E","DIA-E","PSED","DIA","WIA-E"]) : ["PSU-E","PSU","PSR"];
const replaceDriver = (s, driver) => driverOf(s) ? strip12nc(s).replace(new RegExp(`\\b${driverOf(s)}\\b`, "i"), driver) : `${strip12nc(s)} ${driver}`;

function parsed(s) {
  const raw = strip12nc(s), t = words(raw);
  return {
    raw, family: familyOf(raw), driver: driverOf(raw),
    pack: (t.find(x => /^(?:LED)?\d+S$/i.test(x)) || "").replace(/^LED/i, ""),
    cct: (t.find(x => /^\d{3}[A-Z]?$/i.test(x)) || "").replace(/[A-Z]$/i, ""),
    optic: t.find(x => ["C","WR","WB","NB","MB","PCS","PCO","PGO"].includes(x)),
    color: t.find(x => ["WH","BK","GR","SI"].includes(x)),
    length: t.find(x => /^L\d+$/i.test(x)),
    tokens: new Set(t)
  };
}
function configuredFamily(item) {
  const a = assignmentMap(item);
  return a.PLM_PFC || a.PLM_PFAM || familyOf(item.description || "") || "";
}
function configuratorName(item) {
  return norm(item.materialName) || norm(item.productModelName).split("_")[0] || configuredFamily(item);
}
function score(input, item, targetSet = null) {
  const a = assignmentMap(item), desc = norm(item.description), gotDriver = a.PLM_TRAFO || driverOf(desc) || "";
  let n = 0, diff = [];
  if (targetSet && targetSet.includes(gotDriver)) n += 35;
  const pairs = [
    ["pack", input.pack, (a.PLM_LAMPFAM || "").replace(/^LED/, ""), 24],
    ["cct", input.cct, (a.PLM_COLLAMP || "").replace(/[A-Z]$/, ""), 22],
    ["optic", input.optic, a.PLM_OPTGRP || "", 12],
    ["color", input.color, a.PLM_CLR || "", 8],
    ["length", input.length, words(desc).find(x => /^L\d+$/.test(x)) || "", 12]
  ];
  for (const [name, want, got, weight] of pairs) {
    if (!want) continue;
    if (got === want) n += weight;
    else if (got) { n -= Math.round(weight * .65); diff.push(`${name}: ${want} -> ${got}`); }
  }
  for (const token of input.tokens) if (desc.includes(token)) n += 1;
  return { score: n, differences: diff, driver: gotDriver };
}
function configurableDescription(original, newFamily, targetDriver) {
  let out = strip12nc(original), oldFamily = familyOf(out), oldDriver = driverOf(out);
  if (oldFamily && newFamily) out = out.replace(new RegExp(`\\b${oldFamily}\\b`, "i"), newFamily);
  if (oldDriver) out = out.replace(new RegExp(`\\b${oldDriver}\\b`, "i"), targetDriver);
  else out += ` ${targetDriver}`;
  // New configurator nomenclature commonly drops LED prefix; keep all requested technical tokens otherwise.
  out = out.replace(/\bLED(\d+S)\b/gi, "$1").replace(/\/930H\b/gi, "/930UE");
  return out;
}

async function safeFetchJson(url, options = {}) {
  const r = await fetch(url, options); const text = await r.text();
  if (!r.ok) return { ok:false, status:r.status, data:null, text };
  if (!text.trim()) return { ok:false, status:r.status, data:null, text:"" };
  try { return { ok:true, status:r.status, data:JSON.parse(text), text }; }
  catch { return { ok:false, status:r.status, data:null, text }; }
}
async function quoteSearch(query) {
  const base = process.env.QUOTE_API_BASE, token = process.env.QUOTE_API_TOKEN;
  if (!base || !token) return { available:false, items:[] };
  const u = new URL("/api/products/search", base);
  Object.entries({query,page:0,pageSize:30,configurable:false,language:"en-GB",salesOrganization:"PT02",distributionChannel:"05",soldTo:"null",shipTo:"null"}).forEach(([k,v]) => u.searchParams.set(k,v));
  const r = await safeFetchJson(u, {headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
  if (!r.ok) return { available:false, items:[], error:`Quote API HTTP ${r.status}` };
  return { available:true, items:r.data?.items || [] };
}

// Small verified cache keeps the previously working behaviour. It is a cache, not family logic.
const VERIFIED = [
  {from:"DN142B 10S/840 PSU-E WR IP54", to:"DN142B 10S/840 PSD-E WR IP54", orderCode:"910505103591"},
  {from:"WT120C G3 60S/840 PSU L1200", to:"WT120C G3 60S/840 PSD L1200", orderCode:"911401838588"},
  {from:"BY120P G6 LED150/UE840 PSU WB", to:"BY120P G6 LED150/840 PSD WB", orderCode:"911401554345"},
  {from:"SM350C 50S/840 PSU PCS L1500 WH", to:"SM350C 50S/840 PSD PCS L1500 WH", orderCode:"910925868386"},
  {from:"WT490C 62S/840 PSU NE WB PI5 L1800", to:"WT490C 80S/840 PSD HE WB PI5 L1800", orderCode:"910925867735"}
];
function cacheFind(query) {
  const q = strip12nc(query);
  for (const x of VERIFIED) {
    if (norm(q) === norm(x.from)) return {status:"VERIFIED MATCH",recommended:x.to,orderCode:x.orderCode,message:"Verified cached result."};
    if (norm(q) === norm(x.to)) return {status:"VERIFIED MATCH",recommended:x.from,orderCode:null,message:"Reverse verified match; original 12NC not stored in cache."};
  }
  return null;
}

async function engine(query) {
  const input = parsed(query);
  if (!input.driver) return {status:"NEEDS REVIEW", message:"No PSU/PSD/DALI driver token was detected in the reference."};
  const targets = targetDrivers(input.driver);

  // A. Live Quote provider when an approved server-side authentication exists.
  const full = await quoteSearch(strip12nc(query));
  if (full.available) {
    const candidates = full.items.filter(i => targets.includes(assignmentMap(i).PLM_TRAFO || driverOf(i.description || "")))
      .map(i => ({i,...score(input,i,targets)})).sort((a,b) => b.score-a.score);
    if (candidates[0] && candidates[0].score >= 70) {
      const b=candidates[0]; return {status:"DIRECT MATCH",recommended:b.i.description,orderCode:(b.i.externalId||"").replace(/^0+/,""),differences:b.differences};
    }

    // B. Exact configurator beats a poorer standard SKU, including a new/current family returned from an old full description.
    const cfg = [...new Map(full.items.filter(i=>i.isConfigurable).map(i=>[configuratorName(i),i])).values()];
    if (cfg.length) {
      const best = cfg.map(i=>({i,family:configuredFamily(i),...score(input,i)})).sort((a,b)=>b.score-a.score)[0];
      const resultDriver = targets.find(x => x.endsWith("-E")) || targets[0];
      return {status:best.family && best.family!==input.family?"NEW-FAMILY CONFIGURABLE MATCH":"SAME-FAMILY CONFIGURABLE MATCH",configurator:configuratorName(best.i),recommended:configurableDescription(query,best.family,resultDriver),orderCode:null,differences:best.differences,message:"Configurable exact/near match takes priority over a poorer standard SKU. Final 12NC is generated by the configurator."};
    }
  }

  // C. Preserve the old working behaviour when live Quote authentication is unavailable.
  const cached = cacheFind(query); if (cached) return cached;

  // D. Universal candidate generator. No per-family DRIVER_HINTS.
  const generated = targets.map(d => replaceDriver(query,d));
  // If the reference is an old/non-live family, the app cannot truthfully name a new family without a data provider.
  return {
    status:"CANDIDATES GENERATED",
    recommended:generated[0], orderCode:null,
    candidates:generated,
    message: full.error ? `${full.error}. Live catalog authentication is unavailable, so the app kept working with the universal candidate generator. Candidate is not claimed as verified.` : "Live catalog authentication is not configured, so the app used the universal candidate generator. Candidate is not claimed as verified."
  };
}

app.http("alternative", {methods:["GET","POST"], authLevel:"anonymous", handler:async(req,ctx)=>{
  try {
    if (req.method === "GET") return {jsonBody:{status:"OK",message:"Alternative API is running"}};
    let body; try { body = await req.json(); } catch { return {status:400,jsonBody:{status:"ERROR",message:"Invalid JSON request body"}}; }
    const q=body?.query; if(!q) return {status:400,jsonBody:{status:"ERROR",message:"query is required"}};
    return {jsonBody:await engine(q)};
  } catch(e) { ctx.error(e); return {status:500,jsonBody:{status:"ERROR",message:e?.message || "Unexpected server error"}}; }
}});
