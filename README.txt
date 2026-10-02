Signify Alternative Finder V35 - Static Catalog Engine
======================================================
Deploy the CONTENTS of this folder as the static website root.
No Azure Functions are required. There is intentionally no /api directory.

Validation after deploy:
1. Open /selftest.html
2. The page must load. It uses the exact same resolver and catalog index as index.html.
3. Then test the main Finder.

Data source: Signify Professional Lighting Catalogue 2026 supplied by the user.
The generated catalog index contains 145 family/configurator relationships and 267 commercial PSU/PSD/DALI-related product rows extracted from the catalogue.

Safety rule: A catalog-confirmed configurator is not presented as a fully validated Configit configuration. A commercial alternative is only labelled confirmed when a sufficiently close catalog SKU/EOC is present.
