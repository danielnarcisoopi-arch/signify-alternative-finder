# Signify Alternative Finder

Hybrid version:
1. Uses the approved Quote/Product API if server-side authentication is configured.
2. If it is not configured or unavailable, the app does NOT stop with AUTH_REQUIRED.
3. It falls back to verified cache, then to the universal PSU/PSD candidate generator.
4. When live results reveal an `isConfigurable` current/new family, the configurator is preferred over a poorer standard SKU and no 12NC is invented.

Do not store personal/browser Bearer tokens in this repository.
