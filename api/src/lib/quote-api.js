import { normalizeControlCode, normalizeText, oppositeControl, parseReference } from './normalization.js';

const DEFAULT_BASE = 'https://www.quote.signify.com/api';

export class QuoteApiError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'QuoteApiError'; this.code = code; this.details = details; }
}

function assignmentMap(assignments = []) {
  return new Map(assignments.filter(Boolean).map(a => [normalizeText(a.variableName), { ...a }]));
}
function setAssignment(map, variableName, valueName) {
  const key = normalizeText(variableName);
  const old = map.get(key) || { variableName, updatedValues: null, isDefault: false, exclusion: false, isLive: false };
  map.set(key, { ...old, variableName: old.variableName || variableName, valueName });
}
function selectedValue(response, variableName) {
  const list = response?.materialBomConfiguration?.root?.configuration?.newAssignments || [];
  return list.find(a => normalizeText(a.variableName) === normalizeText(variableName))?.valueName || '';
}
function catalogCode(response) { return String(selectedValue(response, 'CATALOGCODE1') || '').trim(); }
function responseAssignments(response) {
  const list = response?.materialBomConfiguration?.root?.configuration?.newAssignments;
  return Array.isArray(list) ? list.filter(a => a?.variableName && a?.valueName != null && !/^CATALOGCODE/i.test(a.variableName)) : [];
}
function validResponse(response) {
  const root = response?.materialBomConfiguration?.root?.configuration;
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

function scoreSeed(item, parsed) {
  const assignments = assignmentMap(item?.assignments || []);
  let score = configurableId(item) ? 100 : 0;
  const desc = parseReference(item?.description || '');
  if (parsed.family && desc.family === parsed.family) score += 120;
  if (parsed.packageCanonical && normalizePackage(desc.packageCanonical) === normalizePackage(parsed.packageCanonical)) score += 40;
  if (parsed.colorCode && colorBase(desc.colorCode) === colorBase(parsed.colorCode)) score += 30;
  for (const feature of parsed.features || []) {
    if ([...assignments.values()].some(a => normalizeText(a.valueName) === normalizeText(feature))) score += 8;
  }
  return score;
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
      if (!r.ok) throw new QuoteApiError('HTTP_ERROR', `Quote API HTTP ${r.status}`, { status:r.status, body:text.slice(0,500) });
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (e instanceof QuoteApiError) throw e;
      throw new QuoteApiError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', 'Quote API unavailable', { cause:String(e) });
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
    let search;
    try { search = await this.search(input, 100); }
    catch (error) { throw error; }
    const items = Array.isArray(search?.items) ? search.items : Array.isArray(search?.data?.items) ? search.data.items : [];
    const configurable = items.filter(i => i?.isConfigurable && configurableId(i) && Array.isArray(i?.assignments) && i.assignments.length);
    if (!configurable.length) return { matched:false, validated:false, reason:'NO_CONFIGURABLE_PRODUCT_IN_FULL_QUERY', searchedQuery:input };

    const seed = configurable.sort((a,b)=>scoreSeed(b,parsedInput)-scoreSeed(a,parsedInput))[0];
    const configId = configurableId(seed);
    const seedParsed = parseReference(seed.description || '');
    const sourceControl = parsedInput.controlClass !== 'UNKNOWN' ? parsedInput.controlClass : seedParsed.controlClass;
    const targetControl = oppositeControl(sourceControl);
    if (targetControl === 'UNKNOWN') return { matched:true, validated:false, configuratorId:configId, reason:'CONTROL_NOT_IDENTIFIED', seed };

    const makePayload = assignments => ({
      name: configId, plant: this.plant, usage: this.usage, languages:['en-GB','en'],
      rootConfiguration: { existingAssignments:assignments, itemId:'', materialName:materialNumber(seed), configurableMaterialName:configId, bomItemAssignments:[] },
      salesAreaName:this.salesAreaName, salesAreaId:this.salesAreaId, soldTo:null, shipTo:null,
      environment:{ rootEnvironment:{ salesArea:{ salesOrganization:this.salesOrganization, distributionChannel:this.distributionChannel }, salesDocumentType:'ZQU' }, materialEnvironment:[] }
    });

    // First reproduce the Quote UI exactly: load the untouched configuration returned
    // by Product Search. This proves that the discovered configurator/material/assignments
    // form a valid starting point before we attempt any PSU <-> DALI change.
    let initial;
    try { initial = await this.validate(makePayload(seed.assignments.map(a=>({...a})))); }
    catch (error) {
      return { matched:true, validated:false, configuratorId:configId, reason:'INITIAL_CONFIGURATION_REQUEST_FAILED', errorCode:error?.code||null, httpStatus:error?.details?.status||null, seed };
    }
    if (!validResponse(initial)) return { matched:true, validated:false, configuratorId:configId, reason:'INITIAL_CONFIGURATION_NOT_VALID', seed, response:initial };

    // Use the assignments normalized by the configurator itself as the baseline.
    // Fall back to Product Search assignments only if the API does not return them.
    const normalized = responseAssignments(initial);
    const map = assignmentMap(normalized.length ? normalized : seed.assignments);
    if (parsedInput.packageCanonical) setAssignment(map, 'PLM_LAMPFAM', normalizePackage(parsedInput.packageCanonical));
    if (parsedInput.colorCode) setAssignment(map, 'PLM_COLLAMP', colorBase(parsedInput.colorCode));

    const driverKey = [...map.keys()].find(k => /PLM_TRAFO|(^|[._])TRAFO($|[._])|DRIVER|CONTROL/.test(k));
    if (!driverKey) return { matched:true, validated:false, configuratorId:configId, reason:'DRIVER_CHARACTERISTIC_NOT_FOUND', seed };
    const driverVariable = map.get(driverKey).variableName;
    const currentDriver = map.get(driverKey).valueName;
    const external = /-E$/i.test(currentDriver) || /-E$/i.test(parsedInput.driver);
    const controls = targetControl === 'DALI'
      ? (external ? ['PSD-E','DIA-E','PSD','DIA','PSED-E','PSED'] : ['PSD','DIA','PSED','PSD-E','DIA-E'])
      : (external ? ['PSU-E','PSU'] : ['PSU','PSU-E']);

    const attempts=[];
    for (const targetDriver of controls) {
      const attempt = new Map([...map].map(([k,v])=>[k,{...v}]));
      setAssignment(attempt, driverVariable, targetDriver);
      let response;
      try { response = await this.validate(makePayload([...attempt.values()])); }
      catch (error) { attempts.push({targetDriver, reason:'REQUEST_FAILED', httpStatus:error?.details?.status||null, errorCode:error?.code||null}); continue; }
      if (!validResponse(response)) { attempts.push({targetDriver, reason:'NOT_VALID'}); continue; }
      const finalDriver = selectedValue(response, driverVariable);
      if (normalizeControlCode(finalDriver) !== targetControl) { attempts.push({targetDriver, reason:'TARGET_CONTROL_NOT_SELECTED', finalDriver}); continue; }
      const description = catalogCode(response);
      if (!description) { attempts.push({targetDriver, reason:'CATALOG_CODE_NOT_RETURNED'}); continue; }
      const finalParsed = parseReference(description);
      return { matched:true, validated:true, configuratorId:configId, description, orderCode:'', controlClass:targetControl, family:finalParsed.family, response, seed, targetDriver:finalDriver, initialResponse:initial };
    }
    return { matched:true, validated:false, configuratorId:configId, reason:'TARGET_CONFIGURATION_NOT_VALIDATED', attempts, seed };
  }
}

