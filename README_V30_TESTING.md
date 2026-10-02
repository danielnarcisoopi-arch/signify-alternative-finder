# V30 deployment verification

V30 adds live observability so the deployed Azure app can test itself using the same engine as the normal search button.

## After deployment

1. Open `/api/health`.
   Expected: `version=30.0.0`, `pipeline=CONFIGIT_ONLY_CURRENT_FAMILY_V1`, `fingerprint=v30-selftest-trace-20261002`.
2. Open `/api/selftest`.
   This performs live calls from the deployed Azure worker for the four regression references and returns HTTP 200 only if all four reach the expected current-family Configit result. HTTP 503 means at least one real deployed flow failed.
3. Normal `/api/alternative` responses now include `engineVersion`, `pipeline`, and a `trace` array showing actual discovery/model/successor decisions.

The self-test uses the same `engine()` function as `/api/alternative`; there is no separate resolver implementation for tests.
