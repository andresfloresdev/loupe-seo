# Loupe SEO

A web extension for Safari and Chromium browsers (Chrome, Brave, Edge, Arc) for
page-level SEO checks, modelled on the feature set of the
[Detailed SEO Extension](https://detailed.com/extension/) (Chrome and Firefox
only). Written from scratch; no code from Detailed.

Manifest V3, no dependencies, no tracking. Everything runs in the browser.

## What it does

**Popup tabs**

| Tab | What you get |
| --- | --- |
| Overview | Indexability verdict (meta robots, `X-Robots-Tag`, robots.txt, status code, canonical, meta refresh), title and description with lengths, URL, canonical, HTTP status, robots.txt rule for Googlebot, language, word count, generator, H1–H6 counts, link and image counts, robots.txt and sitemaps (read from robots.txt), links CSV export, open the page or domain in SEO tools |
| Headings | Every H1–H6 indented and sized by level, issues (no H1, several H1s, skipped levels, empty), hidden headings flagged, copy outline, click to scroll to it on the page |
| Links | Total, unique, internal, external, nofollow/ugc/sponsored, no anchor text; filters and search; CSV with resolved and as-written URLs; click to find a link on the page |
| Images | Missing alt, empty alt, missing title, lazy, oversized (served at more than 2x display width); thumbnails; CSV of every image URL |
| Schema | JSON-LD (incl. `@graph`) and microdata as collapsible trees, invalid JSON flagged, Rich Results Test and Schema.org Validator links. Hreflang: every alternate (HTML and `Link` header) fetched for its status code, redirect, and whether it links back; missing x-default, self-reference, invalid codes, duplicates |
| Social | Facebook/LinkedIn and X card previews, og:image size check, missing tags, raw Open Graph and Twitter tags |
| Tools | User-agent switcher (Googlebot smartphone/desktop, Bingbot, GPTBot, ClaudeBot, PerplexityBot, mobile and desktop browsers, custom), People Also Ask extraction from Google results (with "load more"), site: and duplicate-content searches |
| Settings | Highlight nofollow links on every page, Google domain for searches |

**Right-click menu** (Loupe SEO): open the page, domain or a link in Ahrefs,
Semrush, Moz, Majestic, Similarweb, Wayback Machine, PageSpeed Insights, Rich
Results Test, Schema.org Validator, BuiltWith; `site:` search; find copies of the
selected text; toggle nofollow highlighting.

## Install in Chrome, Brave, Edge, Arc

1. Download `loupe-seo-chrome-<version>.zip` from
   [Releases](https://github.com/andresfloresdev/loupe-seo/releases) and unzip
   it. Keep the folder: the browser loads it from there.
2. Open `chrome://extensions` (Brave: `brave://extensions`, Edge:
   `edge://extensions`; Arc takes `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder (the one with
   `manifest.json` in it).
5. Pin it: open the puzzle-piece Extensions menu in the toolbar and click the
   pin next to Loupe SEO.
6. Site access: on the extensions page, click **Details** on Loupe SEO and set
   **Site access** to **On all sites**. That lets it read any page you open and
   check headers, robots.txt and hreflang on other domains.

To update, unzip the new version over the same folder and click the reload
arrow on Loupe's card in the extensions page.

In Chromium browsers the user-agent switch applies to the tab you switch only
(the toolbar badge shows "UA" on that tab), until you reset it or close the
tab. CSVs go through the browser's downloads.

## Install in Safari

**Quick (Safari 26+, no Xcode).** Temporary: Safari removes it after 24 hours
or when it quits.

1. Unzip `loupe-seo-safari-<version>.zip` (or use the `extension/` folder).
2. Safari › Settings › Advanced › tick "Show features for web developers".
3. Safari › Settings › Developer › **Add Temporary Extension…**, pick the folder.
4. Click the Loupe icon on a website and allow access ("Always Allow on Every
   Website" lets it check headers, robots.txt and hreflang on other domains).

**Permanent (Xcode 26+).** On the Mac, from the repo:

```sh
DEVELOPMENT_TEAM=<your team id> ./scripts/build-safari-app.sh
```

This wraps `extension/` in a small macOS app with Apple's packager, builds it,
installs it in `/Applications` (set `INSTALL_DIR` to change that) and opens it
once. Then enable Loupe SEO in Safari › Settings › Extensions.
Without a team the build is unsigned and needs Settings › Developer › "Allow
unsigned extensions" after every Safari launch.

## Develop

```sh
npm install
npm run check      # compat gate + unit tests + end-to-end suite
npm run package    # dist/loupe-seo-chrome-<version>.zip and dist/loupe-seo-safari-<version>.zip
npm run icons      # re-render icons from art/*.svg
```

One source, two builds. `extension/` is the Safari build as is (and what
`build-safari-app.sh` wraps). The Chrome build is the same files with a
different `manifest.json`, written by `scripts/build.mjs` into `dist/chrome/`
(`scripts/manifest.mjs`: adds the `downloads` permission and
`minimum_chrome_version`, drops `browser_specific_settings`). At run time
`extension/lib/platform.js` decides the browser, and Chrome-only calls sit behind
its `IS_CHROME`.

- `npm run compat` checks every WebExtension API call (any namespace), every
  declarativeNetRequest rule feature and every manifest key against MDN
  browser-compat-data for Safari at the manifest's `strict_min_version` (16.4).
  A call or rule feature Safari lacks fails the gate unless it is behind
  `IS_CHROME`. It also checks that `minimum_chrome_version` covers the newest
  Chrome feature used.
- `npm test` runs the pure logic (robots.txt matching, robots directives,
  indexability, link/image/hreflang analysis, CSV, tool URLs, platform
  detection, the Chrome manifest, both user-agent paths, the compat gate's
  guard analysis) in Node.
- `npm run test:e2e` loads each build unpacked in Chromium, serves a fixture
  site with known SEO signals under a strict CSP, and drives the real popup:
  every tab, CSV download, hreflang status checks, user-agent switching
  (verified server-side), nofollow highlighting, context-menu targets and People
  Also Ask extraction. It runs twice: the Chrome build (per-tab user agent, CSV
  through the downloads API), then `extension/`, which takes the Safari path in
  Chromium because it has no `downloads` permission (global rule, CSV through
  the page). Safari itself is not run. Screenshots land in
  `tests/e2e/shots/chrome/` and `tests/e2e/shots/safari/`.

### Layout

```
extension/
  manifest.json
  background.js          context menus, badge, per-tab rule cleanup (Chrome)
  content/nofollow.js    nofollow highlighting (CSSOM only, CSP-safe)
  lib/inject.js          functions injected into the page (collector, PAA, flash, download)
  lib/analysis.js        pure analysis
  lib/robots.js          robots.txt parser/matcher (RFC 9309 + Google rules)
  lib/net.js             header, robots.txt and hreflang fetches
  lib/platform.js        which browser: Chrome or Safari path
  lib/ua.js              user-agent rules (declarativeNetRequest)
  lib/tools.js           SEO tool and search URLs
  popup/                 UI (vanilla JS modules, no framework)
scripts/
  manifest.mjs           the Chrome manifest, from extension/manifest.json
  build.mjs              dist/chrome/ and dist/safari/
  package.mjs            the two zips
  check-safari-compat.mjs, compat-scan.mjs   the compat gate
```

### Chrome notes

- The user-agent switch is a session rule scoped to the tab (`tabIds`), with the
  badge on that tab; closing the tab drops both. Loupe's own requests from the
  popup belong to no tab, so a second session rule, limited to requests Loupe
  starts outside any tab, gives them the user agent of the tab being inspected.
- CSVs are saved with `downloads.download` (same filename, BOM and CRLF).

### Safari notes

- Safari has no `downloads` API: CSVs are saved by a blob link clicked inside
  the inspected page; if that fails the CSV is copied to the clipboard.
- Safari can't scope network rules to one tab, so the user-agent switch applies
  to every tab until reset (the toolbar badge shows "UA" while it is on).
- Safari can unload the background worker without lifecycle events, so the
  context menu is rebuilt once per browser session.
- Page data is untrusted: the popup never uses `innerHTML` with it, and CSV
  cells are guarded against spreadsheet formula injection.

## License

[MIT](LICENSE) © 2026 Andrés Flores
