import { app } from '@azure/functions';
import { catalogStats } from '../lib/public-catalog-engine.js';
app.http('health',{methods:['GET'],authLevel:'anonymous',handler:async()=>({jsonBody:{status:'OK',version:'34.0.0',pipeline:'CATALOG_2026_EMBEDDED_INDEX_V2',fingerprint:'v34-routing-fix-20261002',...catalogStats()}})});
