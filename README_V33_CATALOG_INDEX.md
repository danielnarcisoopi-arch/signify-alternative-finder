# V33 - Catalog 2026 Local Index

This version removes live Quote and live web search from family/configurator discovery.

- Source: `Catálogo de iluminação profissional 2026_LR.pdf`
- Knowledge base: `api/src/data/catalog-2026-kb.json`
- 154 family/configurator entries extracted from 77 catalog groups/pages with configurator evidence.
- `/api/health` reports the catalog index size.
- `/api/selftest` runs the same resolver used by `/api/alternative`.

Important: the catalog says Metronomis BDS670 uses configurator **BDS650I** on catalog page 191. It does not contain BDS650N. V33 therefore reports BDS650I rather than inventing BDS650N.

The final PSU/PSD commercial configuration is intentionally not fabricated when the catalog proves only the configurator relationship.
