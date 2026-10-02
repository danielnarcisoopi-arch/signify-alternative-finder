import { app } from '@azure/functions';
import { engine } from '../lib/engine.js';

const VERSION = '30.0.0';
const PIPELINE = 'CONFIGIT_ONLY_CURRENT_FAMILY_V1';
const FINGERPRINT = 'v30-selftest-trace-20261002';

const CASES = [
  { id: 'BGP702', query: 'BGP702 LED90/730 DX10P LGR 7035 SRG10 42', family: 'BGP702', configurator: 'BGP702I' },
  { id: 'BVP656', query: 'BVP656 LED400-4S/730 PSU II A35-MB GR', family: 'BVP656', configurator: 'BVP656I' },
  { id: 'BDS670_LED50', query: 'BDS670 LED50/730 MDA BK SRT SRG10 60P', family: 'BDS670', configurator: 'BDS650N', forbidden: ['BDS492','BDS490I'] },
  { id: 'BDS670_LED40', query: 'BDS670 LED40/730 MDM BK SRT SRG10 60P', family: 'BDS670', configurator: 'BDS650N', forbidden: ['BDS492','BDS490I'] },
];

function summarize(c, result) {
  const found = [result?.recommended?.configuratorId, ...(result?.configurators || []).map(x => x.id), ...(result?.trace || []).flatMap(x => x.candidates || [])].filter(Boolean);
  const text = JSON.stringify(result || {});
  const gates = {
    engineVersion: result?.engineVersion === VERSION,
    pipeline: result?.pipeline === PIPELINE,
    family: result?.original?.family === c.family || result?.currentFamily === c.family,
    configurator: found.includes(c.configurator),
    noForbiddenSuccessor: !(c.forbidden || []).some(x => text.includes(x)),
    successorSkippedWhenCurrentConfiguratorFound: (result?.trace || []).some(x => x.stage === 'SUCCESSOR_SEARCH' && x.status === 'SKIPPED'),
    finalVerified: result?.status === 'VERIFIED_CONFIGURABLE_PRODUCT' && result?.validation?.verified === true && result?.recommended?.family === c.family && result?.recommended?.configuratorId === c.configurator,
  };
  return { id:c.id, query:c.query, expected:{family:c.family,configurator:c.configurator}, pass:Object.values(gates).every(Boolean), gates, status:result?.status || null, reason:result?.reason || null, recommended:result?.recommended || null, trace:result?.trace || [], configurators:result?.configurators || [], details:result?.details || null };
}

app.http('health', {
  methods: ['GET'], authLevel: 'anonymous',
  handler: async () => ({ jsonBody: { status:'OK', version:VERSION, pipeline:PIPELINE, fingerprint:FINGERPRINT, timestamp:new Date().toISOString() } }),
});

app.http('selftest', {
  methods: ['GET'], authLevel: 'anonymous',
  handler: async () => {
    const started = Date.now();
    const cases = [];
    for (const c of CASES) {
      try { cases.push(summarize(c, await engine(c.query))); }
      catch (e) { cases.push({ id:c.id, query:c.query, pass:false, error:e?.message || String(e), stack:process.env.NODE_ENV==='development'?e?.stack:undefined }); }
    }
    const pass = cases.every(x => x.pass);
    return { status: pass ? 200 : 503, jsonBody: { status:pass?'PASS':'FAIL', version:VERSION, pipeline:PIPELINE, fingerprint:FINGERPRINT, durationMs:Date.now()-started, cases } };
  },
});
