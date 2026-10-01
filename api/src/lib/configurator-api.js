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

function collectAssignments(payload) {
  const assignments = [];
  walk(payload, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const variableName = value.variableName ?? value.variable_name;
    const valueName = value.valueName ?? value.value_name;
    if (typeof variableName === "string" && typeof valueName === "string") {
      assignments.push({ variableName, valueName, state: value.state || value.optionState || "" });
    }
  });
  return assignments;
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

function configurationRequirements(parsed) {
  if (!parsed) return [];
  const colorWithSuffix = `${parsed.colorCode || ""}${parsed.colorSuffix || ""}`;
  return [
    { key: "generation", type: "TOKEN", values: [parsed.generation] },
    { key: "package", type: "PACKAGE", values: [parsed.package, parsed.packageCanonical] },
    { key: "color", type: "TOKEN", values: [colorWithSuffix, parsed.colorCode] },
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
      const unwrapped = entry && typeof entry === "object" && Object.hasOwn(entry, "value") ? entry.value : entry;
      if ((typeof unwrapped === "string" || typeof unwrapped === "number") && String(unwrapped).trim()) {
        found = String(unwrapped).trim();
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
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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

  async bootstrap(configuratorId) {
    const generatedConfigId = globalThis.crypto?.randomUUID?.() || `cfg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const common = { configId: generatedConfigId, name: configuratorId, existingAssignments: [] };
    const attempts = [
      { ...common, newAssignment: { action: "updateValues", assignment: {} } },
      common,
    ];
    let lastError = null;
    for (const body of attempts) {
      try {
        const payload = await this.update(configuratorId, body);
        const assignments = collectAssignments(payload);
        if (!assignments.length) continue;
        return {
          configId: findText(payload, ["configid", "config_id"]) || generatedConfigId,
          existingAssignments: assignments.filter((assignment) => selectedState(assignment.state)),
          payload,
        };
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

  async validateControlChange({ configuratorId, seed, sourceControlClass, targetControlClass, requirements = null }) {
    if (!configuratorId) return { validated: false, reason: "CONFIGURATOR_NOT_AVAILABLE" };

    let session = seed?.configId && Array.isArray(seed.existingAssignments)
      ? { configId: seed.configId, existingAssignments: seed.existingAssignments, payload: null }
      : await this.bootstrap(configuratorId);
    if (!session?.configId) return { validated: false, reason: "CONFIGURATOR_SESSION_NOT_AVAILABLE" };

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
    const appliedRequirements = [];
    const unresolvedRequirements = [];
    for (const requirement of configurationRequirements(requirements)) {
      const options = collectAssignments(currentPayload).filter((assignment) => selectableState(assignment.state));
      const alreadySelected = options.find((assignment) => selectedState(assignment.state) && requirementMatches(assignment, requirement));
      if (alreadySelected) {
        appliedRequirements.push(requirement.key);
        continue;
      }
      const option = options.find((assignment) => requirementMatches(assignment, requirement));
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
    const selectedControl = options.find((assignment) => assignmentControl(assignment) === targetControlClass && selectedState(assignment.state));
    const sourceOption = options.find((assignment) => (
      assignmentControl(assignment) === sourceControlClass
      && isControlText(`${assignment.variableName} ${assignment.valueName}`)
    ));
    const controlVariable = selectedControl?.variableName || sourceOption?.variableName;
    const targetOption = selectedControl || options.find((assignment) => (
      (!controlVariable || assignment.variableName === controlVariable)
      && assignmentControl(assignment) === targetControlClass
      && selectableState(assignment.state)
    ));
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
