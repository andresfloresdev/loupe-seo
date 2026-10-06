// End-to-end suite: loads the extension unpacked in Chromium (same MV3 code
// Safari runs), points it at the local fixture site and drives the real popup.
// Screenshots of every panel, light and dark, land in tests/e2e/shots/.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const extDir = path.join(root, 'extension');
const shots = path.join(here, 'shots');
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

async function main() {
  await makeAssets();
  await rm(shots, { recursive: true, force: true });
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
  const dl = site.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await popup.locator('#panel-links button', { hasText: 'CSV' }).click();
  const download = await dl;
  check('links CSV downloads through the page', Boolean(download));
  if (download) {
    const csv = await readFile(await download.path(), 'utf8');
    const lines = csv.trim().split('\r\n');
    check('links CSV has header + 11 rows', lines.length === 12, String(lines.length));
    check('CSV has BOM and both URL forms', csv.startsWith('\uFEFFURL,Href as written,Anchor text'));
    check('CSV filename', /^127\.0\.0\.1-links-\d{4}-\d\d-\d\d\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
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
  console.log('\nUser agent');
  await tab(popup, 'tools');
  await sleep(400);
  await popup.selectOption('#panel-tools select', 'googlebot-smartphone');
  await popup.locator('#panel-tools button', { hasText: 'Apply' }).click();
  await sleep(500);
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  check('UA rule installed', rules.length === 1 && /Googlebot/.test(rules[0].action.requestHeaders[0].value));
  check('badge shows UA', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'UA');
  const uaPage = await context.newPage();
  await uaPage.goto(`${base}/ua-page`);
  const sentUA = await uaPage.locator('#ua').innerText();
  check('server received Googlebot UA', /Googlebot\/2\.1/.test(sentUA), sentUA);
  await shot(popup, 'light-8-tools');
  await popup.locator('#panel-tools button', { hasText: 'Reset' }).click();
  await sleep(400);
  await uaPage.reload();
  const resetUA = await uaPage.locator('#ua').innerText();
  check('reset restores the browser UA', !/Googlebot/.test(resetUA), resetUA);
  check('badge cleared', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '');
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
  check('unreadable page explains how to grant access', (await blankPopup.locator('#panel-overview').innerText()).includes('can’t read this page'));
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
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
