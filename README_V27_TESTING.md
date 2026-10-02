# V27 test gate

This build changes the production `/api/alternative` decision order, not only helper functions.

Authoritative order:
1. Parse original family.
2. Exact Quote product discovery.
3. Progressive-prefix Quote discovery only when exact discovery does not expose a configurable material.
4. Open the discovered Configit model and prove the original family.
5. Reconstruct original attributes and request DALI/PSD.
6. Only when no current-family configurable material was discovered may legacy successor discovery run.

Safety regression: if BDS650N is discovered for BDS670 but Configit is temporarily unavailable, the endpoint must return an unverified BDS650N attempt. It must never migrate to BDS492/BDS490I.

Executed locally before packaging: `npm --prefix api test` -> 63/63 passed, including full-engine tests for BGP702, BVP656, and both BDS670 inputs and a negative test preventing BDS670 -> BDS492 after current-family discovery.

Live limitation: this environment cannot resolve `www.quote.signify.com`, so the external Signify calls cannot be executed live here. V27 adds browser-like request headers and exposes HTTP status/response diagnostics for material endpoint failures.
