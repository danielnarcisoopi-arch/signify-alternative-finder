import {
  CONTROL_FILTER_KEYS,
  extractFamilyCode,
  normalizeControlCode,
  normalizeText,
  parseReference,
} from "./normalization.js";

const DEFAULT_BASE = "https://api.microservices.signify.com/api/product/v1/smc";
const DEFAULT_LOCALE = "pt_PT";

export class ProductApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProductApiError";
    this.code = code;
    this.details = details;
  }
}

export function unwrap(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (typeof value !== "object") return value;
  if (Object.hasOwn(value, "value")) return unwrap(value.value);
  if (Object.hasOwn(value, "values")) return unwrap(value.values);
  return value;
}

function getField(item, names) {
  for (const name of names) {
    const value = unwrap(item?.[name]);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function asStrings(value) {
  const unwrapped = unwrap(value);
  if (unwrapped == null) return [];
  if (Array.isArray(unwrapped)) return unwrapped.flatMap(asStrings);
  if (typeof unwrapped === "object") {
    return Object.values(unwrapped).flatMap(asStrings);
  }
  return [String(unwrapped)];
}

function numberFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractMetric(item, fieldNames, unitPattern) {
  const direct = getField(item, fieldNames);
  const number = numberFrom(direct);
  if (number !== null) return number;
  const allValues = asStrings(getField(item, ["filter_values", "filterValues", "specifications", "features"]));
  for (const value of allValues) {
    if (unitPattern.test(value)) {
      const parsed = numberFrom(value.split(":").pop());
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function extractFamilyIds(item) {
  return asStrings(getField(item, ["family_id", "familyId", "family_ids", "familyIds", "family"]))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function familyCodeFromId(value) {
  const normalized = normalizeText(value);
  const explicit = normalized.match(/(?:^|_)LP_CF_([A-Z0-9-]+?)(?:_[A-Z]{2,5})?(?:_|$)/);
  if (explicit?.[1]) return explicit[1];
  return extractFamilyCode(normalized);
}

function recursiveFieldValues(value, keyPattern, results = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => recursiveFieldValues(entry, keyPattern, results));
    return results;
  }
  if (!value || typeof value !== "object") return results;
  for (const [key, entry] of Object.entries(value)) {
    if (keyPattern.test(key)) results.push(unwrap(entry));
    recursiveFieldValues(entry, keyPattern, results);
  }
  return results;
}

function firstRecursiveString(value, keyPattern) {
  return recursiveFieldValues(value, keyPattern)
    .flatMap(asStrings)
    .map((entry) => entry.trim())
    .find(Boolean) || "";
}

function extractConfiguratorId(item) {
  const direct = getField(item, [
    "configurator_id",
    "configuratorId",
    "configurator_name",
    "configuratorName",
    "configurator",
  ]);
  const candidates = [
    ...asStrings(direct),
    ...recursiveFieldValues(item, /configurator|configuratorId|configurator_name/i).flatMap(asStrings),
  ].map((entry) => entry.trim()).filter(Boolean);

  for (const candidate of candidates) {
    const fromUrl = candidate.match(/(?:configurator|configuration)[^/?#]*[/?#=]([A-Z]{1,6}\d{2,5}[A-Z]{0,3}I)\b/i);
    if (fromUrl?.[1]) return normalizeText(fromUrl[1]);
    if (/^[A-Z]{1,6}\d{2,5}[A-Z]{0,3}I$/i.test(candidate)) return normalizeText(candidate);
  }
  return candidates[0] || "";
}

export function createFamilyRecord(item, evidence = {}) {
  const id = String(getField(item, ["family_id", "familyId", "id", "identifier"]) || "").trim();
  const directCode = String(getField(item, ["family_code", "familyCode", "code", "product_family_code"]) || "").trim();
  const name = String(getField(item, [
    "family_name",
    "familyName",
    "product_family_name",
    "range_name",
    "displayName",
    "display_name",
    "name",
    "title",
  ]) || "").trim();
  const code = familyCodeFromId(directCode) || familyCodeFromId(id) || extractFamilyCode(name);
  if (!code && !id && !name) return null;
  return {
    raw: item,
    id,
    code,
    name,
    configuratorId: extractConfiguratorId(item),
    configuratorSeed: extractConfiguratorSeed(item),
    category: String(getField(item, ["category", "category_name", "categoryName", "product_category"]) || "").trim(),
    mounting: String(getField(item, ["mounting", "mounting_type", "mountingType", "installation"]) || "").trim(),
    dimensions: String(getField(item, ["dimensions", "dimension", "cutout", "cut_out"]) || "").trim(),
    url: String(getField(item, ["url", "family_url", "familyUrl", "pdp_url"]) || "").trim(),
    source: {
      system: "SIGNIFY_PRODUCT_API",
      locale: evidence.locale || DEFAULT_LOCALE,
      endpoint: evidence.endpoint || "",
      query: evidence.query || "",
      query: evidence.query || "",
    },
  };
}

function controlFromEvidence(filterKeys, searchableText) {
  if (filterKeys.includes(CONTROL_FILTER_KEYS.DALI)) return "DALI";
  if (filterKeys.includes(CONTROL_FILTER_KEYS.ON_OFF)) return "ON_OFF";
  if (/\bDALI\b|\bPSD(?:-E|-SR|-SRE)?\b|\bDIA(?:-E)?\b|\bPSED\b/i.test(searchableText)) return "DALI";
  if (/\bON[ /-]?OFF\b|\bPSU(?:-E)?\b|POWER SUPPLY UNIT \(ON\/OFF\)/i.test(searchableText)) return "ON_OFF";
  return normalizeControlCode(parseReference(searchableText).driver);
}

function extractConfiguratorSeed(item) {
  const configId = getField(item, ["configId", "config_id", "configurator_config_id"]);
  const existingAssignments = unwrap(getField(item, ["existingAssignments", "existing_assignments", "assignments"]));
  if (!configId || !Array.isArray(existingAssignments) || existingAssignments.length === 0) return null;
  return { configId: String(configId), existingAssignments };
}

export function createProduct(item, evidence = {}) {
  const description = String(getField(item, [
    "displayed_order_code_description",
    "displayedOrderCodeDescription",
    "order_code_description",
    "commercial_description",
    "product_name",
    "name",
  ]) || "").trim();
  const marketingDescription = String(getField(item, ["name", "description", "long_description", "longDescription"]) || "").trim();
  const orderCode = String(getField(item, ["sku", "order_code", "orderCode", "12nc", "material_number", "materialNumber"]) || "").trim();
  const familyIds = extractFamilyIds(item);
  const parsed = parseReference(description);
  const filterKeys = asStrings(getField(item, ["filter_keys", "filterKeys"]));
  const searchableText = `${description} ${marketingDescription} ${asStrings(getField(item, ["filter_values", "filterValues"])).join(" ")}`;
  const controlClass = controlFromEvidence(filterKeys, searchableText) !== "UNKNOWN"
    ? controlFromEvidence(filterKeys, searchableText)
    : evidence.controlClass || "UNKNOWN";

  return {
    raw: item,
    description,
    marketingDescription,
    orderCode,
    is12nc: /^\d{12}$/.test(orderCode),
    family: parsed.family || extractFamilyCode(description),
    familyIds,
    familyName: String(getField(item, ["family_name", "familyName", "product_family_name", "range_name"]) || "").trim(),
    configuratorId: extractConfiguratorId(item),
    configuratorSeed: extractConfiguratorSeed(item),
    url: String(getField(item, ["url", "product_url", "productUrl", "pdp_url"]) || "").trim(),
    status: String(getField(item, ["status", "product_status", "lifecycle_status", "lifecycleStatus"]) || "").trim(),
    market: String(getField(item, ["market", "country", "locale"]) || "").trim(),
    category: String(getField(item, ["category", "category_name", "categoryName", "product_category"]) || "").trim(),
    mounting: String(getField(item, ["mounting", "mounting_type", "mountingType", "installation"]) || "").trim(),
    dimensions: String(getField(item, ["dimensions", "dimension", "cutout", "cut_out"]) || "").trim(),
    luminousFlux: extractMetric(item, ["luminous_flux", "luminousFlux", "flux", "lumen_output"], /LUM(?:INOUS)?[_ ]?FLUX|\bLM\b/i),
    power: extractMetric(item, ["power", "wattage", "input_power", "inputPower"], /POWER|WATT|\bW\b/i),
    filterKeys,
    parsed,
    controlClass,
    controlEvidence: filterKeys.length ? "PRODUCT_FIELD" : (evidence.controlClass ? "PRODUCT_API_FILTER" : "DESCRIPTION"),
    source: {
      system: "SIGNIFY_PRODUCT_API",
      locale: evidence.locale || DEFAULT_LOCALE,
      endpoint: evidence.endpoint || "",
    },
  };
}

function getResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

function getFamilyRows(payload) {
  const roots = [
    payload?.dataEnrichment?.familyData,
    payload?.dataEnrichment?.family_data,
    payload?.data_enrichment?.familyData,
    payload?.data_enrichment?.family_data,
    payload?.data?.dataEnrichment?.familyData,
    payload?.data?.data_enrichment?.family_data,
    payload?.familyData,
    payload?.families,
    payload?.data?.families,
  ];
  return roots.flatMap((root) => {
    const value = unwrap(root);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }).filter((entry) => entry && typeof entry === "object");
}

function deduplicateFamilies(families) {
  const seen = new Set();
  return families.filter((family) => {
    const key = normalizeText(family.id || family.code || family.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTotal(payload) {
  for (const candidate of [payload?.total, payload?.totalElements, payload?.data?.total, payload?.pagination?.total]) {
    const number = numberFrom(candidate);
    if (number !== null) return number;
  }
  return null;
}

function validLifecycle(product) {
  if (!product.status) return true;
  return !/DISCONTINUED|OBSOLETE|WITHDRAWN|DELETED|INACTIVE/i.test(product.status);
}

export class ProductApiClient {
  constructor({
    fetchImpl = globalThis.fetch,
    baseUrl = process.env.SIGNIFY_PRODUCT_API_BASE || DEFAULT_BASE,
    locale = process.env.SIGNIFY_LOCALE || DEFAULT_LOCALE,
    timeoutMs = Number(process.env.SIGNIFY_API_TIMEOUT_MS || 12000),
    maxPages = Number(process.env.SIGNIFY_API_MAX_PAGES || 5),
    retries = Number(process.env.SIGNIFY_API_RETRIES || 1),
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.locale = locale;
    this.timeoutMs = timeoutMs;
    this.maxPages = Math.max(1, Math.min(maxPages, 20));
    this.retries = Math.max(0, Math.min(retries, 3));
  }

  searchEndpoint() {
    return `${this.baseUrl}/${this.locale}/search`;
  }

  facetsEndpoint() {
    return `${this.baseUrl}/${this.locale}/search/facets`;
  }

  async requestJson(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(url, { ...options, signal: controller.signal });
      } catch (error) {
        const timeout = error?.name === "AbortError";
        lastError = new ProductApiError(timeout ? "TIMEOUT" : "NETWORK_ERROR", timeout ? "A Signify Product API excedeu o tempo limite." : "A Signify Product API está indisponível.", { cause: String(error), attempt: attempt + 1 });
        if (attempt < this.retries) continue;
        throw lastError;
      } finally {
        clearTimeout(timer);
      }

      const text = await response.text();
      if (!response.ok) {
        lastError = new ProductApiError("HTTP_ERROR", `A Signify Product API devolveu HTTP ${response.status}.`, { status: response.status, body: text.slice(0, 300), attempt: attempt + 1 });
        if ((response.status === 429 || response.status >= 500) && attempt < this.retries) continue;
        throw lastError;
      }
      if (!text.trim()) throw new ProductApiError("EMPTY_RESPONSE", "A Signify Product API devolveu uma resposta vazia.");
      try {
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== "object") throw new Error("Unexpected root value");
        return payload;
      } catch (error) {
        throw new ProductApiError("INVALID_JSON", "A Signify Product API devolveu JSON inválido.", { cause: String(error) });
      }
    }
    throw lastError;
  }

  buildSearchUrl({ query = "", filters = "", page = 1, size = 100, endpoint = this.searchEndpoint() } = {}) {
    const url = new URL(endpoint);
    const params = {
      page,
      size,
      facets: "v:filter_keys,v:family_id,v:category",
      sort: "a:rank",
      enrichData: "true",
    };
    if (query) params.query = query;
    if (filters) params.filters = filters;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
  }

  async searchProducts({ query = "", filters = "", controlClass = "", maxPages = this.maxPages, size = 100 } = {}) {
    const products = [];
    const families = [];
    const seen = new Set();
    let total = null;
    let pagesRead = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const url = this.buildSearchUrl({ query, filters, page, size });
      const payload = await this.requestJson(url);
      const rows = getResults(payload);
      families.push(...getFamilyRows(payload)
        .map((row) => createFamilyRecord(row, { locale: this.locale, endpoint: url.origin + url.pathname, query }))
        .filter(Boolean));
      total ??= getTotal(payload);
      pagesRead += 1;
      for (const row of rows) {
        const product = createProduct(row, { controlClass, locale: this.locale, endpoint: url.origin + url.pathname, query });
        const key = product.orderCode || `${product.description}|${product.familyIds.join(",")}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        products.push(product);
      }
      if (rows.length < size || (total !== null && page * size >= total)) break;
    }
    return { products, families: deduplicateFamilies(families), total, pagesRead };
  }

  async searchFacets({ query = "", filters = "", controlClass = "", size = 100 } = {}) {
    const url = this.buildSearchUrl({ query, filters, page: 1, size, endpoint: this.facetsEndpoint() });
    const payload = await this.requestJson(url);
    const endpoint = url.origin + url.pathname;
    const families = getFamilyRows(payload)
      .map((row) => createFamilyRecord(row, { locale: this.locale, endpoint, query }))
      .filter(Boolean);
    const products = getResults(payload)
      .map((row) => createProduct(row, { controlClass, locale: this.locale, endpoint, query }))
      .filter((product) => product.description || product.orderCode);
    return { families: deduplicateFamilies(families), products, raw: payload };
  }

  async resolveFamilyMetadata(parsed, originalProduct = null) {
    const expected = normalizeText(parsed?.family || originalProduct?.family);
    if (!expected) return null;
    const queries = [...new Set([parsed?.input, parsed?.family, originalProduct?.familyName].filter(Boolean))];
    const tasks = queries.flatMap((query) => [
      this.searchFacets({ query }),
      this.searchProducts({ query, maxPages: 1, size: 100 }),
    ]);
    const settled = await Promise.allSettled(tasks);
    const families = deduplicateFamilies(settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value.families : []));
    const exact = families.find((family) => normalizeText(family.code) === expected
      || normalizeText(family.id).includes(`_${expected}_`));
    if (exact) return exact;
    if (originalProduct) {
      return {
        raw: originalProduct.raw,
        id: originalProduct.familyIds[0] || "",
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
    return null;
  }

  async resolveOrderCode(orderCode) {
    const normalized = String(orderCode || "").trim();
    if (!/^\d{8,18}$/.test(normalized)) return null;
    const { products } = await this.searchProducts({ query: normalized, maxPages: 2, size: 100 });
    return products.find((product) => product.orderCode === normalized) || null;
  }

  async searchFamily(familyId, controlClass) {
    if (!familyId || !CONTROL_FILTER_KEYS[controlClass]) return [];
    const filters = `family_id:${familyId}:ALL,type:Normal;SemiConfigured:ALL,filter_keys:${CONTROL_FILTER_KEYS[controlClass]}:ALL`;
    const { products } = await this.searchProducts({ filters, controlClass });
    return products.filter(validLifecycle);
  }

  async verifyStandardProduct(candidate, targetControlClass) {
    if (!candidate?.is12nc) return null;
    const verified = await this.resolveOrderCode(candidate.orderCode);
    if (!verified || !validLifecycle(verified)) return null;
    const controlClass = verified.controlClass !== "UNKNOWN" ? verified.controlClass : candidate.controlClass;
    if (controlClass !== targetControlClass) return null;
    return {
      ...verified,
      controlClass,
      controlEvidence: verified.controlClass !== "UNKNOWN" ? verified.controlEvidence : candidate.controlEvidence,
      source: { ...verified.source, verification: "EXACT_ORDER_CODE_LOOKUP" },
    };
  }
}
