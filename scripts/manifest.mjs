// Per-browser manifests, built from extension/manifest.json. That file is
// Safari's and stays the source of truth: the Safari build is extension/
// unchanged, and scripts/build-safari-app.sh wraps extension/ as is.
// Pure function, unit-tested in tests/unit/build.test.js.

// The highest Chrome version, per @mdn/browser-compat-data, among every API,
// rule feature and manifest key the code uses (storage.session, Chrome 102).
// The Chrome-only ones: RuleCondition.initiatorDomains (101), tabIds with
// session rules (92 and 90), downloads (22). `npm run compat` recomputes it
// from BCD and fails if this is lower.
export const MIN_CHROME = '102';

// Chrome's build: the downloads permission (CSV export), the minimum Chrome
// version, and no browser_specific_settings (Chrome flags it as an
// unrecognized key).
export function chromeManifest(manifest) {
  const out = {};
  for (const [key, value] of Object.entries(structuredClone(manifest))) {
    if (key === 'browser_specific_settings' || key === 'minimum_chrome_version') continue;
    out[key] = value;
    if (key === 'version') out.minimum_chrome_version = MIN_CHROME;
  }
  out.minimum_chrome_version ??= MIN_CHROME;
  out.permissions = [...new Set([...(out.permissions ?? []), 'downloads'])];
  return out;
}

// One folder and one zip per browser. null: extension/ copied unchanged.
export const BROWSERS = { chrome: chromeManifest, safari: null };
