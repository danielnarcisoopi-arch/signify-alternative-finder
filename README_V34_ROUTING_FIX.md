# V34 - Azure routing fix

This version fixes the V33 API deployment issue.

Changes:
- `/api/health`, `/api/selftest`, and `/api/alternative` are each registered in a separate Azure Functions entrypoint.
- The 2026 catalogue knowledge base is compiled into a JavaScript module. Runtime filesystem reads are no longer required during Azure Functions cold start.
- The public-catalog resolver remains local and does not require Quote authentication, Google, CORS, or live web scraping.
- Fingerprint: `v34-routing-fix-20261002`.

Deployment verification order:
1. `/api/health`
2. `/api/selftest`
3. Frontend searches

Expected health version: `34.0.0`.
