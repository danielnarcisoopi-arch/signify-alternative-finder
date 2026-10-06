Signify Alternative Finder V43

Correction: Quote-aware configurator resolver.
- Real Quote symbolic configurator IDs take precedence over legacy catalogue/material aliases.
- Generic stem resolution handles cases where catalogue lists *I but Quote exposes a current *N configurator.
- BDS670/BDS650 Metronomis now resolves to BDS650N when the Quote Product DB contains that symbolic configurator.
- No BDS670-specific hard-coded mapping was added.
- Existing BGP702I, BVP656I, DN500BI, DN610BI and SM350CI regressions remain covered.
- selftest.html contains 11 tests, including both BDS670 LED40 and LED50 cases.
