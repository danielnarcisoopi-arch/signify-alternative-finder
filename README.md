# Signify Alternative Finder v11

Internal tool for finding a verified PSU/On-Off ↔ PSD/DALI alternative in the official Signify professional-lighting catalogue.

## What v11 changes

- Reads enriched family metadata from the Product API instead of treating search results as a flat list of articles.
- Discovers a current successor family dynamically from official family identity, family-name continuity and the requested technical signature.
- Rejects weak or ambiguous successor evidence; there is no product-specific replacement table.
- Supports current products that exist only in a configurator and therefore may not have a 12NC.
- Bootstraps a Configurator session when an official reusable session is not supplied, then discovers variable names and selectable values from API responses.
- Keeps exact 12NC revalidation for every standard catalogue product.
- Continues successor discovery when the obsolete family is no longer returned anywhere in the current catalogue.
- Uses repeated enriched-facet evidence plus a unique technical signature to identify configurator-only current families.
- Understands tunable-white ranges such as `TW927-965` and verifies that the requested fixed CRI/CCT is covered by the range.
- Prefers the Configurator-native `DIA-E` DALI option when it is selectable and preserves the requested emergency suffix.
- Reads both flat assignments and hierarchical Configurator responses where a parent variable contains child `values`/`options`.
- Sends the official configurator page origin/referer on server-side session calls.
- Reports the precise safe failure stage for every discovered configurator instead of discarding the reason.

## Validation rules

There are two valid recommendation paths:

1. **Standard article:** the technical match is ranked and the exact 12NC is looked up again in the Product API.
2. **Configurable article:** the Product API supplies the official configurator identity, the requested values are selected using options returned at runtime, and the final commercial description is returned by the Configurator API. A 12NC is optional in this path.

The application never presents a locally generated description as a product. If neither validation path succeeds, it returns `NO_VERIFIED_ALTERNATIVE`.

Exact configurable regressions include:

- `DN571B LED40S/930H PSU-E C WH PGO` → configurator `DN610BI` → `DN610B 40S/TW927-965 DIA-E C WH PGO`.
- `DN500B 20S/840 PSU-E WR WH PCO` → configurator `DN500BI` → `DN500B 20S/840 DIA-E WR WH PCO`.

These are test fixtures only; the production engine contains no fixed family replacement map.

## Successor discovery

Successor discovery does not contain mappings such as `DN571B → DN610B`. Candidate current families are scored using:

- an explicit successor/replacement field when the Product API provides one;
- continuity of the official family/range name;
- structural family-code prefix;
- preservation of package, CRI/CCT, generation, length, IP/IK and feature tokens;
- availability of the requested target control and an official configurator.

A family change is accepted only when the evidence clears a confidence threshold and is not ambiguous. The chosen standard product or configuration still has to pass its own official validation.

## Architecture

- React + Vite frontend.
- Node.js Azure Functions v4 backend.
- API route: `/api/alternative`.
- `product-api.js`: catalogue, enriched family metadata and exact 12NC verification.
- `successor-discovery.js`: generic current-family discovery and confidence gating.
- `configurator-api.js`: dynamic session bootstrap and assignment discovery.
- `matcher.js`: technical comparison and safety blockers.
- `engine.js`: orchestration and result contract.

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
| `SIGNIFY_CONFIGURATOR_API_BASE` | `https://api.microservices.signify.com/api/configurator/v3/session/update` | Configurator session-update endpoint |
| `SIGNIFY_LOCALE` | `pt_PT` | Catalogue/configurator locale |
| `SIGNIFY_API_TIMEOUT_MS` | `12000` | Backend request timeout |
| `SIGNIFY_API_MAX_PAGES` | `5` | Maximum Product API pages per search |
| `SIGNIFY_API_RETRIES` | `1` | Retries for transient Product API GET failures |
| `SIGNIFY_CONFIGURATOR_ORIGIN` | `https://www.lighting.philips.com` | Origin and referer used for Configurator API requests |

## Tests

The test suite covers standard same-family alternatives, Product API pagination and family enrichment, generic successor discovery, ambiguous-family prevention, Configurator bootstrap without fixed variable names, configurable-only products without a 12NC, inverse DALI → On/Off conversion, and regressions for DN142B, WT120C and BY120P.

## V16 - constraint-first Configit engine

V16 changes the core resolution strategy. The finder now prefers the same Signify Quote material-model endpoint observed in the official Configit workflow (`/api/material/getFromExistingConfigurationWithStatus`) when an official configurable material is discovered.

The engine applies the parsed original attributes to the live model using official variable domains (for example `PLM_PFC`, `PLM_LAMPFAM`, `PLM_COLLAMP`, `PLM_OPTGRP`, `PLM_CVR`), resolves remaining commercial tokens only when there is a unique model option, and changes `PLM_TRAFO` only after the original attributes have been applied. A DALI result is accepted only when the model keeps the configuration valid and conflict-free. The older configurator/session and Product API paths remain as fallbacks.

This is intentionally constraint-first: search results discover candidate products/configurators; the Configit model decides whether the requested configuration is valid.
