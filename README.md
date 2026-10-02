# V26 - HAR exact Quote bootstrap

This build fixes the live `template http error` observed in V25. The official Quote HAR proves that `getMaterialTemplateData` requires a `DIM_BUILDDATE` assignment with `fromAssignmentMapping: true`, while the following `getFromExistingConfigurationWithStatus` bootstrap starts with no assignments. V26 reproduces that sequence exactly, uses the delivering plant from `materialinfo`, and preserves the Configit-first family/configurator resolver.

Validation performed before packaging:
- 58/58 local API tests passed.
- HAR replay bootstrap against the user's real Quote captures passed for BGP702I (PL02, valid=true, configurable=true).
- HAR replay bootstrap passed for BDS650N (PL02, valid=true, configurable=true).
- Real captured model domains contain BGP702 + LED90 + 730 + DX10P + LGR + 7035 + SRG10 + mounting token 42 and PSD.
- Real captured BDS650N model domains contain BDS670 + LED50/LED40 + 730 + MDA/MDM + BK + SRT + SRG10 + 60P and PSD.

The container cannot resolve www.quote.signify.com directly, so final live Azure validation still has to occur after deployment. The replay uses the exact responses captured from the user's authenticated Quote session, not synthetic product data.

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

## V25 - Configit-first resolver fix

This build integrates family/configurator discovery into the main `/api/alternative` path before legacy successor fallbacks. It also retries Configit initialization with material-specific/observed plants (including PL02 and PL06) when `materialinfo` cannot be reached from the Azure worker. Exact-family `<family>I` is used only as a hypothesis and is never accepted without Configit model proof; non-lexical carriers such as BDS670 -> BDS650N still require progressive discovery + model proof.

Validation note: local API suite passes 56/56. HAR replay proves BGP702 -> BGP702I discovery and BDS670 -> BDS650N discovery. The captured HAR does not contain a complete server-response sequence for every attribute assignment plus final PSD selection, so final live DALI validation still depends on the Signify endpoints being reachable from the deployed Azure Function.
