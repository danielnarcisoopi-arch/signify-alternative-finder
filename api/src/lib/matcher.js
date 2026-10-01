import { displayControl, normalizeText, parseReference } from "./normalization.js";

function valuePresent(value) {
  return value !== null && value !== undefined && value !== "";
}

function normalizeComparable(value) {
  return normalizeText(value).replace(/[\s_-]+/g, "");
}

function addComparison(state, {
  field,
  expected,
  actual,
  points,
  penalty = points,
  critical = false,
  allowDifference = false,
  normalize = normalizeComparable,
}) {
  if (!valuePresent(expected)) return;
  if (!valuePresent(actual)) {
    state.score -= penalty;
    state.changes.push({ field, from: String(expected), to: "Não especificado", severity: critical ? "critical" : "warning" });
    if (critical && !allowDifference) state.blockers.push(`${field} is missing from the candidate.`);
    return;
  }
  if (normalize(expected) === normalize(actual)) {
    state.score += points;
    state.preserved.push(`${field}: ${expected}`);
    return;
  }
  state.score -= penalty;
  state.changes.push({ field, from: String(expected), to: String(actual), severity: critical && !allowDifference ? "critical" : "warning" });
  if (critical && !allowDifference) state.blockers.push(`${field} changes from ${expected} to ${actual}.`);
}

function expectedModel(parsed, originalProduct) {
  const productParsed = originalProduct?.parsed || {};
  return {
    ...productParsed,
    ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => valuePresent(value) && !(Array.isArray(value) && value.length === 0))),
    luminousFlux: originalProduct?.luminousFlux ?? null,
    power: originalProduct?.power ?? null,
    category: originalProduct?.category || "",
    mounting: originalProduct?.mounting || "",
    dimensions: originalProduct?.dimensions || "",
  };
}

function candidateModel(product) {
  const parsed = product?.parsed || parseReference(product?.description || "");
  return {
    ...parsed,
    luminousFlux: product?.luminousFlux ?? null,
    power: product?.power ?? null,
    category: product?.category || "",
    mounting: product?.mounting || "",
    dimensions: product?.dimensions || "",
  };
}

function compareFlux(state, expected, actual) {
  if (!valuePresent(expected)) return;
  if (!valuePresent(actual) || Number(actual) <= 0) {
    state.changes.push({ field: "Fluxo luminoso", from: `${expected} lm`, to: "Não especificado", severity: "warning" });
    state.score -= 15;
    return;
  }
  const difference = Math.abs(Number(actual) - Number(expected)) / Number(expected);
  if (difference <= 0.03) {
    state.score += 60;
    state.preserved.push(`Fluxo luminoso: ${actual} lm`);
  } else {
    state.score += Math.max(-50, Math.round(30 - difference * 120));
    state.changes.push({ field: "Fluxo luminoso", from: `${expected} lm`, to: `${actual} lm`, severity: "warning" });
  }
}

function compareFeatures(state, expected, actual) {
  const actualSet = new Set((actual || []).map(normalizeComparable));
  for (const feature of expected || []) {
    if (actualSet.has(normalizeComparable(feature))) {
      state.score += 14;
      state.preserved.push(feature);
    } else {
      state.score -= 25;
      state.changes.push({ field: "Característica", from: feature, to: "Ausente na referência candidata", severity: "critical" });
      state.blockers.push(`Required feature ${feature} is not preserved.`);
    }
  }
}

export function assessCandidate(parsedInput, candidate, {
  originalProduct = null,
  targetControlClass = parsedInput.targetControlClass,
  allowFamilyChange = false,
  verified = false,
  requires12nc = true,
} = {}) {
  const expected = expectedModel(parsedInput, originalProduct);
  const actual = candidateModel(candidate);
  const state = { score: 0, changes: [], preserved: [], blockers: [] };

  if (candidate.controlClass !== targetControlClass) {
    state.blockers.push(`Candidate control is ${displayControl(candidate.controlClass)}, not ${displayControl(targetControlClass)}.`);
  } else {
    state.score += 120;
    state.preserved.push(`Controlo de destino: ${displayControl(targetControlClass)}`);
  }

  const sameFamily = normalizeComparable(expected.family) === normalizeComparable(actual.family) && Boolean(expected.family);
  if (sameFamily) {
    state.score += 120;
    state.preserved.push(`Família: ${expected.family}`);
  } else if (!allowFamilyChange) {
    state.score -= 150;
    state.blockers.push(`Product family changes from ${expected.family || "unknown"} to ${actual.family || "unknown"}.`);
    state.changes.push({ field: "Família", from: expected.family || "Desconhecida", to: actual.family || "Desconhecida", severity: "critical" });
  } else {
    state.changes.push({ field: "Família", from: expected.family || "Desconhecida", to: actual.family || "Desconhecida", severity: "warning" });
  }

  addComparison(state, { field: "Geração", expected: expected.generation, actual: actual.generation, points: 70, penalty: 90, critical: true });
  addComparison(state, { field: "Pacote luminoso", expected: expected.packageCanonical, actual: actual.packageCanonical, points: 85, penalty: 45, critical: true, allowDifference: true });
  addComparison(state, { field: "CRI/CCT", expected: expected.colorCode, actual: actual.colorCode, points: 80, penalty: 110, critical: true });
  addComparison(state, { field: "Comprimento", expected: expected.length, actual: actual.length, points: 65, penalty: 80, critical: true });
  addComparison(state, { field: "IP", expected: expected.ip, actual: actual.ip, points: 35, penalty: 60, critical: true });
  addComparison(state, { field: "IK", expected: expected.ik, actual: actual.ik, points: 25, penalty: 45, critical: true });
  addComparison(state, { field: "Designação de eficiência", expected: expected.efficiency, actual: actual.efficiency, points: 20, penalty: 10, allowDifference: true });
  addComparison(state, { field: "Sufixo de qualidade da luz", expected: expected.colorSuffix, actual: actual.colorSuffix, points: 15, penalty: 8, allowDifference: true });
  compareFeatures(state, expected.features, actual.features);
  compareFlux(state, expected.luminousFlux, actual.luminousFlux);

  if (allowFamilyChange) {
    addComparison(state, { field: "Categoria", expected: expected.category, actual: actual.category, points: 70, penalty: 100, critical: true });
    addComparison(state, { field: "Montagem", expected: expected.mounting, actual: actual.mounting, points: 60, penalty: 90, critical: true });
    addComparison(state, { field: "Dimensões/recorte", expected: expected.dimensions, actual: actual.dimensions, points: 70, penalty: 100, critical: true });
  }

  if (requires12nc && !candidate.is12nc) state.blockers.push("Candidate does not contain a verified 12NC.");
  if (!verified) state.blockers.push("Candidate has not passed an exact Product API order-code lookup.");

  const directChanges = state.changes.filter((change) => change.field !== "Designação de eficiência" || change.to !== "Não especificado");
  const relaxedTechnicalChange = state.changes.some((change) => ["Pacote luminoso", "Fluxo luminoso"].includes(change.field));
  let resultType = "CLOSEST_VERIFIED_TECHNICAL_MATCH";
  if (sameFamily && directChanges.length === 0) resultType = "DIRECT_VERIFIED_MATCH";
  else if (sameFamily && state.blockers.length === 0 && !relaxedTechnicalChange && !state.changes.some((change) => change.severity === "critical")) resultType = "SAME_FAMILY_VERIFIED_MATCH";
  else if (!sameFamily && state.blockers.length === 0) resultType = "CURRENT_FAMILY_VERIFIED_MATCH";

  return {
    candidate,
    score: state.score,
    changes: state.changes,
    preserved: [...new Set(state.preserved)],
    blockers: [...new Set(state.blockers)],
    sameFamily,
    safeToRecommend: state.blockers.length === 0,
    resultType,
  };
}

export function canValidateFamilyMigration(parsedInput, originalProduct, candidate) {
  if (!originalProduct || !candidate) return false;
  const explicitReplacement = [
    originalProduct.raw?.successor_family_id,
    originalProduct.raw?.replacement_family_id,
    originalProduct.raw?.replaced_by,
    originalProduct.raw?.successor,
  ].some((value) => normalizeText(JSON.stringify(value || "")).includes(normalizeText(candidate.family)));
  if (explicitReplacement) return true;

  const expected = expectedModel(parsedInput, originalProduct);
  const actual = candidateModel(candidate);
  return Boolean(
    expected.category && actual.category && normalizeComparable(expected.category) === normalizeComparable(actual.category)
    && expected.mounting && actual.mounting && normalizeComparable(expected.mounting) === normalizeComparable(actual.mounting)
    && expected.dimensions && actual.dimensions && normalizeComparable(expected.dimensions) === normalizeComparable(actual.dimensions)
  );
}

export function rankCandidates(parsedInput, candidates, options = {}) {
  return candidates
    .map((candidate) => assessCandidate(parsedInput, candidate, options))
    .sort((left, right) => right.score - left.score);
}
