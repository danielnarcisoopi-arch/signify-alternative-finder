# Signify Alternative Finder v20 - Catalog Evidence Resolver

This version fixes the discovery order before PSU/PSD conversion.

## Core change
The backend no longer treats broad Product Search similarity as proof of a configurator. It first searches official Quote payloads for explicit configurable-material/configurator evidence, including catalogue-style text fields that can contain comma-separated configurator lists. It never manufactures `<family>I`.

Pipeline:
1. Parse exact family from the input.
2. Query official Quote search with exact family and catalog/configurator-oriented queries.
3. Extract only configurator/material identifiers actually present in returned official payloads (dedicated fields or explicit catalogue/configurator text).
4. Open each candidate in the Quote Configit model endpoint.
5. Accept the candidate only when the model itself can reproduce/prove the original family.
6. Reconstruct original attributes from model domains.
7. Change only the semantic control/driver variable to a selectable DALI option.
8. Accept only server-valid, conflict-free configurations.

This supports relationships whose names differ (for example a family represented by a differently named configurable material) without a hard-coded family map.

## Important
The automated test suite is local/mocked contract testing; it is not a live Signify acceptance test. Live correctness must be verified against the authenticated Signify Quote/catalog environment.
