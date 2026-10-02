# Signify Alternative Finder v22 — Progressive Prefix Configit Discovery

This version is focused on configurator discovery before control conversion.

## Discovery order
1. Exact family search in the official Quote product service.
2. If no configurable material is returned, progressively shorten the family query one character at a time (for example `BDS670 -> BDS67 -> BDS6`).
3. A prefix hit is only a **candidate**. The Configit model must prove that it contains the original family before it is accepted.
4. Only after model proof are the original attributes reconstructed and the control/driver changed to the requested DALI/On-Off class.
5. Broad successor/catalog heuristics are last-resort fallback only.

This means there is no hardcoded `BDS670 -> BDS650N`, `BGP702 -> BGP702I`, or `BVP656 -> BVP656I` mapping.

## Grounding
The exact BGP702 discovery shape was verified against the supplied Quote HAR: an exact `BGP702` search returns configurable material `BGP702I`. The BDS670 progressive-prefix strategy is implemented from the user's observed Quote workflow; it still requires live Configit model proof before a result can be presented as verified.

## Tests
`cd api && npm test`

The test suite is local/contract coverage only. It is not presented as live Signify validation.
