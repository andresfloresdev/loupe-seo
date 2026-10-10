// End-to-end suite: loads each build unpacked in Chromium, points it at the
// local fixture site and drives the real popup. It runs twice:
// - chrome: the Chrome build (scripts/build.mjs), which takes the Chrome path
//   (per-tab user agent, CSV through the downloads API);
// - safari: extension/ as is, which is the Safari build. Without the downloads
//   permission lib/platform.js takes the Safari path in Chromium too (global
//   rule, CSV saved through the page), so Safari's fallbacks are covered here.
//   Safari itself can't run on this machine.
// `node tests/e2e/run.mjs chrome` (or safari) runs one.
// Screenshots of every panel, light and dark, land in tests/e2e/shots/<build>/.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { build } from '../../scripts/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const shotsRoot = path.join(here, 'shots');
const assets = path.join(here, 'assets');

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeAssets() {
  await mkdir(assets, { recursive: true });
  const solid = (w, h, color, name) =>
    sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toFile(path.join(assets, name));
  await Promise.all([
    solid(40, 40, '#16b47c', 'a.png'),
    solid(80, 80, '#3355ff', 'b.png'),
    solid(10, 10, '#999999', 'c.png'),
    solid(1200, 800, '#ff8844', 'big.png'),
    solid(1200, 630, '#202733', 'og.png'),
  ]);
}

async function suite(mode, extDir) {
  const chrome = mode === 'chrome';
  console.log(`\n================ ${chrome ? 'Chrome build' : 'Safari build, forced Safari path in Chromium'} (${path.relative(root, extDir) || extDir})`);
  const shots = path.join(shotsRoot, mode);
  await mkdir(shots, { recursive: true });
  const { server, base, seen } = await startServer();
  const profile = await mkdtemp(path.join(os.tmpdir(), 'loupe-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const swErrors = [];
  sw.on?.('console', (m) => m.type() === 'error' && swErrors.push(m.text()));
  const platform = await sw.evaluate(async () => {
    for (let i = 0; i < 50 && !globalThis.__loupe; i++) await new Promise((r) => setTimeout(r, 100));
    return globalThis.__loupe?.platform;
  });
  check(`platform.js takes the ${mode} path`, platform === mode, String(platform));

  const tabIdFor = (prefix) =>
    sw.evaluate(async (p) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(p))?.id, prefix);

  const popupErrors = [];
  async function openPopup(tabId, { dark = false } = {}) {
    const p = await context.newPage();
    p.on('pageerror', (e) => popupErrors.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && popupErrors.push(m.text()));
    await p.setViewportSize({ width: 460, height: 600 });
    if (dark) await p.emulateMedia({ colorScheme: 'dark' });
    await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    return p;
  }
  const shot = (p, name) => p.screenshot({ path: path.join(shots, `${name}.png`) });
  async function tallShot(p, name) {
    // Grow the popup so the whole panel fits in one image.
    await p.setViewportSize({ width: 460, height: 1500 });
    await p.addStyleTag({ content: ':root{--h:1500px !important}' });
    await sleep(500);
    await shot(p, name);
    await p.addStyleTag({ content: ':root{--h:600px !important}' });
    await p.setViewportSize({ width: 460, height: 600 });
  }
  const tab = (p, name) => p.click(`.tabs [data-tab="${name}"]`);

  // ------------------------------------------------------------------ main page
  console.log('\nOverview');
  const site = await context.newPage();
  await site.goto(`${base}/`);
  await sleep(700);
  const siteTab = await tabIdFor(`${base}/`);
  const popup = await openPopup(siteTab);
  await popup.waitForSelector('.verdict.good, .verdict.bad', { timeout: 15000 });
  await popup.waitForFunction(() => !document.querySelector('#panel-overview .spinner'), null, { timeout: 15000 });
  await sleep(700);
  const overview = await popup.locator('#panel-overview').innerText();
  check('verdict says Indexable', /Indexable/.test(await popup.locator('.verdict-title').innerText()));
  check('title and its length', overview.includes('Loupe fixture page for SEO checks') && overview.includes('33 characters'), overview.slice(0, 200));
  check('description present', overview.includes('A fixture page with every kind'));
  check('canonical is self-referencing', overview.includes('Self-referencing'));
  check('X-Robots-Tag header read', overview.includes('googlebot: noarchive'));
  check('HTTP status 200', /200 OK/.test(overview));
  check('robots.txt allows Googlebot', overview.includes('Allowed for Googlebot'));
  check('language', overview.includes('en-CA'));
  check('generator', overview.includes('Fixture CMS 1.0'));
  check('sitemaps from robots.txt', overview.includes('sitemap-news.xml'));
  const h1Count = await popup.locator('#panel-overview .hd-counts .metric').first().locator('.metric-num').innerText();
  check('H1 count tile', h1Count === '1', h1Count);
  await shot(popup, 'light-1-overview');
  await tallShot(popup, 'light-1-overview-full');

  // ------------------------------------------------------------------ headings
  console.log('\nHeadings');
  await tab(popup, 'headings');
  await sleep(500);
  const hds = await popup.locator('#panel-headings .hd').count();
  check('all 5 headings listed', hds === 5, String(hds));
  const hdText = await popup.locator('#panel-headings').innerText();
  check('skipped level flagged', hdText.includes('Skips from H2 to H4'));
  check('hidden heading flagged', hdText.includes('hidden'));
  await popup.locator('#panel-headings .hd').first().click();
  await sleep(300);
  const outlined = await site.evaluate(() => document.querySelector('h1').style.outline);
  check('clicking a heading outlines it on the page', /solid/.test(outlined), outlined);
  await shot(popup, 'light-2-headings');

  // ------------------------------------------------------------------ links
  console.log('\nLinks');
  await tab(popup, 'links');
  await sleep(700);
  const metrics = await popup.locator('#panel-links .metric').allInnerTexts();
  const m = Object.fromEntries(metrics.map((t) => t.split('\n').reverse()).map(([k, v]) => [k, Number(v.replace(/,/g, ''))]));
  check('link totals', m.Total === 11 && m.Internal === 4 && m.External === 4 && m.Nofollow === 4, JSON.stringify(m));
  check('unique links', m.Unique === 10, String(m.Unique));
  check('links without anchor text', m['No anchor text'] === 1, String(m['No anchor text']));
  await popup.click('#panel-links .seg-btn[data-value="nofollow"]');
  await sleep(400);
  const nfRows = await popup.locator('#panel-links .item').count();
  check('nofollow filter shows 4 links (incl. one added after load)', nfRows === 4, String(nfRows));
  await popup.fill('#panel-links input.search', 'sponsored');
  await sleep(200);
  check('search filter', (await popup.locator('#panel-links .item').count()) === 1);
  await popup.fill('#panel-links input.search', '');
  await popup.click('#panel-links .seg-btn[data-value="all"]');
  await sleep(600);
  await shot(popup, 'light-3-links');
  // Chrome saves through the downloads API, from the popup; Safari through a
  // link clicked in the page. Playwright renames API downloads, so the
  // filename Loupe asked for is read from the call itself.
  if (chrome) {
    await popup.evaluate(async () => {
      const { api } = await import('/lib/api.js');
      const download = api.downloads.download.bind(api.downloads);
      window.__downloads = [];
      api.downloads.download = (options) => (window.__downloads.push({ filename: options.filename }), download(options));
    });
  }
  const pageDl = site.waitForEvent('download', { timeout: chrome ? 3000 : 8000 }).catch(() => null);
  const apiDl = chrome ? popup.waitForEvent('download', { timeout: 8000 }).catch(() => null) : null;
  await popup.locator('#panel-links button', { hasText: 'CSV' }).click();
  const download = chrome ? await apiDl : await pageDl;
  let filename = download?.suggestedFilename() ?? '';
  if (chrome) {
    const calls = await popup.evaluate(() => window.__downloads);
    filename = calls[0]?.filename ?? '';
    check('links CSV downloads through chrome.downloads', calls.length === 1 && Boolean(download), JSON.stringify(calls));
    check('no download through the page in Chrome', !(await pageDl));
  } else {
    check('links CSV downloads through the page', Boolean(download));
  }
  if (download) {
    const csv = await readFile(await download.path(), 'utf8');
    const lines = csv.trim().split('\r\n');
    check('links CSV has header + 11 rows', lines.length === 12, String(lines.length));
    check('CSV has BOM and both URL forms', csv.startsWith('\uFEFFURL,Href as written,Anchor text'));
    check('CSV rows end in CRLF', csv.endsWith('\r\n') && csv.split('\n').length === csv.split('\r\n').length, JSON.stringify(csv.slice(-20)));
    check('CSV filename', /^127\.0\.0\.1-links-\d{4}-\d\d-\d\d\.csv$/.test(filename), filename);
  }

  // ------------------------------------------------------------------ images
  console.log('\nImages');
  await tab(popup, 'images');
  await sleep(700);
  const imetrics = await popup.locator('#panel-images .metric').allInnerTexts();
  const im = Object.fromEntries(imetrics.map((t) => t.split('\n').reverse()).map(([k, v]) => [k, Number(v)]));
  check('image counts', im.Images === 4 && im['Missing alt'] === 1 && im['Empty alt'] === 1 && im.Oversized === 1 && im['Lazy loaded'] === 1, JSON.stringify(im));
  await sleep(400);
  await shot(popup, 'light-4-images');

  // ------------------------------------------------------------------ schema
  console.log('\nSchema');
  await tab(popup, 'schema');
  await sleep(500);
  const schemaText = await popup.locator('#panel-schema').innerText();
  check('JSON-LD types found', ['Organization', 'WebSite', 'PostalAddress'].every((t) => schemaText.includes(t)));
  check('microdata item found', schemaText.includes('Product') && schemaText.includes('Offer'));
  check('invalid JSON-LD reported', schemaText.includes('Invalid JSON'));
  await tallShot(popup, 'light-5-schema-full');
  await popup.click('#panel-schema .seg-btn[data-value="hreflang"]');
  await popup.waitForFunction(() => document.querySelectorAll('#panel-schema .hl-status .spinner').length === 0 && document.querySelectorAll('#panel-schema .hl-row').length > 0, null, { timeout: 15000 });
  const rows = await popup.locator('#panel-schema .hl-row').allInnerTexts();
  const row = (lang) => rows.find((r) => r.startsWith(lang + '\n')) ?? '';
  check('hreflang: 6 entries incl. Link header', rows.length === 6, String(rows.length));
  check('hreflang fr: 200 and links back', /200/.test(row('fr')) && /Links back/.test(row('fr')), row('fr'));
  check('hreflang de: 404', /404/.test(row('de')), row('de'));
  check('hreflang es: redirect, no return link', /3xx → 200/.test(row('es')) && /No return link/.test(row('es')), row('es'));
  check('hreflang en: this page', /This page/.test(row('en')), row('en'));
  check('hreflang it from Link header', /Link header/.test(row('it')), row('it'));
  const hlText = await popup.locator('#panel-schema').innerText();
  check('relative hreflang URLs flagged', hlText.includes('Relative URL for en'));
  check('hreflang count includes the Link header entry', (await popup.locator('#panel-schema .seg-btn[data-value="hreflang"] .seg-count').innerText()) === '6');
  await sleep(700);
  await shot(popup, 'light-6-hreflang');

  // ------------------------------------------------------------------ social
  console.log('\nSocial');
  await tab(popup, 'social');
  await popup.waitForSelector('#panel-social .preview-img img.loaded', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  const social = await popup.locator('#panel-social').innerText();
  check('og:image size measured', social.includes('1200×630'), social.slice(0, 300));
  check('all key social tags present', social.includes('All key tags present'));
  await tallShot(popup, 'light-7-social-full');

  // ------------------------------------------------------------------ tools / UA
  // Loupe's own requests for a page: the header fetch and robots.txt (fetches,
  // not page loads), made while a popup loads.
  const popupFetches = (pagePath) => seen.requests.filter((r) => r.dest === 'empty' && (r.path === pagePath || r.path === '/robots.txt'));
  const isBot = (ua) => /Googlebot\/2\.1/.test(ua);
  async function loadedPopup(tabId, opts) {
    const p = await openPopup(tabId, opts);
    await p.waitForSelector('.verdict.good, .verdict.bad', { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector('#panel-overview .spinner'), null, { timeout: 15000 });
    await sleep(300);
    return p;
  }

  if (chrome) {
    console.log('\nUser agent, this tab only');
    const pageA = await context.newPage();
    await pageA.goto(`${base}/ua-page?tab=a`);
    const pageB = await context.newPage();
    await pageB.goto(`${base}/ua-page?tab=b`);
    const A = await tabIdFor(`${base}/ua-page?tab=a`);
    const B = await tabIdFor(`${base}/ua-page?tab=b`);
    const [winA, winB] = await sw.evaluate(async ([a, b]) => [(await chrome.tabs.get(a)).windowId, (await chrome.tabs.get(b)).windowId], [A, B]);
    const popupA = await loadedPopup(A);
    await tab(popupA, 'tools');
    await sleep(400);
    check('tools say the switch is for this tab only', /this tab only/i.test(await popupA.locator('#panel-tools').innerText()));
    await popupA.selectOption('#panel-tools select', 'googlebot-smartphone');
    await popupA.locator('#panel-tools button', { hasText: 'Apply' }).click();
    await sleep(500);
    const rules = await sw.evaluate(async () => ({ session: await chrome.declarativeNetRequest.getSessionRules(), dynamic: await chrome.declarativeNetRequest.getDynamicRules() }));
    const tabRules = rules.session.filter((r) => !r.condition.initiatorDomains);
    const said = async (p) => `toast: ${await p.locator('#toast').innerText().catch(() => '?')} | status: ${await p.locator('#panel-tools .chip').first().innerText().catch(() => '?')}`;
    check('UA rule installed for tab A only (session rule)', tabRules.length === 1 && JSON.stringify(tabRules[0].condition.tabIds) === `[${A}]` && isBot(tabRules[0].action.requestHeaders[0].value), `${JSON.stringify(rules.session)} ${await said(popupA)}`);
    check('no global rule', rules.dynamic.length === 0, JSON.stringify(rules.dynamic));
    const badge = (tabId) => sw.evaluate((t) => chrome.action.getBadgeText(t == null ? {} : { tabId: t }), tabId);
    check('badge shows UA on tab A', (await badge(A)) === 'UA');
    check('no badge on tab B', (await badge(B)) === '');
    await pageA.reload();
    await pageB.reload();
    const uaA = await pageA.locator('#ua').innerText();
    const uaB = await pageB.locator('#ua').innerText();
    check('server received Googlebot UA from tab A', isBot(uaA), uaA);
    check('tab B, same window, keeps the browser UA', winA === winB && !/Googlebot/.test(uaB), `${winA}/${winB} ${uaB}`);
    await sleep(300);
    check('badge still on tab A after it reloads', (await badge(A)) === 'UA');
    await shot(popupA, 'light-8-tools');

    // The popup's own requests: no tab (-1) in a real popup; here the popup is
    // a page in a tab of its own. Both are covered by the popup rule.
    seen.requests.length = 0;
    const popupA2 = await loadedPopup(A);
    const fromA = popupFetches('/ua-page?tab=a');
    check('popup on tab A: header and robots.txt fetches send Googlebot', fromA.length >= 2 && fromA.every((r) => isBot(r.ua)), JSON.stringify(fromA.map((r) => [r.path, isBot(r.ua)])));
    await popupA2.close();
    seen.requests.length = 0;
    const popupB = await loadedPopup(B);
    const fromB = popupFetches('/ua-page?tab=b');
    check('popup on tab B: header and robots.txt fetches send the browser UA', fromB.length >= 2 && fromB.every((r) => !/Googlebot/.test(r.ua)), JSON.stringify(fromB.map((r) => [r.path, isBot(r.ua)])));
    await popupB.close();

    await popupA.locator('#panel-tools button', { hasText: 'Reset' }).click();
    await sleep(400);
    await pageA.reload();
    const resetUA = await pageA.locator('#ua').innerText();
    check('reset restores the browser UA', !/Googlebot/.test(resetUA), resetUA);
    check('reset removes tab A’s session rules', (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 0);
    check('badge cleared', (await badge(A)) === '' && (await badge()) === '');

    // Switch again, look at it in dark mode, then close tab A.
    await popupA.selectOption('#panel-tools select', 'googlebot-smartphone');
    await popupA.locator('#panel-tools button', { hasText: 'Apply' }).click();
    await sleep(400);
    const darkA = await loadedPopup(A, { dark: true });
    await tab(darkA, 'tools');
    await sleep(600);
    await shot(darkA, 'dark-8-tools-on');
    await darkA.close();
    await popupA.close();
    const before = (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length;
    await pageA.close();
    await sleep(500);
    const after = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    check('closing tab A removes its session rules', before >= 1 && after.length === 0, `${before} → ${JSON.stringify(after)}`);
    await pageB.close();
    await tab(popup, 'tools');
    await sleep(300);
  } else {
    console.log('\nUser agent, every tab');
    await tab(popup, 'tools');
    await sleep(400);
    check('tools say the switch is for every tab until reset', /every tab until you reset it/i.test(await popup.locator('#panel-tools').innerText()));
    await popup.selectOption('#panel-tools select', 'googlebot-smartphone');
    await popup.locator('#panel-tools button', { hasText: 'Apply' }).click();
    await sleep(500);
    const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    check('UA rule installed', rules.length === 1 && /Googlebot/.test(rules[0].action.requestHeaders[0].value));
    check('no session rules', (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 0);
    check('badge shows UA', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'UA');
    const uaPage = await context.newPage();
    await uaPage.goto(`${base}/ua-page`);
    const sentUA = await uaPage.locator('#ua').innerText();
    check('server received Googlebot UA', /Googlebot\/2\.1/.test(sentUA), sentUA);
    seen.requests.length = 0;
    const uaPopup = await loadedPopup(await tabIdFor(`${base}/ua-page`));
    const fetches = popupFetches('/ua-page');
    check('popup header and robots.txt fetches send Googlebot (global rule)', fetches.length >= 2 && fetches.every((r) => isBot(r.ua)), JSON.stringify(fetches.map((r) => [r.path, isBot(r.ua)])));
    await uaPopup.close();
    await shot(popup, 'light-8-tools');
    await popup.locator('#panel-tools button', { hasText: 'Reset' }).click();
    await sleep(400);
    await uaPage.reload();
    const resetUA = await uaPage.locator('#ua').innerText();
    check('reset restores the browser UA', !/Googlebot/.test(resetUA), resetUA);
    check('badge cleared', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '');
  }
  check('PAA disabled off Google', await popup.locator('#panel-tools button', { hasText: 'Extract questions' }).isDisabled());

  // ------------------------------------------------------------------ settings / nofollow
  console.log('\nNofollow highlight');
  await tab(popup, 'settings');
  await sleep(300);
  await popup.click('#panel-settings .switch');
  await sleep(500);
  const marked = await site.evaluate(() => [...document.querySelectorAll('[data-loupe-nofollow]')].map((a) => a.textContent));
  check('nofollow/ugc/sponsored links outlined (incl. late link)', marked.length === 4, JSON.stringify(marked));
  const outline = await site.evaluate(() => document.querySelector('a[rel="nofollow"]').style.getPropertyValue('outline'));
  check('highlight survives a strict style-src CSP', /dashed/.test(outline), outline);
  await shot(site, 'page-nofollow-highlight');
  await shot(popup, 'light-9-settings');
  await popup.click('#panel-settings .switch');
  await sleep(400);
  check('highlight removed when switched off', (await site.evaluate(() => document.querySelectorAll('[data-loupe-nofollow]').length)) === 0);

  // ------------------------------------------------------------------ context menu
  console.log('\nContext menu');
  const targets = await sw.evaluate(async () => {
    await globalThis.__loupe.buildMenus();
    const t = globalThis.__loupe.menuTarget;
    const s = { googleDomain: 'www.google.ca' };
    return {
      page: t({ menuItemId: 'page:ahrefs', pageUrl: 'https://www.site.com/a?b=1' }, null, s).url,
      domain: t({ menuItemId: 'domain:semrush', pageUrl: 'https://www.site.com/a' }, null, s).url,
      link: t({ menuItemId: 'link:wayback', pageUrl: 'https://www.site.com/', linkUrl: 'https://other.com/x' }, null, s).url,
      site: t({ menuItemId: 'site-search', pageUrl: 'https://www.site.com/a' }, null, s).url,
      dupes: t({ menuItemId: 'dupes', pageUrl: 'https://www.site.com/', selectionText: 'copied "paragraph" text' }, null, s).url,
      nofollow: t({ menuItemId: 'nofollow', checked: true }, null, s).setting,
    };
  });
  check('menu: page in Ahrefs', targets.page === 'https://app.ahrefs.com/site-explorer/overview/v2/exact/live?target=https%3A%2F%2Fwww.site.com%2Fa%3Fb%3D1', targets.page);
  check('menu: domain in Semrush', targets.domain === 'https://www.semrush.com/analytics/overview/?q=site.com&searchType=domain', targets.domain);
  check('menu: link in Wayback', targets.link === 'https://web.archive.org/web/*/https://other.com/x', targets.link);
  check('menu: site: search on chosen Google', targets.site === 'https://www.google.ca/search?q=site%3Asite.com', targets.site);
  check('menu: duplicate text search', targets.dupes === 'https://www.google.ca/search?q=%22copied%20paragraph%20text%22', targets.dupes);
  check('menu: nofollow toggle', JSON.stringify(targets.nofollow) === '["highlightNofollow",true]');
  check('menus build without errors', swErrors.length === 0, swErrors.join(' | '));

  // ------------------------------------------------------------------ PAA
  console.log('\nPeople also ask');
  const serp = await context.newPage();
  await serp.goto(`${base}/serp`);
  const serpTab = await tabIdFor(`${base}/serp`);
  const paa = await popup.evaluate(async (tabId) => {
    const { runInTab } = await import('/lib/api.js');
    const { extractPAA, expandPAA } = await import('/lib/inject.js');
    const first = await runInTab(tabId, extractPAA);
    const clicks = await runInTab(tabId, expandPAA, [8]);
    await new Promise((r) => setTimeout(r, 300));
    const second = await runInTab(tabId, extractPAA);
    return { first: first.questions, clicks, second: second.questions };
  }, serpTab);
  const qs = paa.first.map((q) => q.question);
  check('PAA: finds all 4 questions across strategies', qs.length === 4, JSON.stringify(qs));
  const expanded = paa.first.find((q) => q.question === 'Is SEO dead in 2026?');
  check('PAA: answer and source for an open question', expanded?.source === 'https://example.org/seo-guide' && /Search still drives/.test(expanded?.answer ?? ''), JSON.stringify(expanded));
  check('PAA: expanding loads more questions', paa.clicks === 3 && paa.second.length === 7, `${paa.clicks} clicks, ${paa.second.length} questions`);

  // ------------------------------------------------------------------ blocked page
  console.log('\nNot indexable page');
  const blocked = await context.newPage();
  await blocked.goto(`${base}/blocked`);
  const blockedPopup = await openPopup(await tabIdFor(`${base}/blocked`));
  await blockedPopup.waitForSelector('.verdict.good, .verdict.bad', { timeout: 15000 });
  const verdict = await blockedPopup.locator('.verdict').innerText();
  check('verdict: Not indexable', verdict.includes('Not indexable'), verdict);
  check('reasons: meta noindex, header noindex, robots.txt', ['noindex in meta robots', 'noindex in X-Robots-Tag header', 'blocked by robots.txt'].every((r) => verdict.toLowerCase().includes(r.toLowerCase())), verdict);
  await blockedPopup.waitForFunction(() => !document.querySelector('#panel-overview .spinner'), null, { timeout: 15000 });
  await sleep(300);
  await shot(blockedPopup, 'light-10-not-indexable');

  // ------------------------------------------------------------------ non-web tab
  console.log('\nNon-web tabs');
  const before = new Set(await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id)));
  const blank = await context.newPage();
  await blank.goto('about:blank');
  // Without the tabs permission Chrome hides about:blank's URL, so find the new tab by id.
  const blankTab = (await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id))).find((id) => !before.has(id));
  const blankPopup = await openPopup(blankTab);
  await sleep(800);
  const noAccess = await blankPopup.locator('#panel-overview').innerText();
  check('unreadable page explains how to grant access', noAccess.includes('can’t read this page'));
  if (chrome) check('no-access message, Chrome version: site access, On all sites', noAccess.includes('Site access') && noAccess.includes('On all sites') && !noAccess.includes('Safari'), noAccess);
  else check('no-access message, Safari version', noAccess.includes('Always Allow on This Website') && noAccess.includes('Safari Settings'), noAccess);
  await shot(blankPopup, 'light-11-no-access');
  const darkBlank = await openPopup(blankTab, { dark: true });
  await sleep(800);
  await shot(darkBlank, 'dark-9-no-access');
  await darkBlank.close();
  await tab(blankPopup, 'tools');
  await sleep(300);
  const toolsText = await blankPopup.locator('#panel-tools').innerText();
  check('tools still render without a page', toolsText.includes('USER AGENT') || toolsText.includes('User agent'), toolsText.slice(0, 300));

  // ------------------------------------------------------------------ dark mode
  console.log('\nDark mode screenshots');
  const dark = await openPopup(siteTab, { dark: true });
  await dark.waitForSelector('.verdict.good, .verdict.bad', { timeout: 15000 });
  await dark.waitForFunction(() => !document.querySelector('#panel-overview .spinner'), null, { timeout: 15000 });
  await sleep(800);
  await shot(dark, 'dark-1-overview');
  for (const [i, name] of ['headings', 'links', 'images', 'schema', 'social', 'tools'].entries()) {
    await tab(dark, name);
    await sleep(900);
    await shot(dark, `dark-${i + 2}-${name}`);
  }
  check('dark mode rendered', true);

  // Network 404s (e.g. a site without /favicon.ico) are expected; code errors are not.
  const codeErrors = popupErrors.filter((e) => !e.startsWith('Failed to load resource'));
  check('no errors in popup console', codeErrors.length === 0, codeErrors.join(' | '));
  check('UA requests recorded by server', seen.ua.length >= 2);

  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

async function main() {
  const wanted = process.argv.slice(2);
  const modes = ['chrome', 'safari'].filter((m) => !wanted.length || wanted.includes(m));
  await makeAssets();
  await rm(shotsRoot, { recursive: true, force: true });
  const out = await mkdtemp(path.join(os.tmpdir(), 'loupe-build-'));
  const totals = {};
  try {
    const { dirs } = await build({ outDir: out });
    for (const mode of modes) {
      const [p, f] = [passes, failures];
      await suite(mode, mode === 'chrome' ? dirs.chrome : path.join(root, 'extension'));
      totals[mode] = `${passes - p} passed, ${failures - f} failed`;
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  console.log('');
  for (const [mode, t] of Object.entries(totals)) console.log(`${mode}: ${t}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
