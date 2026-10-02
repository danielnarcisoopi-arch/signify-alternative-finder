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

## v23 - HAR replay fixes

This release fixes configurator discovery using captured traffic from the real Signify Quote UI.

- Product Search now sends `soldTo=null&shipTo=null`, matching the real Quote request exactly.
- Exact discovery is authoritative only when Quote exposes a strong configurable-material field/item; weak model text no longer stops discovery too early.
- Progressive prefix discovery uses a larger result page (`pageSize=56`) so a carrier such as `BDS650N` is not hidden beyond the first six BDS6 results.
- Progressive discovery stops only on strong official configurable-material evidence, then Configit model proof remains mandatory.
- Added sanitized HAR replay fixtures/tests for `BGP702 -> BGP702I` and `BDS670 -> BDS650N`.

The HAR replay tests are integration-replay tests against captured Signify responses, not live authenticated tests. `BVP656` was not present in the captured HAR, so its live path is not claimed as replay-verified in this release.
