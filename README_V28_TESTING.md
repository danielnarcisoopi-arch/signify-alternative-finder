# V28 validation

This package restores the non-empty V26 frontend entrypoint while keeping the V27 single-pipeline backend.

Pre-package checks executed:
- frontend index.html is non-empty and references /src/main.jsx
- src/main.jsx and src/style.css exist
- API test suite passes (63/63)
- GET /api/alternative reports version 28.0.0

Deployment gate: after deploy, verify the page renders before testing product resolution.
