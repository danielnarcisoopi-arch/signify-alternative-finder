const ON_OFF_CODES = new Set(["PSU", "PSU-E", "PSUE", "PSR"]);
const DALI_CODES = new Set([
  "PSD",
  "PSD-E",
  "PSDE",
  "PSD-SR",
  "PSD-SRE",
  "DIA",
  "DIA-E",
  "PSED",
]);

const IGNORED_TOKENS = new Set([
  "LED",
  "LM",
  "W",
  "CRI",
  "SIGNIFY",
  "PHILIPS",
  "LUMINAIRE",
  "LIGHT",
]);

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeControlCode(value) {
  const code = normalizeText(value).replace(/_/g, "-");
  if (ON_OFF_CODES.has(code)) return "ON_OFF";
  if (DALI_CODES.has(code)) return "DALI";
  return "UNKNOWN";
}

export function oppositeControl(controlClass) {
  if (controlClass === "ON_OFF") return "DALI";
  if (controlClass === "DALI") return "ON_OFF";
  return "UNKNOWN";
}

export function controlSearchTerms(controlClass, sourceDriver = "") {
  const emergency = normalizeText(sourceDriver).endsWith("-E");
  if (controlClass === "DALI") {
    return emergency
      ? ["PSD-E", "DIA-E", "DALI", "PSD", "PSED"]
      : ["PSD", "DALI", "DIA", "PSED", "PSD-E"];
  }
  if (controlClass === "ON_OFF") {
    return emergency ? ["PSU-E", "PSU", "ON/OFF"] : ["PSU", "PSU-E", "ON/OFF"];
  }
  return [];
}

function canonicalPackage(token) {
  const normalized = normalizeText(token);
  const match = normalized.match(/^LED(\d+(?:-\d+)?)(S)?$/) || normalized.match(/^(\d+(?:-\d+)?)S$/);
  if (!match) return null;
  const number = match[1];
  const hasS = Boolean(match[2]) || /S$/.test(normalized);
  return {
    raw: normalized,
    canonical: `${number}${hasS ? "S" : ""}`,
    number: Number(number.split("-")[0]),
    ledPrefix: normalized.startsWith("LED"),
  };
}

function parseColorToken(token) {
  const normalized = normalizeText(token);
  const tunable = normalized.match(/^TW([789]\d{2})-([789]\d{2})$/);
  if (tunable) {
    const start = tunable[1];
    const end = tunable[2];
    return {
      raw: normalized,
      efficiencyPrefix: "",
      colorCode: normalized,
      cri: Math.min(Number(start[0]), Number(end[0])) * 10,
      cct: Number(start.slice(1)) * 100,
      cctMin: Math.min(Number(start.slice(1)), Number(end.slice(1))) * 100,
      cctMax: Math.max(Number(start.slice(1)), Number(end.slice(1))) * 100,
      suffix: "",
      tunableWhite: true,
    };
  }
  const match = normalized.match(/^(UE|HE|NE)?([789]\d{2})([A-Z]*)$/);
  if (!match) return null;
  const trailing = match[3] || "";
  const trailingEfficiency = /^(UE|HE|NE)$/.test(trailing) ? trailing : "";
  return {
    raw: normalized,
    efficiencyPrefix: match[1] || trailingEfficiency,
    colorCode: match[2],
    cri: Number(match[2][0]) * 10,
    cct: Number(match[2].slice(1)) * 100,
    suffix: trailingEfficiency ? "" : trailing,
    cctMin: Number(match[2].slice(1)) * 100,
    cctMax: Number(match[2].slice(1)) * 100,
    tunableWhite: false,
  };
}

function firstMatch(tokens, pattern) {
  return tokens.find((token) => pattern.test(token)) || "";
}

export function extractFamilyCode(value) {
  const normalized = normalizeText(value);
  return (normalized.match(/\b[A-Z]{1,5}\d{2,4}[A-Z]{0,2}\b/) || [""])[0];
}

export function parseReference(value) {
  const input = normalizeText(value);
  const pureOrderCode = /^\d{8,18}$/.test(input) ? input : "";
  const leadingOrderCode = input.match(/^(\d{8,18})\s*[-:]?\s+(.+)$/);
  const orderCode = pureOrderCode || leadingOrderCode?.[1] || "";
  const reference = leadingOrderCode?.[2] || (pureOrderCode ? "" : input);
  const tokens = reference.replace(/\//g, " ").split(/\s+/).filter(Boolean);
  const family = extractFamilyCode(reference);
  const generation = firstMatch(tokens, /^G\d+[A-Z]*$/);
  const length = firstMatch(tokens, /^L\d+(?:X\d+)?$/);
  const driver = tokens.find((token) => normalizeControlCode(token) !== "UNKNOWN") || "";
  const controlClass = normalizeControlCode(driver);
  const packageInfo = tokens.map(canonicalPackage).find(Boolean) || null;
  const colorInfo = tokens.map(parseColorToken).find(Boolean) || null;
  const efficiencyToken = tokens.find((token) => /^(UE|HE|NE)$/.test(token)) || colorInfo?.efficiencyPrefix || "";
  const ip = firstMatch(tokens, /^IP\d{2,3}[A-Z]?$/);
  const ik = firstMatch(tokens, /^IK\d{2}$/);

  const consumed = new Set([
    family,
    generation,
    length,
    driver,
    packageInfo?.raw,
    colorInfo?.raw,
    efficiencyToken,
    ip,
    ik,
  ].filter(Boolean));

  const features = tokens.filter((token) => {
    if (consumed.has(token) || IGNORED_TOKENS.has(token)) return false;
    if (/^\d{8,18}$/.test(token)) return false;
    if (/^\d+(?:[.,]\d+)?(?:W|LM|K)$/.test(token)) return false;
    return token.length > 0;
  });

  return {
    input,
    reference,
    inputType: pureOrderCode ? "ORDER_CODE" : "REFERENCE",
    orderCode,
    family,
    generation,
    driver,
    controlClass,
    targetControlClass: oppositeControl(controlClass),
    package: packageInfo?.raw || "",
    packageCanonical: packageInfo?.canonical || "",
    packageNumber: packageInfo?.number || null,
    colorCode: colorInfo?.colorCode || "",
    cri: colorInfo?.cri || null,
    cct: colorInfo?.cct || null,
    cctMin: colorInfo?.cctMin || null,
    cctMax: colorInfo?.cctMax || null,
    tunableWhite: colorInfo?.tunableWhite || false,
    colorSuffix: colorInfo?.suffix || "",
    efficiency: efficiencyToken,
    length,
    ip,
    ik,
    features: [...new Set(features)],
  };
}

export function displayControl(controlClass) {
  if (controlClass === "DALI") return "DALI";
  if (controlClass === "ON_OFF") return "On/Off";
  return "Unknown";
}

export const CONTROL_FILTER_KEYS = {
  DALI: "FK_LP_DIMMING_CONTROLS_DALI",
  ON_OFF: "FK_LP_DIMMING_CONTROLS_NO",
};
