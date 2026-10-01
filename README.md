# Signify Alternative Finder v8

Internal tool for finding a verified PSU/On-Off ↔ PSD/DALI alternative in the official Signify professional-lighting catalogue.

## Safety principle

The application never recommends a generated product string. A standard product is displayed only after:

1. technical ranking against the original requirements; and
2. an exact order-code lookup in the Signify Product API.

If that validation is not possible, the application returns `NO_VERIFIED_ALTERNATIVE`.

## Architecture

- React + Vite frontend.
- Node.js Azure Functions v4 backend.
- API route: `/api/alternative`.
- Signify Product API for catalogue discovery and exact 12NC validation.
- Signify Configurator API validation when the Product API supplies reusable session assignments.

The Azure function registration stays in `api/src/functions/alternative.js`. Matching logic is separated into testable modules under `api/src/lib/`.

## Local commands

```bash
npm ci
npm --prefix api ci
npm test
npm run build
```

Use the Azure Static Web Apps CLI when testing the frontend and API together.

## Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SIGNIFY_PRODUCT_API_BASE` | `https://api.microservices.signify.com/api/product/v1/smc` | Product API base URL |
| `SIGNIFY_CONFIGURATOR_API_BASE` | `https://api.microservices.signify.com/api/configurator/v3/session/update` | Configurator update endpoint |
| `SIGNIFY_LOCALE` | `pt_PT` | Catalogue/configurator locale |
| `SIGNIFY_API_TIMEOUT_MS` | `12000` | Backend request timeout |
| `SIGNIFY_API_MAX_PAGES` | `5` | Maximum Product API pages per search |
| `SIGNIFY_API_RETRIES` | `1` | Retries for transient Product API GET failures |

## Important Configurator limitation

The application does not invent variable names or assignments. It only attempts automatic Configurator validation when an official product record supplies a reusable `configId` and `existingAssignments`. Otherwise it reports that a configurator exists but does not present the configuration as verified.

## Tests

The Node test suite covers:

- pure 12NC parsing;
- `LED150/UE840` normalization;
- direct same-family matching;
- missing-field false positives;
- closest lumen-package matching; and
- prevention of guessed successor families.
