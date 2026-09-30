# Signify Alternative Finder - Family Ranking v2

Improvements:
- Current family: verifies that the same family has products with the opposite control mode (DALI vs On/Off) using Signify product facets.
- Old family: ranks current catalogue families automatically and returns only the strongest current-family match instead of dumping all candidates.
- Safety gate remains strict: no concrete commercial designation or 12NC is synthesized. Final SKU/configuration awaits a product-results/configurator validation endpoint.

No hardcoded old-family -> new-family mapping is used.
