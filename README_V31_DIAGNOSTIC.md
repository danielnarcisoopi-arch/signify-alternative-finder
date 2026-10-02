# V31 Diagnostic Configit-Only

This build adds three independent diagnostic endpoints. They do not call the legacy Product API matcher, successor resolver, Luminaire Configurator V2, or any old fallback path.

- GET `/api/diag-health`
- POST `/api/diag-alternative` with `{ "query": "..." }`
- GET `/api/diag-selftest`

The diagnostic engine uses one path only:
1. Parse original family.
2. Search Signify Quote Product Search exactly, then progressively shorten the family code if needed.
3. Accept only items identified as `MaterialType = Configuration material` (or equivalent direct configuration-material shape).
4. Open the discovered material in Quote/Configit.
5. Prove the original family inside the model.
6. Reconstruct attributes and select DALI/PSD.
7. Validate the final Configit model state.

There is intentionally no successor resolver in this engine. BDS492/BDS490I cannot be produced by this code path.
