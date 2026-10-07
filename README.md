# Signify Alternative Finder V55

## Main change
V55 fixes the slow/failed competitor discovery seen in V52.

The crawler no longer checks up to 70 pages serially. The search budget is capped and official manufacturer documents are used as a fast exact-reference fallback when configured. Search/category pages remain navigation-only and are never promoted to technical product evidence.

### OPPLE
The official OPPLE 2026 Product Book is configured as an official document source. Exact references can therefore be resolved from the official catalog even when OPPLE's website search is dynamic or does not expose product links to a server-side crawler.

The generic architecture remains the same: manufacturer-specific data is configuration (domains, search paths, optional official catalogs); parsing, classification, extraction, provenance and scoring are shared.

## Azure deployment
Same layout as V52:
- App location: `/`
- API location: `api`
- Output location: blank

After deploy, `/api/health` must show `version: 53`.

## Optional but recommended
Set `BRAVE_SEARCH_API_KEY` in Azure Static Web App environment variables for scalable discovery across manufacturers whose own site search is JavaScript-only or otherwise crawler-unfriendly. No API key is exposed to the frontend.


## V55 universal discovery changes
- Manufacturer is optional. With BRAVE_SEARCH_API_KEY, exact-reference web discovery can identify the manufacturer from official-domain results.
- Registry expanded; manufacturer configuration is data, not matching logic.
- Object classifier separates LUMINAIRE, LED_MODULE, LED_DRIVER, LAMP, CONTROL and ACCESSORY.
- Dynamic Signify candidate discovery searches only official signify.com pages and only promotes concrete products with a 12NC.
- Dynamic Signify candidates are merged with the verified local pool before hard filters and scoring.
- HTTP work is bounded; dynamic candidate fetches run in parallel.
- For broad, unknown manufacturers/products, configure BRAVE_SEARCH_API_KEY in Azure Static Web App environment variables. Without it, known official-domain adapters still work but arbitrary manufacturer discovery cannot be guaranteed.
