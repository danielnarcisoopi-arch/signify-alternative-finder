# V32 - Public Catalog Evidence Engine

This branch deliberately removes Quote authentication as a runtime dependency for family/configurator discovery.

Pipeline: reference parser -> progressive family search -> official Signify public pages/assets -> evidence scoring -> configurator candidate.

Safety rules:
- No family-to-configurator hardcoded mapping.
- Name similarity alone cannot produce a verified result.
- Exact family+I discovered in official Signify context can be marked OFFICIAL_CONFIGURATOR_IDENTIFIED.
- Cross-code relations (e.g. BDS670 -> BDS650N) remain candidate/unverified until public evidence proves the relation.
- A configurator discovery is not represented as a validated final PSU/PSD configuration.
