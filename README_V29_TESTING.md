# V29 validation

V29 changes the actual `/api/alternative` engine order. Current-family Quote/Configit discovery now runs before Product API successor logic.

## Regression gates executed before packaging

- API tests: 67/67 PASS.
- Real HAR-derived Configit model pipeline:
  - BGP702 LED90/730 DX10P LGR 7035 SRG10 42 -> BGP702I / BGP702 / PSD: PASS.
  - BDS670 LED50/730 MDA BK SRT SRG10 60P -> BDS650N / BDS670 / PSD: PASS.
  - BDS670 LED40/730 MDM BK SRT SRG10 60P -> BDS650N / BDS670 / PSD: PASS.
- BDS650N template-declared material environment (`Quantity`) is replayed into configuration requests: PASS.
- Negative gate: once BDS650N is discovered for BDS670, successor discovery is not called: PASS.
- BVP656 -> BVP656I is covered by the full-engine contract test, but no BVP656 HAR/model response was supplied, so it is not labelled HAR-replay validated.

The HAR-derived fixtures contain only the model data required for tests and no cookies/authorization headers.
