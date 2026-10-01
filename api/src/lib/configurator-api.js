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

function findText(payload, keys) {
  let found = "";
  walk(payload, (value, path) => {
    if (found || typeof value !== "string") return;
    const key = String(path[path.length - 1] || "").toLowerCase();
    if (keys.includes(key) && value.trim()) found = value.trim();
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

  async update(configuratorId, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint(configuratorId), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
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

  async validateControlChange({ configuratorId, seed, sourceControlClass, targetControlClass }) {
    if (!configuratorId || !seed?.configId || !Array.isArray(seed.existingAssignments)) {
      return { validated: false, reason: "CONFIGURATOR_SESSION_NOT_AVAILABLE" };
    }

    const currentControl = seed.existingAssignments.find((assignment) => {
      const control = assignmentControl(assignment);
      return control === sourceControlClass && isControlText(`${assignment.variableName} ${assignment.valueName}`);
    });
    if (!currentControl) return { validated: false, reason: "CONTROL_VARIABLE_NOT_DISCOVERED" };

    const discovery = await this.update(configuratorId, {
      configId: seed.configId,
      name: configuratorId,
      existingAssignments: seed.existingAssignments,
      newAssignment: {
        action: "updateValues",
        assignment: { variableName: currentControl.variableName, valueName: currentControl.valueName },
      },
    });

    const options = collectAssignments(discovery);
    const targetOption = options.find((assignment) => (
      assignment.variableName === currentControl.variableName
      && assignmentControl(assignment) === targetControlClass
      && selectableState(assignment.state)
    ));
    if (!targetOption) return { validated: false, reason: "TARGET_CONTROL_NOT_SELECTABLE" };

    const configId = findText(discovery, ["configid", "config_id"]) || seed.configId;
    const existingAssignments = collectAssignments(discovery).filter((assignment) => selectedState(assignment.state));
    const updated = await this.update(configuratorId, {
      configId,
      name: configuratorId,
      existingAssignments: existingAssignments.length ? existingAssignments : seed.existingAssignments,
      newAssignment: {
        action: "updateValues",
        assignment: { variableName: targetOption.variableName, valueName: targetOption.valueName },
      },
    });

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
      validationSource: "SIGNIFY_CONFIGURATOR_API",
    };
  }
}
