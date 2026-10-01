import { controlSearchTerms, normalizeText, parseReference } from "./normalization.js";
import { familyCodeFromConfiguratorId } from "./product-api.js";

const GENERIC_FAMILY_WORDS = new Set([
  "PHILIPS",
  "SIGNIFY",
  "LED",
  "LUMINAIRE",
  "LUMINAIRES",
  "LIGHT",
  "LIGHTING",
  "RECESSED",
  "SURFACE",
  "MOUNTED",
  "SUSPENDED",
  "PROJECTOR",
  "DOWNLIGHT",
  "GEN",
  "GENERATION",
  "FAMILY",
  "RANGE",
]);

function familyPrefix(value) {
  return (normalizeText(value).match(/^[A-Z]+/) || [""])[0];
}

function familyNameTokens(value) {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_FAMILY_WORDS.has(token) && !/^G\d+$/.test(token));
}

function nameSimilarity(left, right) {
  const leftTokens = new Set(familyNameTokens(left));
  const rightTokens = new Set(familyNameTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function normalizedComparable(value) {
  return normalizeText(value).replace(/[\s_/-]+/g, "");
}

function sameValue(left, right) {
  return Boolean(left && right && normalizedComparable(left) === normalizedComparable(right));
}

function technicalSimilarity(parsed, product) {
  const candidate = product?.parsed || parseReference(product?.description || "");
  let score = 0;
  let comparable = 0;
  const compare = (expected, actual, points) => {
    if (!expected) return;
    comparable += 1;
    if (sameValue(expected, actual)) score += points;
  };

  if (product?.controlClass === parsed.targetControlClass) score += 35;
  compare(parsed.packageCanonical, candidate.packageCanonical, 45);
  compare(parsed.colorCode, candidate.colorCode, 45);
  compare(parsed.generation, candidate.generation, 25);
  compare(parsed.length, candidate.length, 30);
  compare(parsed.ip, candidate.ip, 20);
  compare(parsed.ik, candidate.ik, 15);

  const candidateFeatures = new Set((candidate.features || []).map(normalizedComparable));
  for (const feature of parsed.features || []) {
    comparable += 1;
    if (candidateFeatures.has(normalizedComparable(feature))) score += 14;
  }
  return { score, comparable };
}

function explicitSuccessorEvidence(legacyFamily, candidateCode) {
  if (!legacyFamily?.raw || !candidateCode) return false;
  const relevant = Object.entries(legacyFamily.raw)
    .filter(([key]) => /successor|replacement|replaced|new.family|current.family/i.test(key))
    .map(([, value]) => value);
  return normalizeText(JSON.stringify(relevant)).includes(normalizeText(candidateCode));
}

function mergeFamily(group, family) {
  if (!group.family || (!group.family.name && family.name)) group.family = { ...group.family, ...family };
  else {
    group.family = {
      ...family,
      ...group.family,
      name: group.family.name || family.name,
      configuratorId: group.family.configuratorId || family.configuratorId,
      configuratorSeed: group.family.configuratorSeed || family.configuratorSeed,
    };
  }
  if (family.source?.query) group.queries.add(family.source.query);
}

function groupEvidence(families, products) {
  const groups = new Map();
  const get = (code) => {
    const key = normalizeText(code);
    if (!key) return null;
    if (!groups.has(key)) groups.set(key, { code: key, family: null, products: [], queries: new Set() });
    return groups.get(key);
  };

  for (const family of families) {
    const group = get(family.code);
    if (group) mergeFamily(group, family);
  }
  for (const product of products) {
    const attach = (code, evidenceProduct = product) => {
      const group = get(code);
      if (!group) return;
      group.products.push(evidenceProduct);
      if (!group.family) {
        group.family = {
          raw: product.raw,
          id: product.familyIds?.[0] || "",
          code: normalizeText(code),
          name: product.familyName,
          configuratorId: product.configuratorId,
          configuratorSeed: product.configuratorSeed,
          category: product.category,
          mounting: product.mounting,
          dimensions: product.dimensions,
          url: product.url,
          source: product.source,
        };
      }
      if (product.source?.query) group.queries.add(product.source.query);
    };

    attach(product.family);

    // A configurable-material ID is itself official family evidence. Some API
    // payloads describe the legacy/seed product while materialName or
    // productModelName already points at the current configurable material.
    // Add that family as a separate candidate instead of discarding the clue.
    const configuratorFamily = familyCodeFromConfiguratorId(product.configuratorId);
    if (configuratorFamily && normalizeText(configuratorFamily) !== normalizeText(product.family)) {
      attach(configuratorFamily, {
        ...product,
        family: configuratorFamily,
        parsed: parseReference(`${configuratorFamily} ${product.description || ""}`),
      });
    }
  }
  return [...groups.values()];
}

function rankGroups(parsed, legacyFamily, groups) {
  const oldCode = normalizeText(parsed.family || legacyFamily?.code);
  const oldPrefix = familyPrefix(oldCode);
  const oldName = legacyFamily?.name || "";
  return groups
    .filter((group) => group.code !== oldCode)
    .map((group) => {
      const samePrefix = Boolean(oldPrefix && familyPrefix(group.code) === oldPrefix);
      const familySimilarity = nameSimilarity(oldName, group.family?.name);
      const explicit = explicitSuccessorEvidence(legacyFamily, group.code);
      const technical = group.products.reduce((best, product) => {
        const result = technicalSimilarity(parsed, product);
        return result.score > best.score ? { ...result, product } : best;
      }, { score: 0, comparable: 0, product: null });
      const hasConfigurator = Boolean(group.family?.configuratorId || group.products.some((product) => product.configuratorId));
      const queryEvidence = group.queries.size;
      // A configurable family returned by the official Product API for the exact,
      // complete user reference is strong migration evidence. This is generic:
      // no family/configurator identifiers are encoded here.
      const exactInputEvidence = [...group.queries].some((query) => normalizeText(query) === normalizeText(parsed.input));
      const score = (explicit ? 300 : 0)
        + (exactInputEvidence && hasConfigurator ? 180 : 0)
        + (samePrefix ? 70 : 0)
        + Math.round(familySimilarity * 140)
        + technical.score
        + (hasConfigurator ? 15 : 0)
        + Math.min(45, queryEvidence * 15)
        + Math.min(20, group.products.length * 3);
      const validated = explicit
        || (exactInputEvidence && hasConfigurator && samePrefix)
        || (familySimilarity >= 0.75 && technical.score >= 35)
        || (samePrefix && familySimilarity >= 0.5 && technical.score >= 70)
        || (samePrefix && familySimilarity >= 0.9 && Boolean(group.family?.name))
        || (samePrefix && !oldName && technical.score >= 100 && technical.comparable >= 4)
        || (samePrefix && !oldName && hasConfigurator && queryEvidence >= 2);
      return {
        ...group,
        samePrefix,
        nameSimilarity: familySimilarity,
        technicalScore: technical.score,
        technicalComparable: technical.comparable,
        bestTechnicalProduct: technical.product,
        explicitSuccessor: explicit,
        hasConfigurator,
        queryEvidence,
        exactInputEvidence,
        score,
        validated,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function buildQueries(parsed, legacyFamily) {
  const targetTerms = controlSearchTerms(parsed.targetControlClass, parsed.driver);
  const familyTerms = familyNameTokens(legacyFamily?.name).slice(0, 3);
  const technical = [parsed.package, parsed.colorCode, parsed.length, ...(parsed.features || []).slice(0, 4)];
  const structuralPrefix = familyPrefix(parsed.family || legacyFamily?.code);
  const queries = [
    // Always ask the official catalogue the complete reference first. The API
    // may directly associate a legacy reference with its current configurable family.
    [parsed.input],
    [...familyTerms, ...technical, targetTerms[0]],
    [...familyTerms, parsed.package, parsed.colorCode, targetTerms[1] || targetTerms[0]],
    [parsed.package, parsed.colorCode, parsed.length, ...(parsed.features || []), targetTerms[0]],
    [parsed.packageCanonical || parsed.package, ...(parsed.features || []), "DALI"],
    [structuralPrefix, parsed.packageCanonical || parsed.package, parsed.length, "DALI"],
    [...(parsed.features || []), "DALI"],
  ]
    .map((parts) => parts.filter(Boolean).join(" ").trim())
    .filter((query) => query.split(/\s+/).length >= 2);
  return [...new Set(queries)];
}

export function configuratorCarrier(rankedFamily) {
  const family = rankedFamily?.family;
  const productWithConfigurator = rankedFamily?.products?.find((product) => product.configuratorId);
  if (productWithConfigurator) return productWithConfigurator;
  if (!family?.configuratorId) return null;
  return {
    raw: family.raw,
    description: family.code,
    orderCode: "",
    is12nc: false,
    family: family.code,
    familyIds: family.id ? [family.id] : [],
    familyName: family.name,
    configuratorId: family.configuratorId,
    configuratorSeed: family.configuratorSeed || null,
    url: family.url,
    category: family.category,
    mounting: family.mounting,
    dimensions: family.dimensions,
    parsed: parseReference(family.code),
    controlClass: "UNKNOWN",
    source: family.source,
  };
}


function diagnosticRecursiveValues(value, keyPattern, results = []) {
  if (Array.isArray(value)) { value.forEach((entry) => diagnosticRecursiveValues(entry, keyPattern, results)); return results; }
  if (!value || typeof value !== "object") return results;
  for (const [key, entry] of Object.entries(value)) {
    if (keyPattern.test(key)) results.push(entry);
    diagnosticRecursiveValues(entry, keyPattern, results);
  }
  return results;
}

function diagnosticProduct(product) {
  if (!product) return null;
  const raw = product.raw || {};
  const assignments = diagnosticRecursiveValues(raw, /assignments|existingAssignments/i)
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((assignment) => {
      const variable = normalizeText(assignment?.variableName || assignment?.name || assignment?.characteristic || "");
      return /(?:^|_)(?:PLM_)?PFC$|(?:^|_)(?:PLM_)?PFAM$|(?:^|_)(?:PLM_)?TRAFO$|(?:^|_)(?:PLM_)?LAMPFAM$|(?:^|_)(?:PLM_)?COLLAMP$/.test(variable);
    })
    .slice(0, 12)
    .map((assignment) => ({
      variableName: assignment?.variableName || assignment?.name || assignment?.characteristic || "",
      valueName: assignment?.valueName || assignment?.value || assignment?.valueText || "",
    }));
  return {
    query: product.source?.query || "",
    description: product.description || "",
    materialName: raw.materialName || raw.material_name || "",
    productModelName: raw.productModelName || raw.product_model_name || "",
    isConfigurable: raw.isConfigurable ?? raw.is_configurable ?? null,
    parsedFamily: product.parsed?.family || "",
    extractedFamily: product.family || "",
    configuratorId: product.configuratorId || "",
    familyFromConfigurator: familyCodeFromConfiguratorId(product.configuratorId),
    controlClass: product.controlClass || "UNKNOWN",
    assignments,
  };
}

function discoveryDiagnostics(ranked, queries) {
  return {
    queries,
    candidates: ranked.slice(0, 12).map((candidate) => ({
      code: candidate.code,
      score: candidate.score,
      validated: candidate.validated,
      samePrefix: candidate.samePrefix,
      hasConfigurator: candidate.hasConfigurator,
      exactInputEvidence: candidate.exactInputEvidence,
      queryEvidence: candidate.queryEvidence,
      nameSimilarity: candidate.nameSimilarity,
      technicalScore: candidate.technicalScore,
      technicalComparable: candidate.technicalComparable,
      configuratorId: candidate.family?.configuratorId || candidate.products.find((p) => p.configuratorId)?.configuratorId || "",
      products: candidate.products.slice(0, 5).map(diagnosticProduct),
    })),
  };
}

export async function discoverSuccessorFamilies(productClient, parsed, legacyFamily) {
  const effectiveLegacyFamily = legacyFamily || { code: parsed.family, name: "", raw: null };
  const queries = buildQueries(parsed, effectiveLegacyFamily);
  if (!queries.length) return { validated: false, reason: "INSUFFICIENT_TECHNICAL_SIGNATURE", candidates: [], queries: [] };

  const tasks = [];
  for (const query of queries) {
    tasks.push(productClient.searchProducts({ query, controlClass: parsed.targetControlClass, maxPages: 3 }));
    if (typeof productClient.searchFacets === "function") tasks.push(productClient.searchFacets({ query, controlClass: parsed.targetControlClass }));
  }
  const settled = await Promise.allSettled(tasks);
  const successful = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  if (!successful.length && settled.length) throw settled[0].reason;
  const products = successful.flatMap((value) => value.products || []);
  const families = successful.flatMap((value) => value.families || []);
  const ranked = rankGroups(parsed, effectiveLegacyFamily, groupEvidence(families, products));
  // A unique configurable family returned by the official Product API for the
  // exact, complete user reference is direct discovery evidence. Do not let
  // broader relaxed searches make that result ambiguous merely because they
  // also return technically similar families. This remains fully data-driven.
  const exactInputCandidates = ranked.filter((candidate) =>
    candidate.exactInputEvidence && candidate.hasConfigurator && candidate.samePrefix && candidate.validated
  );
  const top = exactInputCandidates.length === 1 ? exactInputCandidates[0] : ranked[0];
  const runnerUp = ranked.find((candidate) => candidate !== top);
  const uniqueExactInput = exactInputCandidates.length === 1 && top === exactInputCandidates[0];
  const sufficientMargin = uniqueExactInput || !runnerUp || top.score - runnerUp.score >= 20 || top.explicitSuccessor;
  const validated = Boolean(top?.validated && sufficientMargin);
  return {
    validated,
    reason: !top ? "NO_CURRENT_FAMILY_CANDIDATE" : !top.validated ? "SUCCESSOR_EVIDENCE_TOO_WEAK" : !sufficientMargin ? "SUCCESSOR_CANDIDATES_AMBIGUOUS" : "SUCCESSOR_DISCOVERED",
    candidate: validated ? top : null,
    candidates: ranked,
    queries,
    diagnostics: discoveryDiagnostics(ranked, queries),
    evidence: validated ? {
      oldFamily: parsed.family || legacyFamily.code,
      currentFamily: top.code,
      oldFamilyName: legacyFamily.name || null,
      currentFamilyName: top.family?.name || null,
      explicitSuccessor: top.explicitSuccessor,
      sameStructuralPrefix: top.samePrefix,
      nameSimilarity: top.nameSimilarity,
      technicalScore: top.technicalScore,
      technicalComparable: top.technicalComparable,
      queryEvidence: top.queryEvidence,
      exactInputEvidence: top.exactInputEvidence,
      discoveryScore: top.score,
      discoveryMode: top.explicitSuccessor || top.nameSimilarity > 0
        ? "FAMILY_METADATA_AND_TECHNICAL_SIGNATURE"
        : "UNIQUE_TECHNICAL_SIGNATURE",
      source: "Signify Product API family metadata and technical search",
    } : null,
  };
}
