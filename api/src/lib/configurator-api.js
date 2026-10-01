import { normalizeControlCode, normalizeText } from "./normalization.js";

const DEFAULT_BASE = "https://api.microservices.signify.com/api/configurator/v3/session/update";

export class ConfiguratorApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConfiguratorApiError";
    this.code = code;
    this.details = details;
  }
}

function walk(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visitor, [...path, index]));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => walk(entry, visitor, [...path, key]));
  }
}

function scalar(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of ["value", "name", "code", "id"]) {
      if (Object.hasOwn(value, key)) {
        const result = scalar(value[key]);
        if (result) return result;
      }
    }
  }
  return "";
}

function collectAssignments(payload) {
  const assignments = [];
  const visit = (value, inheritedVariableName = "") => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, inheritedVariableName));
      return;
    }
    if (!value || typeof value !== "object") return;

    const hasChildOptions = ["values", "options", "availableValues", "available_values", "items"]
      .some((key) => Array.isArray(value[key]));
    const explicitVariableName = scalar(value.variableName ?? value.variable_name ?? value.variableId ?? value.variable_id);
    const containerVariableName = hasChildOptions ? scalar(value.name ?? value.code ?? value.id) : "";
    const variableName = explicitVariableName || containerVariableName || inheritedVariableName;
    let valueName = scalar(value.valueName ?? value.value_name ?? value.optionName ?? value.option_name);
    const state = scalar(value.state ?? value.optionState ?? value.option_state ?? value.status);
    if (!valueName && inheritedVariableName && !explicitVariableName && state) {
      valueName = scalar(value.name ?? value.code ?? value.id ?? value.value);
    }
    if (variableName && valueName) assignments.push({ variableName, valueName, state });

    for (const entry of Object.values(value)) {
      if (entry && typeof entry === "object") visit(entry, variableName || inheritedVariableName);
    }
  };
  visit(payload);

  const byKey = new Map();
  for (const assignment of assignments) {
    const key = assignmentKey(assignment);
    const existing = byKey.get(key);
    if (!existing || (selectedState(assignment.state) && !selectedState(existing.state))) byKey.set(key, assignment);
  }
  return [...byKey.values()];
}

function isControlText(value) {
  const text = normalizeText(value);
  return /TRAFO|DRIVER|CONTROL|DIMM|DALI|PSU|PSD|PSED|DIA/.test(text);
}

function assignmentControl(assignment) {
  const direct = normalizeControlCode(assignment.valueName);
  if (direct !== "UNKNOWN") return direct;
  const text = normalizeText(`${assignment.variableName} ${assignment.valueName}`);
  if (/DALI|PSD|PSED|DIA/.test(text)) return "DALI";
  if (/ON[ /-]?OFF|PSU/.test(text)) return "ON_OFF";
  return "UNKNOWN";
}

function selectedState(state) {
  return /SELECTED|USERSELECTED/i.test(String(state || ""));
}

function selectableState(state) {
  return !state || /SELECTABLE|SELECTED|USERSELECTED/i.test(String(state));
}

function assignmentKey(assignment) {
  return `${assignment.variableName}\u0000${assignment.valueName}`;
}

function selectedAssignments(payload, fallback = []) {
  const selected = collectAssignments(payload).filter((assignment) => selectedState(assignment.state));
  if (selected.length) return selected;
  return fallback;
}

function comparable(value) {
  return normalizeText(value).replace(/[\s_/-]+/g, "");
}

function requirementMatches(assignment, requirement) {
  const value = comparable(assignment.valueName);
  if (!value) return false;
  if (requirement.type === "PACKAGE") {
    return requirement.values.some((candidate) => value.replace(/^LED/, "") === comparable(candidate).replace(/^LED/, ""));
  }
  return requirement.values.some((candidate) => {
    const wanted = comparable(candidate);
    if (!wanted) return false;
    if (wanted.length <= 2) return value === wanted;
    return value === wanted || normalizeText(assignment.valueName).split(/[^A-Z0-9-]+/).some((token) => comparable(token) === wanted);
  });
}

function tunableColorScore(assignment, requirement) {
  if (requirement.type !== "COLOR" || !requirement.expectedCct || !requirement.expectedCri) return -1;
  const match = normalizeText(assignment.valueName).match(/\bTW([789])(\d{2})-([789])(\d{2})\b/);
  if (!match) return -1;
  const criMin = Math.min(Number(match[1]), Number(match[3])) * 10;
  const cctMin = Math.min(Number(match[2]), Number(match[4])) * 100;
  const cctMax = Math.max(Number(match[2]), Number(match[4])) * 100;
  if (criMin < requirement.expectedCri || requirement.expectedCct < cctMin || requirement.expectedCct > cctMax) return -1;
  return 1000 - (cctMax - cctMin) / 100;
}

function fixedColorScore(assignment, requirement) {
  if (requirement.type !== "COLOR" || !requirement.expectedCct || !requirement.expectedCri) return -1;
  const match = normalizeText(assignment.valueName).match(/^(UE|HE|NE)?([789])(\d{2})(UE|HE|NE|H)?$/);
  if (!match) return -1;

  const candidateCri = Number(match[2]) * 10;
  const candidateCct = Number(match[3]) * 100;
  if (candidateCri !== requirement.expectedCri || candidateCct !== requirement.expectedCct) return -1;

  const candidateVariant = match[1] || match[4] || "";
  const requestedVariant = normalizeText(requirement.expectedEfficiency || requirement.expectedSuffix);
  let score = 2000;
  if (candidateVariant === requestedVariant) score += 300;
  if (!requestedVariant && !candidateVariant) score += 250;
  // Older H light-colour designations are represented by the current
  // UltraEfficient (UE) variant when the original option no longer exists.
  if (requestedVariant === "H" && candidateVariant === "UE") score += 200;
  if (candidateVariant === "UE") score += 20;
  return score;
}

function findRequirementOption(options, requirement) {
  const exactValues = requirement.type === "COLOR" && requirement.expectedValue
    ? [requirement.expectedValue]
    : requirement.values;
  const exact = options.find((assignment) => requirementMatches(assignment, { ...requirement, values: exactValues }));
  if (exact) return exact;
  return options
    .map((assignment) => ({
      assignment,
      score: Math.max(
        fixedColorScore(assignment, requirement),
        tunableColorScore(assignment, requirement),
      ),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.assignment || null;
}

function controlPreference(assignment, requirements, selected) {
  const value = normalizeText(assignment.valueName);
  let score = 0;
  if (/^DIA-E$/.test(value)) score += 100;
  else if (/^DIA$/.test(value)) score += 80;
  else if (/^PSD-E$/.test(value)) score += 70;
  else if (/^PSED$/.test(value)) score += 60;
  else if (/^PSD/.test(value)) score += 50;
  if (normalizeText(requirements?.driver).endsWith("-E") && value.endsWith("-E")) score += 20;
  const tunableWhiteSelected = selected.some((entry) => /^TW[789]\d{2}-[789]\d{2}$/i.test(entry.valueName));
  const ultraEfficientSelected = selected.some((entry) => /^(?:UE[789]\d{2}|[789]\d{2}UE)$/i.test(entry.valueName));
  if (tunableWhiteSelected && /^DIA/.test(value)) score += 100;
  if (ultraEfficientSelected && /^PSD/.test(value)) score += 100;
  if (selectedState(assignment.state)) score += 1;
  return score;
}

function configurationRequirements(parsed) {
  if (!parsed) return [];
  const colorWithSuffix = `${parsed.colorCode || ""}${parsed.colorSuffix || ""}`;
  return [
    { key: "generation", type: "TOKEN", values: [parsed.generation] },
    { key: "package", type: "PACKAGE", values: [parsed.package, parsed.packageCanonical] },
    {
      key: "color",
      type: "COLOR",
      values: [colorWithSuffix, parsed.colorCode],
      expectedCri: parsed.cri,
      expectedCct: parsed.cct,
      expectedValue: colorWithSuffix,
      expectedSuffix: parsed.colorSuffix,
      expectedEfficiency: parsed.efficiency,
    },
    { key: "length", type: "TOKEN", values: [parsed.length] },
    { key: "ip", type: "TOKEN", values: [parsed.ip] },
    { key: "ik", type: "TOKEN", values: [parsed.ik] },
    ...(parsed.features || []).map((feature, index) => ({ key: `feature-${index}`, type: "TOKEN", values: [feature] })),
  ].map((requirement) => ({ ...requirement, values: requirement.values.filter(Boolean) }))
    .filter((requirement) => requirement.values.length);
}

function findText(payload, keys) {
  let found = "";
  walk(payload, (value) => {
    if (found || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (!keys.includes(key.toLowerCase())) continue;
      const unwrapped = scalar(entry);
      if (unwrapped.trim()) {
        found = unwrapped.trim();
        break;
      }
    }
  });
  return found;
}

export class ConfiguratorApiClient {
  constructor({
    fetchImpl = globalThis.fetch,
    baseUrl = process.env.SIGNIFY_CONFIGURATOR_API_BASE || DEFAULT_BASE,
    locale = process.env.SIGNIFY_LOCALE || "pt_PT",
    timeoutMs = Number(process.env.SIGNIFY_API_TIMEOUT_MS || 12000),
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.locale = locale;
    this.timeoutMs = timeoutMs;
  }

  endpoint(configuratorId) {
    return `${this.baseUrl}/${encodeURIComponent(configuratorId)}/${encodeURIComponent(this.locale)}`;
  }

  async request(configuratorId, { method = "POST", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint(configuratorId), {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: process.env.SIGNIFY_CONFIGURATOR_ORIGIN || "https://www.lighting.philips.com",
          Referer: `${process.env.SIGNIFY_CONFIGURATOR_ORIGIN || "https://www.lighting.philips.com"}/prof/configurator`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      const timeout = error?.name === "AbortError";
      throw new ConfiguratorApiError(timeout ? "TIMEOUT" : "NETWORK_ERROR", timeout ? "A Signify Configurator API excedeu o tempo limite." : "A Signify Configurator API está indisponível.", { cause: String(error) });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) throw new ConfiguratorApiError("HTTP_ERROR", `A Signify Configurator API devolveu HTTP ${response.status}.`, { status: response.status, body: text.slice(0, 300) });
    if (!text.trim()) throw new ConfiguratorApiError("EMPTY_RESPONSE", "A Signify Configurator API devolveu uma resposta vazia.");
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new ConfiguratorApiError("INVALID_JSON", "A Signify Configurator API devolveu JSON inválido.", { cause: String(error) });
    }
  }

  async update(configuratorId, body) {
    return this.request(configuratorId, { method: "POST", body });
  }

  async bootstrap(configuratorId, familyCode = "") {
    const createConfigId = () => globalThis.crypto?.randomUUID?.() || `cfg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const familyValue = normalizeText(familyCode);
    const starters = [
      { action: "updateValues", assignment: { variableName: "Internal.PLM_BRD", valueName: "SIG" } },
      { action: "updateValues", assignment: { variableName: "Internal.SPADACTIVE", valueName: "1" } },
      ...(familyValue ? [{ action: "updateValues", assignment: { variableName: "Product_Variant.PLM_PFC", valueName: familyValue } }] : []),
    ];

    let lastError = null;
    for (const newAssignment of starters) {
      const body = { configId: createConfigId(), name: configuratorId, existingAssignments: [], newAssignment };
      try {
        let payload = await this.update(configuratorId, body);
        let assignments = collectAssignments(payload);
        if (!assignments.length) continue;
        let configId = findText(payload, ["configid", "config_id"]) || body.configId;
        let existingAssignments = assignments.filter((assignment) => selectedState(assignment.state));

        // Some configurators reject PLM_PFC as the very first assignment but
        // expose it after their normal bootstrap variable has been selected.
        // Discover the family option from that live payload and apply it in the
        // same session.  This is data-driven and works for any family code.
        if (familyValue) {
          const familyOption = assignments.find((assignment) => (
            normalizeText(assignment.valueName) === familyValue
            && /PLM_PFC|PRODUCT.*FAMILY|FAMILY/i.test(assignment.variableName)
          ));
          const familySelected = existingAssignments.some((assignment) => (
            normalizeText(assignment.valueName) === familyValue
            && /PLM_PFC|PRODUCT.*FAMILY|FAMILY/i.test(assignment.variableName)
          ));
          if (familyOption && !familySelected) {
            payload = await this.applyAssignment(configuratorId, configId, existingAssignments, familyOption);
            assignments = collectAssignments(payload);
            configId = findText(payload, ["configid", "config_id"]) || configId;
            existingAssignments = selectedAssignments(payload, existingAssignments);
          }
        }
        return { configId, existingAssignments, payload };
      } catch (error) {
        lastError = error;
      }
    }
    return { error: lastError, payload: null, configId: "", existingAssignments: [] };
  }

  async applyAssignment(configuratorId, configId, existingAssignments, assignment) {
    return this.update(configuratorId, {
      configId,
      name: configuratorId,
      existingAssignments,
      newAssignment: {
        action: "updateValues",
        assignment: { variableName: assignment.variableName, valueName: assignment.valueName },
      },
    });
  }

  async validateControlChange({ configuratorId, familyCode = "", seed, sourceControlClass, targetControlClass, requirements = null }) {
    if (!configuratorId) return { validated: false, reason: "CONFIGURATOR_NOT_AVAILABLE" };

    let session = seed?.configId && Array.isArray(seed.existingAssignments)
      ? { configId: seed.configId, existingAssignments: seed.existingAssignments, payload: null }
      : await this.bootstrap(configuratorId, familyCode);
    if (!session?.configId) {
      return {
        validated: false,
        reason: "CONFIGURATOR_SESSION_NOT_AVAILABLE",
        errorCode: session?.error?.code || null,
        httpStatus: session?.error?.details?.status || null,
      };
    }

    let currentPayload = session.payload;
    let currentAssignments = session.existingAssignments;
    if (!currentPayload) {
      const currentControl = currentAssignments.find((assignment) => {
        const control = assignmentControl(assignment);
        return control === sourceControlClass && isControlText(`${assignment.variableName} ${assignment.valueName}`);
      });
      if (!currentControl) return { validated: false, reason: "CONTROL_VARIABLE_NOT_DISCOVERED" };
      currentPayload = await this.applyAssignment(configuratorId, session.configId, currentAssignments, currentControl);
      currentAssignments = selectedAssignments(currentPayload, currentAssignments);
    }

    let configId = findText(currentPayload, ["configid", "config_id"]) || session.configId;

    // The family is API-derived metadata, not a hard-coded product rule. Some
    // configurators bootstrap at brand/root level, so explicitly select the
    // requested family whenever the API exposes PLM_PFC as a selectable value.
    if (familyCode) {
      const familyOption = collectAssignments(currentPayload).find((assignment) => (
        comparable(assignment.valueName) === comparable(familyCode)
        && /PLM_PFC|PRODUCT.*FAMILY|FAMILY/i.test(assignment.variableName)
        && selectableState(assignment.state)
      ));
      if (familyOption && !selectedState(familyOption.state)) {
        currentPayload = await this.applyAssignment(configuratorId, configId, currentAssignments, familyOption);
        configId = findText(currentPayload, ["configid", "config_id"]) || configId;
        currentAssignments = selectedAssignments(currentPayload, currentAssignments);
      }
    }

    const appliedRequirements = [];
    const unresolvedRequirements = [];
    for (const requirement of configurationRequirements(requirements)) {
      const options = collectAssignments(currentPayload).filter((assignment) => selectableState(assignment.state));
      const option = findRequirementOption(options, requirement);
      if (option && selectedState(option.state)) {
        appliedRequirements.push(requirement.key);
        continue;
      }
      if (!option) {
        unresolvedRequirements.push(requirement.key);
        continue;
      }
      currentPayload = await this.applyAssignment(configuratorId, configId, currentAssignments, option);
      configId = findText(currentPayload, ["configid", "config_id"]) || configId;
      currentAssignments = selectedAssignments(currentPayload, currentAssignments)
        .filter((assignment, index, all) => all.findIndex((entry) => assignmentKey(entry) === assignmentKey(assignment)) === index);
      appliedRequirements.push(requirement.key);
    }

    const options = collectAssignments(currentPayload);
    const sourceOption = options.find((assignment) => (
      assignmentControl(assignment) === sourceControlClass
      && isControlText(`${assignment.variableName} ${assignment.valueName}`)
    ));
    const selectedControl = options.find((assignment) => assignmentControl(assignment) === targetControlClass && selectedState(assignment.state));
    const controlVariable = sourceOption?.variableName || selectedControl?.variableName;
    const targetOption = options.filter((assignment) => (
      (!controlVariable || assignment.variableName === controlVariable)
      && assignmentControl(assignment) === targetControlClass
      && selectableState(assignment.state)
    )).sort((left, right) => (
      controlPreference(right, requirements, currentAssignments)
      - controlPreference(left, requirements, currentAssignments)
    ))[0];
    if (!targetOption) return { validated: false, reason: "TARGET_CONTROL_NOT_SELECTABLE", appliedRequirements, unresolvedRequirements };

    let updated = currentPayload;
    if (!selectedState(targetOption.state)) {
      updated = await this.applyAssignment(configuratorId, configId, currentAssignments, targetOption);
      configId = findText(updated, ["configid", "config_id"]) || configId;
    }

    const finalAssignments = collectAssignments(updated);
    const selectedTarget = finalAssignments.some((assignment) => (
      assignment.variableName === targetOption.variableName
      && assignmentControl(assignment) === targetControlClass
      && selectedState(assignment.state)
    ));
    if (!selectedTarget) return { validated: false, reason: "TARGET_CONTROL_NOT_SELECTED" };

    const description = findText(updated, [
      "commercialdescription",
      "commercial_description",
      "productdescription",
      "product_description",
      "configurationcode",
      "configuration_code",
    ]);
    const orderCodeCandidate = findText(updated, ["12nc", "ordercode", "order_code", "materialnumber", "material_number"]);
    const orderCode = /^\d{12}$/.test(orderCodeCandidate) ? orderCodeCandidate : "";
    if (!description) return { validated: false, reason: "FINAL_COMMERCIAL_DESCRIPTION_NOT_RETURNED" };

    return {
      validated: true,
      description,
      orderCode,
      configuratorId,
      configId: findText(updated, ["configid", "config_id"]) || configId,
      selectedControl: targetOption.valueName,
      appliedRequirements,
      unresolvedRequirements,
      validationSource: "SIGNIFY_CONFIGURATOR_API",
    };
  }
}
