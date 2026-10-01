import { normalizeControlCode, normalizeText, oppositeControl, parseReference } from './normalization.js';

const DEFAULT_BASE = 'https://www.quote.signify.com/api';

export class QuoteApiError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'QuoteApiError'; this.code = code; this.details = details; }
}

function assignmentMap(assignments = []) {
  return new Map(assignments.filter(a => a?.variableName && a?.valueName != null).map(a => [normalizeText(a.variableName), { ...a }]));
}
function setAssignment(map, variableName, valueName) {
  const key = normalizeText(variableName);
  const old = map.get(key) || { variableName, updatedValues: null, isDefault: false, exclusion: false, isLive: false, isUserAssignment: true };
  map.set(key, { ...old, variableName: old.variableName || variableName, valueName, valueText: old.valueText ?? valueName });
}
function configuration(response) { return response?.materialBomConfiguration?.root?.configuration || null; }
function responseAssignments(response) {
  const list = configuration(response)?.newAssignments;
  if (!Array.isArray(list)) return [];
  // The Quote UI reuses the user assignments returned by the configurator. Do not
  // feed calculated fields (CATALOGCODE1, prices, labels, etc.) back as user input.
  const user = list.filter(a => a?.isUserAssignment === true && a?.variableName && a?.valueName != null);
  return user.length ? user : list.filter(a => a?.variableName && a?.valueName != null);
}
function selectedValue(response, variableName) {
  return responseAssignments(response).find(a => normalizeText(a.variableName) === normalizeText(variableName))?.valueName
    || configuration(response)?.newAssignments?.find(a => normalizeText(a.variableName) === normalizeText(variableName))?.valueName || '';
}
function catalogCode(response) {
  const list = configuration(response)?.newAssignments || [];
  return String(list.find(a => normalizeText(a.variableName) === 'CATALOGCODE1')?.valueName || '').trim();
}
function validResponse(response) {
  const root = configuration(response);
  const status = response?.bomStatus?.configurationStatus;
  return Boolean((root?.valid ?? status?.valid) && (root?.complete ?? status?.complete) && !(root?.hasConflict ?? status?.hasConflict));
}
function configurableId(item) {
  const raw = String(item?.materialName || item?.productModelName || '').trim();
  const first = raw.split('_')[0];
  return /^[A-Z]{1,8}\d{2,5}[A-Z]{0,4}I$/i.test(first) ? normalizeText(first) : '';
}
function materialNumber(item) { return String(item?.name || item?.externalId || '').trim(); }
function normalizePackage(v) { return normalizeText(v).replace(/^LED/, ''); }
function colorBase(v) { return normalizeText(v).replace(/^(UE|HE|NE)/, '').replace(/(UE|HE|NE|H)$/, ''); }
function sameValue(a,b) { return normalizeText(a) === normalizeText(b); }

function scoreSeed(item, parsed) {
  const assignments = assignmentMap(item?.assignments || []);
  let score = configurableId(item) ? 100 : 0;
  const desc = parseReference(item?.description || '');
  // Retired-family searches legitimately return the current family, so matching
  // technical attributes is stronger than requiring the same family code.
  if (parsed.family && desc.family === parsed.family) score += 60;
  if (parsed.packageCanonical && normalizePackage(desc.packageCanonical) === normalizePackage(parsed.packageCanonical)) score += 40;
  if (parsed.colorCode && colorBase(desc.colorCode) === colorBase(parsed.colorCode)) score += 30;
  for (const feature of parsed.features || []) if ([...assignments.values()].some(a => sameValue(a.valueName, feature))) score += 8;
  return score;
}

function payloadFor(client, seed, configId, assignments) {
  return {
    name: configId,
    plant: seed?.plant || client.plant,
    usage: client.usage,
    languages: ['en-GB','en'],
    rootConfiguration: {
      existingAssignments: assignments,
      itemId: '',
      materialName: materialNumber(seed),
      configurableMaterialName: configId,
      bomItemAssignments: [],
    },
    salesAreaName: client.salesAreaName,
    salesAreaId: client.salesAreaId,
    soldTo: null,
    shipTo: null,
    environment: { rootEnvironment: { salesArea: { salesOrganization: client.salesOrganization, distributionChannel: client.distributionChannel }, salesDocumentType: 'ZQU' }, materialEnvironment: [] },
  };
}

function driverCandidates(targetControl, currentDriver, requestedDriver) {
  const external = /-E$/i.test(currentDriver || '') || /-E$/i.test(requestedDriver || '');
  return targetControl === 'DALI'
    ? (external ? ['PSD-E','DIA-E','PSD','DIA','PSED-E','PSED'] : ['PSD','DIA','PSED','PSD-E','DIA-E'])
    : (external ? ['PSU-E','PSU'] : ['PSU','PSU-E']);
}

export class QuoteApiClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = process.env.SIGNIFY_QUOTE_API_BASE || DEFAULT_BASE, timeoutMs = Number(process.env.SIGNIFY_API_TIMEOUT_MS || 12000), salesOrganization = process.env.SIGNIFY_SALES_ORG || 'PT02', distributionChannel = process.env.SIGNIFY_DISTRIBUTION_CHANNEL || '05', salesAreaId = process.env.SIGNIFY_SALES_AREA_ID || 'PT02/05/01', salesAreaName = process.env.SIGNIFY_SALES_AREA_NAME || 'CSU Portugal', plant = process.env.SIGNIFY_CONFIG_PLANT || 'PL06', usage = process.env.SIGNIFY_CONFIG_USAGE || '5' } = {}) {
    this.fetchImpl = fetchImpl; this.baseUrl = baseUrl.replace(/\/$/, ''); this.timeoutMs = timeoutMs;
    this.salesOrganization = salesOrganization; this.distributionChannel = distributionChannel; this.salesAreaId = salesAreaId; this.salesAreaName = salesAreaName; this.plant = plant; this.usage = usage;
  }
  async request(url, options = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await this.fetchImpl(url, { ...options, headers: { Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) }, signal: controller.signal });
      const text = await r.text();
      if (!r.ok) throw new QuoteApiError('HTTP_ERROR', `Quote API HTTP ${r.status}`, { status:r.status, body:text.slice(0,1000), url:String(url) });
      try { return text ? JSON.parse(text) : {}; } catch (e) { throw new QuoteApiError('INVALID_JSON', 'Quote API returned invalid JSON', { body:text.slice(0,1000), url:String(url) }); }
    } catch (e) {
      if (e instanceof QuoteApiError) throw e;
      throw new QuoteApiError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', 'Quote API unavailable', { cause:String(e), url:String(url) });
    } finally { clearTimeout(timer); }
  }
  async search(query, pageSize = 12) {
    const u = new URL(`${this.baseUrl}/products/search`);
    Object.entries({ query, page:0, pageSize, configurable:false, language:'en-GB', salesOrganization:this.salesOrganization, distributionChannel:this.distributionChannel, soldTo:'null', shipTo:'null' }).forEach(([k,v])=>u.searchParams.set(k,String(v)));
    return this.request(u);
  }
  async validate(payload) { return this.request(`${this.baseUrl}/material/getFromExistingConfigurationWithStatus`, { method:'POST', body:JSON.stringify(payload) }); }

  async findAlternative(input) {
    const parsedInput = parseReference(input);
    const search = await this.search(input);
    const items = Array.isArray(search?.items) ? search.items : [];
    const configurable = items.filter(i => i?.isConfigurable && configurableId(i) && Array.isArray(i?.assignments) && i.assignments.length);
    if (!configurable.length) return { discovered:false, validated:false, reason:'NO_CONFIGURABLE_RESULT' };
    const seed = [...configurable].sort((a,b)=>scoreSeed(b,parsedInput)-scoreSeed(a,parsedInput))[0];
    const configId = configurableId(seed);
    const seedParsed = parseReference(seed.description || '');
    const sourceControl = parsedInput.controlClass !== 'UNKNOWN' ? parsedInput.controlClass : seedParsed.controlClass;
    const targetControl = oppositeControl(sourceControl);
    if (targetControl === 'UNKNOWN') return { discovered:true, validated:false, configuratorId:configId, reason:'SOURCE_CONTROL_UNKNOWN' };

    // Stage 1: reproduce the Quote UI exactly. Open the API-provided seed without
    // changing anything. This proves that the product/configurator/assignments form
    // a valid starting configuration before we attempt the alternative.
    const originalAssignments = seed.assignments.map(a => ({ ...a }));
    let originalResponse;
    try {
      originalResponse = await this.validate(payloadFor(this, seed, configId, originalAssignments));
    } catch (error) {
      return { discovered:true, validated:false, configuratorId:configId, reason:'SEED_VALIDATION_REQUEST_FAILED', errorCode:error.code, httpStatus:error.details?.status || null, errorDetails:error.details || {} };
    }
    if (!validResponse(originalResponse)) {
      return { discovered:true, validated:false, configuratorId:configId, reason:'SEED_CONFIGURATION_NOT_VALID', seedStatus: configuration(originalResponse) ? { valid:configuration(originalResponse)?.valid, complete:configuration(originalResponse)?.complete, hasConflict:configuration(originalResponse)?.hasConflict, invalidMessage:configuration(originalResponse)?.invalidMessage } : null };
    }

    // Stage 2 starts from the normalized user assignments returned by the real
    // configurator, not from an invented bootstrap session.
    const normalized = responseAssignments(originalResponse);
    const base = assignmentMap(normalized.length ? normalized : originalAssignments);
    if (parsedInput.packageCanonical) setAssignment(base, 'PLM_LAMPFAM', normalizePackage(parsedInput.packageCanonical));
    if (parsedInput.colorCode) setAssignment(base, 'PLM_COLLAMP', colorBase(parsedInput.colorCode));

    const driverKey = [...base.keys()].find(k => /(^|\.)PLM_TRAFO$|(^|\.)TRAFO$|DRIVER_TYPE|DRIVER|CONTROL/.test(k));
    if (!driverKey) return { discovered:true, validated:false, configuratorId:configId, reason:'CONTROL_VARIABLE_NOT_DISCOVERED' };
    const driverVariable = base.get(driverKey).variableName;
    const currentDriver = base.get(driverKey).valueName;
    const attempts = [];

    for (const targetDriver of driverCandidates(targetControl, currentDriver, parsedInput.driver)) {
      const attempt = new Map([...base].map(([k,v])=>[k,{...v}]));
      setAssignment(attempt, driverVariable, targetDriver);
      let response;
      try {
        response = await this.validate(payloadFor(this, seed, configId, [...attempt.values()]));
      } catch (error) {
        attempts.push({ targetDriver, reason:'REQUEST_FAILED', errorCode:error.code, httpStatus:error.details?.status || null });
        continue;
      }
      if (!validResponse(response)) {
        const c = configuration(response);
        attempts.push({ targetDriver, reason:'CONFIGURATION_NOT_VALID', valid:c?.valid ?? null, complete:c?.complete ?? null, hasConflict:c?.hasConflict ?? null, invalidMessage:c?.invalidMessage || null });
        continue;
      }
      const finalDriver = selectedValue(response, driverVariable);
      if (normalizeControlCode(finalDriver) !== targetControl) {
        attempts.push({ targetDriver, reason:'TARGET_CONTROL_NOT_SELECTED', finalDriver });
        continue;
      }
      const description = catalogCode(response);
      if (!description) { attempts.push({ targetDriver, reason:'CATALOGCODE1_NOT_RETURNED' }); continue; }
      const finalParsed = parseReference(description);
      return { discovered:true, validated:true, configuratorId:configId, description, orderCode:'', controlClass:targetControl, family:finalParsed.family, response, seed, targetDriver:finalDriver, attempts };
    }
    return { discovered:true, validated:false, configuratorId:configId, reason:'ALTERNATIVE_CONFIGURATION_NOT_VALIDATED', attempts };
  }
}
