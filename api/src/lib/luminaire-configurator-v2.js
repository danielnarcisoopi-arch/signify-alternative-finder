const BASE_URL = "https://luminaireconfigurator-v2.azurewebsites.net/api";

const KNOWN_CATALOGS = [
  { segment: "Road", role: 2 },
  { segment: "Urban", role: 1 },
];

function timeoutSignal(ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function getJson(url) {
  const t = timeoutSignal();
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: t.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    t.done();
  }
}

export async function findOutdoorFamily(familyCode) {
  const code = String(familyCode || "").trim().toUpperCase();
  if (!code) return null;
  for (const catalog of KNOWN_CATALOGS) {
    const qs = "includesEto=false&includesIsPreliminary=false&includesIsInPreparation=false";
    const url = `${BASE_URL}/luminairefamilies/${encodeURIComponent(catalog.segment)}/${catalog.role}?${qs}`;
    const rows = await getJson(url);
    if (!Array.isArray(rows)) continue;
    const matches = rows.filter((row) => String(row?.code || "").toUpperCase() === code);
    if (!matches.length) continue;
    return {
      verified: true,
      source: "Signify Luminaire Configurator V2",
      segment: catalog.segment,
      code,
      families: matches.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        isInProduction: row.isInProduction,
        canBeSensorReady: row.canBeSensorReady,
        canHaveConstantLightOutput: row.canHaveConstantLightOutput,
        isSrWithDaliEnabled: row.isSrWithDaliEnabled,
        isZhagaD4iEnabled: row.isZhagaD4iEnabled,
        lumenMaintenanceHours: row.lumenMaintenanceHours,
      })),
      checkedAt: new Date().toISOString(),
    };
  }
  return null;
}

export async function enrichWithLuminaireConfiguratorV2(result) {
  const family = result?.recommended?.family || result?.original?.family;
  if (!family) return result;
  // The V2 site discovered today covers Outdoor (Urban/Road/Sports/Solar).
  // Only Road/Urban contracts were captured and verified, so do not guess Sports/Solar routes.
  const outdoorLike = /^(?:BGP|BDP|EDP|BSP|BPS|BDS|BSS|BPP)\w*/i.test(family);
  if (!outdoorLike) {
    // Indoor families do not use this Outdoor configurator. Keep this internal
    // instead of showing a noisy "not applicable" warning to the end user.
    return result;
  }
  const evidence = await findOutdoorFamily(family);
  return {
    ...result,
    technicalValidation: evidence
      ? { applicable: true, ...evidence }
      : {
          applicable: true,
          verified: false,
          source: "Signify Luminaire Configurator V2",
          reason: "OUTDOOR_FAMILY_NOT_FOUND_IN_VERIFIED_CATALOGS",
          scope: "Road + Urban contracts verified; Sports/Solar require captured contracts before they can be queried safely",
          checkedAt: new Date().toISOString(),
        },
  };
}
