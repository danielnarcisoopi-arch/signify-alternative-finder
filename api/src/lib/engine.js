import { ConfiguratorApiClient, ConfiguratorApiError } from "./configurator-api.js";
import { assessCandidate, canValidateFamilyMigration, rankCandidates } from "./matcher.js";
import { controlSearchTerms, displayControl, normalizeText, oppositeControl, parseReference } from "./normalization.js";
import { ProductApiClient, ProductApiError } from "./product-api.js";
import { configuratorCarrier, discoverSuccessorFamilies } from "./successor-discovery.js";

const RESULT_LABELS = {
  DIRECT_VERIFIED_MATCH: "Direct verified match",
  SAME_FAMILY_VERIFIED_MATCH: "Same-family verified match",
  CLOSEST_VERIFIED_TECHNICAL_MATCH: "Closest verified technical match",
  CURRENT_FAMILY_VERIFIED_MATCH: "Current-family verified match",
  VERIFIED_CONFIGURABLE_PRODUCT: "Verified configurable product",
  NO_VERIFIED_ALTERNATIVE: "No verified alternative",
  SOURCE_UNAVAILABLE: "Source unavailable",
  NEEDS_REVIEW: "Input needs review",
};

function deduplicate(products) {
  const seen = new Set();
  return products.filter((product) => {
    const key = product.orderCode || `${product.description}|${product.family}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function productSummary(product) {
  if (!product) return null;
  return {
    description: product.description,
    orderCode: product.is12nc ? product.orderCode : null,
    productCode: product.orderCode || null,
    family: product.family || null,
    control: displayControl(product.controlClass),
    configuratorId: product.configuratorId || null,
    productUrl: product.url || null,
    market: product.market || null,
    lifecycleStatus: product.status || null,
  };
}

function compactAssessment(assessment) {
  return {
    description: assessment.candidate.description,
    orderCode: assessment.candidate.is12nc ? assessment.candidate.orderCode : null,
    family: assessment.candidate.family,
    score: assessment.score,
    resultType: assessment.resultType,
    changes: assessment.changes,
    productUrl: assessment.candidate.url || null,
  };
}

function standardResponse(parsed, originalProduct, assessment, alternatives = [], familyMigration = null) {
  const candidate = assessment.candidate;
  const compatibility = assessment.resultType === "DIRECT_VERIFIED_MATCH"
    ? "DIRECT"
    : assessment.resultType === "CLOSEST_VERIFIED_TECHNICAL_MATCH"
      ? "CLOSEST"
      : assessment.resultType === "CURRENT_FAMILY_VERIFIED_MATCH" ? "CURRENT_FAMILY" : "SAME_FAMILY";
  return {
    status: assessment.resultType,
    statusLabel: RESULT_LABELS[assessment.resultType],
    resultType: assessment.resultType,
    compatibility,
    original: originalProduct ? productSummary(originalProduct) : {
      input: parsed.input,
      description: parsed.reference || parsed.input,
      orderCode: parsed.orderCode || null,
      family: parsed.family || null,
      control: displayControl(parsed.controlClass),
    },
    recommended: productSummary(candidate),
    currentFamily: candidate.family || null,
    familyMigration,
    score: assessment.score,
    changes: assessment.changes,
    preserved: assessment.preserved,
    validation: {
      verified: true,
      source: "Signify Product API",
      method: familyMigration
        ? "Família atual descoberta por metadados oficiais e produto confirmado por pesquisa exata pelo 12NC"
        : "Pesquisa exata pelo 12NC após comparação técnica",
      locale: candidate.source?.locale || null,
      checkedAt: new Date().toISOString(),
    },
    alternatives: alternatives.map(compactAssessment),
    message: "O produto recomendado foi devolvido pelo catálogo oficial e novamente validado através de uma pesquisa exata pelo 12NC.",
    recommendedDescription: candidate.description,
    orderCode: candidate.orderCode,
    productUrl: candidate.url || null,
    differences: assessment.changes.map((change) => `${change.field}: ${change.from} → ${change.to}`),
  };
}

function noResult(parsed, { message, reason, originalProduct = null, configurators = [], configuratorAttempts = [], inspected = 0, familyMigration = null } = {}) {
  const attemptById = new Map(configuratorAttempts.map((attempt) => [attempt.id, attempt]));
  for (const id of configurators) {
    if (!attemptById.has(id)) attemptById.set(id, { id, validated: false, reason: "NOT_ATTEMPTED" });
  }
  return {
    status: "NO_VERIFIED_ALTERNATIVE",
    statusLabel: RESULT_LABELS.NO_VERIFIED_ALTERNATIVE,
    resultType: "NO_VERIFIED_ALTERNATIVE",
    compatibility: "NONE",
    original: originalProduct ? productSummary(originalProduct) : {
      input: parsed.input,
      description: parsed.reference || parsed.input,
      orderCode: parsed.orderCode || null,
      family: parsed.family || null,
      control: displayControl(parsed.controlClass),
    },
    recommended: null,
    familyMigration,
    reason,
    message,
    configurators: [...attemptById.values()],
    inspectedCandidates: inspected,
    validation: { verified: false, source: "Signify Product API / Configurator API", checkedAt: new Date().toISOString() },
  };
}

async function settleSearches(tasks) {
  const settled = await Promise.allSettled(tasks);
  const products = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  const errors = settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason);
  return { products: deduplicate(products), errors };
}

async function resolveOriginal(productClient, parsed) {
  if (parsed.orderCode) return productClient.resolveOrderCode(parsed.orderCode);
  if (!parsed.family) return null;
  const { products } = await productClient.searchProducts({ query: parsed.input, maxPages: 2 });
  const exact = products.filter((product) => (
    normalizeText(product.family) === normalizeText(parsed.family)
    && (parsed.controlClass === "UNKNOWN" || product.controlClass === parsed.controlClass)
  ));
  if (!exact.length) return null;
  return rankCandidates(parsed, exact, {
    targetControlClass: parsed.controlClass,
    originalProduct: null,
    verified: false,
  })[0]?.candidate || exact[0];
}

async function collectSameFamilyCandidates(productClient, parsed, originalProduct) {
  const family = parsed.family || originalProduct?.family;
  const target = parsed.targetControlClass;
  const terms = controlSearchTerms(target, parsed.driver);
  const color = parsed.colorCode || "";
  const detailedBase = [family, parsed.generation, parsed.package, color, parsed.length].filter(Boolean).join(" ");
  const familyIds = [...new Set(originalProduct?.familyIds || [])];
  const tasks = [];
  for (const term of terms.slice(0, 4)) {
    tasks.push(productClient.searchProducts({ query: `${detailedBase} ${term}`.trim(), controlClass: target, maxPages: 2 })
      .then((result) => result.products));
  }
  for (const familyId of familyIds) tasks.push(productClient.searchFamily(familyId, target));
  if (!familyIds.length && family) {
    tasks.push(productClient.searchProducts({ query: `${family} ${terms[0] || ""}`.trim(), controlClass: target, maxPages: 3 })
      .then((result) => result.products));
  }
  const settled = await settleSearches(tasks);
  if (!settled.products.length && settled.errors.length === tasks.length && settled.errors.length > 0) throw settled.errors[0];
  return {
    ...settled,
    products: settled.products.filter((product) => normalizeText(product.family) === normalizeText(family) && product.controlClass === target),
  };
}

async function verifyRanked(productClient, parsed, originalProduct, candidates, options = {}) {
  const ranked = rankCandidates(parsed, candidates, {
    originalProduct,
    targetControlClass: parsed.targetControlClass,
    allowFamilyChange: options.allowFamilyChange || false,
    verified: false,
  });
  const verified = [];
  for (const preliminary of ranked.slice(0, 8)) {
    const product = await productClient.verifyStandardProduct(preliminary.candidate, parsed.targetControlClass);
    if (!product) continue;
    const assessment = assessCandidate(parsed, product, {
      originalProduct,
      targetControlClass: parsed.targetControlClass,
      allowFamilyChange: options.allowFamilyChange || false,
      verified: true,
    });
    if (options.allowFamilyChange && !options.migrationEvidence?.validated && !canValidateFamilyMigration(parsed, originalProduct, product)) {
      assessment.blockers.push("No official successor relationship or complete form-factor equivalence was available.");
      assessment.safeToRecommend = false;
    }
    verified.push(assessment);
  }
  return verified.sort((left, right) => right.score - left.score);
}

async function tryConfigurators(configuratorClient, parsed, products, options = {}) {
  const candidates = deduplicate(products.filter((product) => product.configuratorId));
  const attempted = [];
  for (const product of candidates.slice(0, 3)) {
    const result = await configuratorClient.validateControlChange({
      configuratorId: product.configuratorId,
      familyCode: product.family,
      seed: product.configuratorSeed,
      sourceControlClass: parsed.controlClass,
      targetControlClass: parsed.targetControlClass,
      requirements: {
        ...parsed,
        // If a legacy reference has no modern efficiency/board marker, preserve
        // the marker exposed by the official current-family carrier returned by
        // the Product API (for example UE). This is data-driven, not family-specific.
        efficiency: parsed.efficiency || product.parsed?.efficiency || "",
      },
    });
    const attempt = {
      id: product.configuratorId,
      family: product.family || null,
      validated: Boolean(result.validated),
      reason: result.validated ? null : result.reason || "CONFIGURATOR_VALIDATION_FAILED",
      errorCode: result.errorCode || null,
      httpStatus: result.httpStatus || null,
    };
    attempted.push(attempt);
    if (!result.validated) continue;
    const configured = {
      description: result.description,
      orderCode: result.orderCode,
      is12nc: /^\d{12}$/.test(result.orderCode || ""),
      family: parseReference(result.description).family,
      parsed: parseReference(result.description),
      controlClass: parsed.targetControlClass,
      configuratorId: result.configuratorId,
      url: "",
      source: { system: "SIGNIFY_CONFIGURATOR_API" },
    };
    if (options.expectedFamily && normalizeText(configured.family) !== normalizeText(options.expectedFamily)) {
      attempt.validated = false;
      attempt.reason = "CONFIGURATOR_RETURNED_UNEXPECTED_FAMILY";
      continue;
    }
    const assessment = assessCandidate(parsed, configured, {
      targetControlClass: parsed.targetControlClass,
      originalProduct: options.originalProduct || null,
      allowFamilyChange: options.allowFamilyChange || false,
      verified: true,
      requires12nc: false,
    });
    if (options.allowFamilyChange && !options.migrationEvidence?.validated) {
      attempt.validated = false;
      attempt.reason = "SUCCESSOR_EVIDENCE_NOT_VALIDATED";
      continue;
    }
    if (!assessment.safeToRecommend) {
      attempt.validated = false;
      attempt.reason = "CONFIGURATION_TECHNICALLY_INCOMPATIBLE";
      continue;
    }
    return { result, configured, assessment, attempted, familyMigration: options.migrationEvidence?.evidence || null };
  }
  return { result: null, configured: null, assessment: null, attempted };
}

function configurableResponse(parsed, originalProduct, configuredResult) {
  const { result, configured, assessment, familyMigration = null } = configuredResult;
  return {
    status: "VERIFIED_CONFIGURABLE_PRODUCT",
    statusLabel: RESULT_LABELS.VERIFIED_CONFIGURABLE_PRODUCT,
    resultType: "VERIFIED_CONFIGURABLE_PRODUCT",
    compatibility: assessment.changes.length ? "CONFIGURABLE_CLOSEST" : "CONFIGURABLE_LIKE_FOR_LIKE",
    original: originalProduct ? productSummary(originalProduct) : { input: parsed.input, description: parsed.reference, family: parsed.family, control: displayControl(parsed.controlClass) },
    recommended: {
      description: configured.description,
      orderCode: configured.is12nc ? configured.orderCode : null,
      productCode: configured.orderCode || null,
      family: configured.family,
      control: displayControl(configured.controlClass),
      configuratorId: result.configuratorId,
      configurationId: result.configId,
    },
    currentFamily: configured.family,
    familyMigration,
    changes: assessment.changes,
    preserved: assessment.preserved,
    validation: {
      verified: true,
      source: "Signify Configurator API",
      method: "Opção de controlo aplicável e devolvida como selecionada",
      checkedAt: new Date().toISOString(),
    },
    message: configured.is12nc
      ? "A configuração e o 12NC foram devolvidos pela Signify Configurator API."
      : familyMigration
        ? `A família atual ${configured.family} foi descoberta através dos dados oficiais e a configuração foi validada pela Signify Configurator API. Esta configuração não necessita de um 12NC standard.`
        : "A configuração foi validada pela Signify Configurator API; não foi devolvido um 12NC standard.",
  };
}

async function resolveLegacyFamily(productClient, parsed, originalProduct) {
  if (typeof productClient.resolveFamilyMetadata === "function") {
    return productClient.resolveFamilyMetadata(parsed, originalProduct);
  }
  if (!originalProduct) return null;
  return {
    raw: originalProduct.raw,
    id: originalProduct.familyIds?.[0] || "",
    code: originalProduct.family,
    name: originalProduct.familyName,
    configuratorId: originalProduct.configuratorId,
    configuratorSeed: originalProduct.configuratorSeed,
    category: originalProduct.category,
    mounting: originalProduct.mounting,
    dimensions: originalProduct.dimensions,
    url: originalProduct.url,
    source: originalProduct.source,
  };
}

async function collectMigrationCandidates(productClient, parsed, originalProduct) {
  if (!originalProduct?.category || !originalProduct?.mounting || !originalProduct?.dimensions) return [];
  const terms = controlSearchTerms(parsed.targetControlClass, parsed.driver);
  const technical = [originalProduct.category, originalProduct.mounting, originalProduct.dimensions, parsed.package, parsed.colorCode, terms[0]]
    .filter(Boolean).join(" ");
  const { products } = await productClient.searchProducts({ query: technical, controlClass: parsed.targetControlClass, maxPages: 5 });
  return products.filter((product) => product.controlClass === parsed.targetControlClass && product.family !== parsed.family);
}

export function createEngine({ productClient = new ProductApiClient(), configuratorClient = new ConfiguratorApiClient() } = {}) {
  return async function engine(query) {
    const parsed = parseReference(query);
    if (!parsed.input) return { httpStatus: 400, status: "NEEDS_REVIEW", statusLabel: RESULT_LABELS.NEEDS_REVIEW, message: "Introduza uma referência Signify ou um 12NC." };
    try {
      const originalProduct = await resolveOriginal(productClient, parsed);
      const officialParsed = originalProduct ? parseReference(originalProduct.description) : null;
      const effectiveControl = originalProduct?.controlClass !== "UNKNOWN" ? originalProduct?.controlClass : officialParsed?.controlClass;
      const effective = originalProduct
        ? {
            ...officialParsed,
            input: parsed.input,
            orderCode: parsed.orderCode || originalProduct.orderCode,
            family: officialParsed.family || originalProduct.family,
            controlClass: effectiveControl,
            targetControlClass: oppositeControl(effectiveControl),
          }
        : parsed;
      if (!effective.family || effective.controlClass === "UNKNOWN") {
        return {
          httpStatus: 422,
          status: "NEEDS_REVIEW",
          statusLabel: RESULT_LABELS.NEEDS_REVIEW,
          message: parsed.orderCode ? "O 12NC não foi encontrado no catálogo oficial Signify." : "Não foi possível identificar com segurança a família ou o tipo de controlo.",
          original: { input: parsed.input, orderCode: parsed.orderCode || null },
        };
      }

      const sameFamily = await collectSameFamilyCandidates(productClient, effective, originalProduct);
      const verifiedSameFamily = await verifyRanked(productClient, effective, originalProduct, sameFamily.products);
      const safeSameFamily = verifiedSameFamily.filter((assessment) => assessment.safeToRecommend);
      if (safeSameFamily.length) return standardResponse(effective, originalProduct, safeSameFamily[0], safeSameFamily.slice(1, 2));

      const configuratorPool = deduplicate([originalProduct, ...sameFamily.products].filter(Boolean));
      const configuratorAttempts = [];
      const legacyFamily = await resolveLegacyFamily(productClient, effective, originalProduct);
      let successorDiscovery = { validated: false, candidates: [], reason: "LEGACY_FAMILY_METADATA_NOT_AVAILABLE" };
      {
        successorDiscovery = await discoverSuccessorFamilies(productClient, effective, legacyFamily || {
          code: effective.family,
          name: "",
          raw: null,
        });
        if (successorDiscovery.validated) {
          const successor = successorDiscovery.candidate;
          const verifiedSuccessor = await verifyRanked(productClient, effective, originalProduct, successor.products, {
            allowFamilyChange: true,
            migrationEvidence: successorDiscovery,
          });
          const safeSuccessor = verifiedSuccessor.filter((assessment) => assessment.safeToRecommend);
          if (safeSuccessor.length) {
            return standardResponse(effective, originalProduct, safeSuccessor[0], safeSuccessor.slice(1, 2), successorDiscovery.evidence);
          }

          const carrier = configuratorCarrier(successor);
          const successorPool = deduplicate([carrier, ...successor.products].filter(Boolean));
          const configuredSuccessor = await tryConfigurators(configuratorClient, effective, successorPool, {
            allowFamilyChange: true,
            expectedFamily: successor.code,
            originalProduct,
            migrationEvidence: successorDiscovery,
          });
          configuratorAttempts.push(...configuredSuccessor.attempted);
          if (configuredSuccessor.result) return configurableResponse(effective, originalProduct, configuredSuccessor);
        }
      }

      const configured = await tryConfigurators(configuratorClient, effective, configuratorPool);
      configuratorAttempts.push(...configured.attempted);
      if (configured.result) return configurableResponse(effective, originalProduct, configured);
      if (legacyFamily?.configuratorId) {
        const familyConfigurator = configuratorCarrier({ family: legacyFamily, products: [] });
        const configuredCurrentFamily = await tryConfigurators(configuratorClient, effective, [familyConfigurator].filter(Boolean), {
          expectedFamily: effective.family,
          originalProduct,
        });
        configuratorAttempts.push(...configuredCurrentFamily.attempted);
        if (configuredCurrentFamily.result) return configurableResponse(effective, originalProduct, configuredCurrentFamily);
      }

      const migrationCandidates = await collectMigrationCandidates(productClient, effective, originalProduct);
      if (migrationCandidates.length) {
        const verifiedMigration = await verifyRanked(productClient, effective, originalProduct, migrationCandidates, { allowFamilyChange: true });
        const safeMigration = verifiedMigration.filter((assessment) => assessment.safeToRecommend);
        if (safeMigration.length) return standardResponse(effective, originalProduct, safeMigration[0], safeMigration.slice(1, 2));
      }

      const configurators = [...new Set(configuratorPool.map((product) => product.configuratorId).filter(Boolean))];
      const discoveredConfigurators = successorDiscovery.candidates
        .flatMap((candidate) => [candidate.family?.configuratorId, ...candidate.products.map((product) => product.configuratorId)])
        .filter(Boolean);
      configurators.push(...discoveredConfigurators.filter((id) => !configurators.includes(id)));
      const familyKnown = Boolean(originalProduct || sameFamily.products.length || legacyFamily || successorDiscovery.candidates.length);
      return noResult(effective, {
        originalProduct,
        familyMigration: successorDiscovery.evidence || null,
        configurators,
        configuratorAttempts,
        inspected: sameFamily.products.length + migrationCandidates.length + successorDiscovery.candidates.length,
        reason: successorDiscovery.validated
          ? "SUCCESSOR_FOUND_CONFIGURATION_NOT_VALIDATED"
          : successorDiscovery.reason === "SUCCESSOR_CANDIDATES_AMBIGUOUS"
          ? "SUCCESSOR_CANDIDATES_AMBIGUOUS"
          : familyKnown ? "NO_TECHNICALLY_SAFE_MATCH" : "ORIGINAL_FAMILY_NOT_VERIFIED",
        message: successorDiscovery.validated
          ? `A família atual ${successorDiscovery.candidate.code} foi identificada, mas a configuração final não foi confirmada pela Configurator API.`
          : familyKnown
            ? "Nenhum candidato preservou as características técnicas necessárias e passou a validação oficial."
            : "A família original não foi confirmada no catálogo oficial atual e a pesquisa técnica não encontrou um sucessor único e validável.",
      });
    } catch (error) {
      if (error instanceof ProductApiError || error instanceof ConfiguratorApiError) {
        return { httpStatus: 503, status: "SOURCE_UNAVAILABLE", statusLabel: RESULT_LABELS.SOURCE_UNAVAILABLE, resultType: "SOURCE_UNAVAILABLE", message: error.message, errorCode: error.code };
      }
      console.error("Alternative engine failed", error);
      return { httpStatus: 500, status: "SOURCE_UNAVAILABLE", statusLabel: RESULT_LABELS.SOURCE_UNAVAILABLE, resultType: "SOURCE_UNAVAILABLE", message: "Não foi possível concluir a pesquisa com segurança.", errorCode: "UNEXPECTED_ERROR" };
    }
  };
}

export const engine = createEngine();
