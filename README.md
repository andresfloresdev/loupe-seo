# Loupe SEO

A Safari web extension for page-level SEO checks, modelled on the feature set
of the [Detailed SEO Extension](https://detailed.com/extension/) (Chrome and
Firefox only). Written from scratch; no code from Detailed.

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

## Install in Safari

**Quick (Safari 26+, no Xcode).** Temporary: Safari removes it after 24 hours
or when it quits.

1. Unzip `loupe-seo-<version>.zip` (or use the `extension/` folder).
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
npm run check      # Safari compat gate + unit tests + end-to-end suite
npm run package    # dist/loupe-seo-<version>.zip
npm run icons      # re-render icons from art/*.svg
```

- `npm run compat` checks every WebExtension API call and manifest key against
  MDN browser-compat-data for Safari at the manifest's `strict_min_version`
  (16.4).
- `npm test` runs the pure logic (robots.txt matching, robots directives,
  indexability, link/image/hreflang analysis, CSV, tool URLs) in Node.
- `npm run test:e2e` loads the extension unpacked in Chromium (same MV3 code),
  serves a fixture site with known SEO signals under a strict CSP, and drives the
  real popup: every tab, CSV download, hreflang status checks, user-agent
  switching (verified server-side), nofollow highlighting, context-menu targets
  and People Also Ask extraction. Screenshots land in `tests/e2e/shots/`.

### Layout

```
extension/
  manifest.json
  background.js          context menus, badge
  content/nofollow.js    nofollow highlighting (CSSOM only, CSP-safe)
  lib/inject.js          functions injected into the page (collector, PAA, flash, download)
  lib/analysis.js        pure analysis
  lib/robots.js          robots.txt parser/matcher (RFC 9309 + Google rules)
  lib/net.js             header, robots.txt and hreflang fetches
  lib/ua.js              user-agent rule (declarativeNetRequest)
  lib/tools.js           SEO tool and search URLs
  popup/                 UI (vanilla JS modules, no framework)
```

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
