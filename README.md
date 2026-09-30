# Signify Alternative Finder - Catalog Discovery v1

This version uses the discovered Signify product microservice at runtime to determine whether a family exists in the current catalogue and to discover current-family candidates dynamically.

Safety contract: a generated string is never shown as a valid product. A family candidate is explicitly labelled as requiring validation. A concrete recommendation must later be validated through SKU data or the Signify configurator API.

Next integration step: configurator-session discovery/initialization for arbitrary configurable models. Do not hardcode session IDs or personal/session authorization values.
