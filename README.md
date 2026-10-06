# Signify Alternative Finder V52

## Universal Competitor Engine

V52 keeps the existing Signify PSU/PSD finder and replaces the competitor discovery layer with a universal pipeline.

### Runtime architecture
- Static frontend: `index.html`
- Azure Functions API: `api/function_app.py`
- Endpoint: `POST /api/competitor/search`
- Health: `GET /api/health`

### Universal pipeline
1. Extract a likely product reference from noisy RFQ prose.
2. Parse technical tokens already present in the input (W, CCT/840, IP/IK, nominal length).
3. Detect an explicitly named manufacturer when present.
4. If no manufacturer is written, discover it from official-domain results.
5. Search exact and progressively relaxed reference variants.
6. Treat SEARCH/CATEGORY pages only as navigation nodes.
7. Follow relevant official links up to two levels.
8. Accept only PRODUCT_PAGE/DATASHEET as high-confidence evidence.
9. Extract structured HTML tables, definition lists, JSON-LD and technical text with per-field provenance.
10. Preserve conflicting source values instead of silently selecting one.
11. Frontend applies hard filters, coverage-aware scoring and human-vs-algorithm audit.

### Manufacturer configuration
Adding a manufacturer should normally require only an entry in `MANUFACTURERS`: aliases, official domains and optional official-site search URL patterns. The crawler, classifier and extractor are shared.

Current configured manufacturers: OPPLE, LEDVANCE, TRILUX, ZUMTOBEL, THORN, SCHREDER, DISANO, GEWISS.

### Important production setting
For robust discovery across arbitrary products, configure Azure Static Web App environment variable:

`BRAVE_SEARCH_API_KEY=<your key>`

Without it, V52 still crawls configured manufacturers' official site-search endpoints, but coverage depends on each manufacturer's search implementation. A web search provider is required for genuinely broad, brand-agnostic discovery.

No API key is placed in `index.html`.

### Azure deployment
App location: `/`
API location: `api`
Output location: empty

After deployment, `/api/health` must return version `52` and engine `UNIVERSAL_COMPETITOR_ENGINE`.
