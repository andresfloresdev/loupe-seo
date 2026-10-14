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
import { startServer, fakeThirdParty, FIRING_PIXEL, GTM_HTML_PIXEL, GTM_TEMPLATE_PIXEL, QUIET_PIXEL, BLOCKED_PIXEL, CSP_PIXEL, GTM_ID, GA4_ID, CLARITY_ID, ADS_ID, BLOCKED_FBEVENTS } from './server.mjs';
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
  // Third-party hosts: the tracker fakes in server.mjs answer, every other
  // external request is aborted, so the suite never reaches the internet.
  // `from` tells the page's own requests from the popup's.
  const external = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
    const req = route.request();
    let from = '';
    try {
      from = req.frame().url();
    } catch {}
    const fake = fakeThirdParty(req.url());
    external.push({ url: req.url(), from, served: Boolean(fake), hit: Boolean(fake?.hit) });
    if (!fake) return route.abort('blockedbyclient');
    const { hit, ...response } = fake;
    return route.fulfill(response);
  });

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
    await p.setViewportSize({ width: 490, height: 600 });
    if (dark) await p.emulateMedia({ colorScheme: 'dark' });
    await p.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tabId}`);
    return p;
  }
  const shot = (p, name) => p.screenshot({ path: path.join(shots, `${name}.png`) });
  async function tallShot(p, name) {
    // Grow the popup so the whole panel fits in one image.
    await p.setViewportSize({ width: 490, height: 1500 });
    await p.addStyleTag({ content: ':root{--h:1500px !important}' });
    await sleep(500);
    await shot(p, name);
    await p.addStyleTag({ content: ':root{--h:600px !important}' });
    await p.setViewportSize({ width: 490, height: 600 });
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
  check('Overview: no trackers on this page', /Trackers\s*None found/.test(overview), overview.slice(overview.indexOf('Trackers'), overview.indexOf('Trackers') + 40));
  check('Overview: Built with, nothing detected on this page', /Built with\s*Nothing detected/.test(overview), overview.slice(overview.indexOf('Built with'), overview.indexOf('Built with') + 40));
  // Ten tabs on one line in the 490 px popup: no wrap, no scroll.
  const bar = await popup.evaluate(() => {
    const tabs = document.getElementById('tabs');
    const buttons = [...tabs.querySelectorAll('[data-tab]')];
    const r = tabs.getBoundingClientRect();
    return {
      count: buttons.length,
      tops: new Set(buttons.map((b) => b.offsetTop)).size,
      overflow: tabs.scrollWidth - tabs.clientWidth,
      right: Math.round(r.right - Math.max(...buttons.map((b) => b.getBoundingClientRect().right))),
      order: buttons.map((b) => b.dataset.tab).join(' '),
    };
  });
  check('tab bar: ten tabs, Tech between Social and Trackers', bar.count === 10 && /social tech trackers tools settings$/.test(bar.order), bar.order);
  check('tab bar: one line, no scroll', bar.tops === 1 && bar.overflow <= 0 && bar.right >= 0, JSON.stringify(bar));
  console.log(`    tab bar: ${bar.right}px to spare`);
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

  // ------------------------------------------------------------------ trackers
  console.log('\nTrackers');
  const tabIdAt = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  const hits = () => external.filter((r) => r.hit).map((r) => r.url);
  const readTrackers = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll('#panel-trackers .tr-row')].map((r) => ({
        name: r.querySelector('.tr-name b')?.textContent ?? '',
        id: r.querySelector('.tr-id-value')?.textContent ?? null,
        note: r.querySelector('.tr-id.muted')?.textContent ?? null,
        status: r.dataset.status,
        label: r.querySelector('.tr-head > .chip')?.textContent ?? '',
        evidence: [...r.querySelectorAll('.tr-ev li')].map((li) => li.textContent),
      })),
    );
  const trackersDone = (p) =>
    p.waitForFunction(
      () => {
        const el = document.querySelector('#panel-trackers');
        return el && !el.querySelector('.spinner') && (el.querySelector('.tr-row') || el.querySelector('.tr-empty'));
      },
      null,
      { timeout: 15000 },
    );
  async function trackersPage(pagePath) {
    const page = await context.newPage();
    await page.goto(`${base}${pagePath}`);
    await sleep(1200); // the page's own hits go out
    return { page, tabId: await tabIdAt(`${base}${pagePath}`) };
  }
  async function trackersPopup(tabId, opts) {
    const p = await loadedPopup(tabId, opts);
    await tab(p, 'trackers');
    await trackersDone(p);
    await sleep(600);
    return p;
  }
  const find = (list, name, id) => list.find((r) => r.name === name && (id === undefined || r.id === id));
  const show = (r) => (r ? `${r.name} ${r.id ?? r.note} ${r.status} [${r.evidence.join('; ')}]` : 'missing');

  {
    const { page: trPage, tabId: trTab } = await trackersPage('/trackers');
    const hitsBefore = hits().length;
    const trPopup = await trackersPopup(trTab);
    const list = await readTrackers(trPopup);
    const meta = find(list, 'Meta Pixel', FIRING_PIXEL);
    check('Meta Pixel firing: Sending, with its ID', meta?.status === 'sending' && meta.label === 'Sending', show(meta));
    check('Meta Pixel ID read from the page’s live state (MAIN world)', meta?.evidence.includes('live fbq state'), show(meta));
    const htmlPixel = find(list, 'Meta Pixel', GTM_HTML_PIXEL);
    check('Meta Pixel only in GTM, from the escaped Custom HTML: In GTM only', htmlPixel?.status === 'gtm-only' && htmlPixel.label === 'In GTM only' && htmlPixel.evidence.some((e) => e === `fbq init in ${GTM_ID}`), show(htmlPixel));
    const tplPixel = find(list, 'Meta Pixel', GTM_TEMPLATE_PIXEL);
    check('Meta Pixel only in GTM, from vtp_pixelId: In GTM only', tplPixel?.status === 'gtm-only' && tplPixel.evidence.some((e) => e === `Meta Pixel template in ${GTM_ID}`), show(tplPixel));
    const gtm = find(list, 'Google Tag Manager', GTM_ID);
    check('GTM container loaded, with its ID', gtm?.status === 'loaded' && gtm.label === 'Loaded', show(gtm));
    const ga4 = find(list, 'Google Analytics 4', GA4_ID);
    check('GA4: Sending, with its ID', ga4?.status === 'sending', show(ga4));
    const clarity = find(list, 'Microsoft Clarity', CLARITY_ID);
    check('Clarity: Sending, with its project ID', clarity?.status === 'sending', show(clarity));
    const ads = find(list, 'Google Ads', ADS_ID);
    check('Google Ads conversion tag in GTM only', ads?.status === 'gtm-only', show(ads));
    check('consent banner named, without an ID', find(list, 'Cookiebot')?.id === null && find(list, 'Cookiebot')?.note === null, show(find(list, 'Cookiebot')));
    check('placeholder G-XXXXXXXXXX ignored (page, hit and container)', !list.some((r) => /XXXX/.test(r.id ?? '')), list.map((r) => r.id).join(' '));
    const groups = await trPopup.locator('#panel-trackers .block-title').allInnerTexts();
    check('groups: analytics, ad pixels, consent', /^Analytics and tags/i.test(groups[0] ?? '') && /^Ad pixels/i.test(groups[1] ?? '') && /^Consent banner/i.test(groups[2] ?? ''), groups.join(' | '));
    const containers = await trPopup.locator('#panel-trackers .tr-container').allInnerTexts();
    check('GTM container read', containers.length === 1 && containers[0].includes(GTM_ID) && containers[0].includes('Read'), containers.join(' | '));
    const popupFetch = external.filter((r) => r.url.includes(`gtm.js?id=${GTM_ID}`) && r.from.startsWith('chrome-extension://'));
    check('the popup’s container fetch went through the route', popupFetch.length >= 1 && popupFetch.every((r) => r.served), JSON.stringify(external.filter((r) => r.url.includes('gtm.js')).map((r) => [r.url, r.from.slice(0, 20)])));
    await sleep(1500);
    check('opening Loupe sent no tracker hit', hits().length === hitsBefore, hits().slice(hitsBefore).join(' '));

    // Copy one ID, then the whole list.
    await trPopup.locator('#panel-trackers .tr-row', { hasText: FIRING_PIXEL }).locator('.tr-id .copy').click();
    await sleep(200);
    check('copy button copies the Meta Pixel ID', (await trPopup.evaluate(() => navigator.clipboard.readText())) === FIRING_PIXEL);
    await trPopup.locator('#panel-trackers .toolbar button', { hasText: 'Copy list' }).click();
    await sleep(200);
    const copied = await trPopup.evaluate(() => navigator.clipboard.readText());
    check('Copy list: one "Tracker: ID" per line', copied.split('\n').includes(`Meta Pixel: ${FIRING_PIXEL}`) && copied.split('\n').includes(`Google Analytics 4: ${GA4_ID}`) && copied.split('\n').includes('Cookiebot'), copied);

    await trPopup.locator('#panel-trackers .tr-row', { hasText: FIRING_PIXEL }).locator('summary').click();
    await sleep(400);
    await shot(trPopup, 'light-12-trackers');
    await tallShot(trPopup, 'light-12-trackers-full');

    // Overview: chips, and a click opens the tab.
    await tab(trPopup, 'overview');
    await sleep(500);
    const row = trPopup.locator('#panel-overview .tr-overview');
    const chips = await row.locator('.chip').allInnerTexts();
    check('Overview row names the trackers, Meta Pixel with its ID', [`Meta Pixel ${FIRING_PIXEL}`, 'GA4', 'Clarity', 'GTM', 'Cookiebot'].every((c) => chips.includes(c)), chips.join(' | '));
    await row.scrollIntoViewIfNeeded();
    await sleep(300);
    await row.screenshot({ path: path.join(shots, 'light-13-overview-trackers-row.png') });
    await tallShot(trPopup, 'light-13-overview-trackers-full');
    await row.click();
    await sleep(500);
    check('clicking the Overview row opens the Trackers tab', (await trPopup.locator('.tabs [data-tab="trackers"]').getAttribute('aria-selected')) === 'true');
    await trPopup.keyboard.press('0');
    await sleep(300);
    check('key 0 opens Settings, the tenth tab', (await trPopup.locator('.tabs [data-tab="settings"]').getAttribute('aria-selected')) === 'true');
    await trPopup.keyboard.press('9');
    await sleep(300);
    check('key 9 opens Tools', (await trPopup.locator('.tabs [data-tab="tools"]').getAttribute('aria-selected')) === 'true');
    await trPopup.keyboard.press('8');
    await sleep(300);
    check('key 8 opens Trackers', (await trPopup.locator('.tabs [data-tab="trackers"]').getAttribute('aria-selected')) === 'true');
    await trPopup.keyboard.press('7');
    await sleep(300);
    check('key 7 opens Tech', (await trPopup.locator('.tabs [data-tab="tech"]').getAttribute('aria-selected')) === 'true');

    const darkTr = await trackersPopup(trTab, { dark: true });
    await darkTr.locator('#panel-trackers .tr-row', { hasText: FIRING_PIXEL }).locator('summary').click();
    await sleep(400);
    await shot(darkTr, 'dark-12-trackers');
    await tallShot(darkTr, 'dark-12-trackers-full');
    await tab(darkTr, 'overview');
    await sleep(500);
    const darkRow = darkTr.locator('#panel-overview .tr-overview');
    await darkRow.scrollIntoViewIfNeeded();
    await sleep(300);
    await darkRow.screenshot({ path: path.join(shots, 'dark-13-overview-trackers-row.png') });
    await darkTr.close();
    await trPopup.close();
    await trPage.close();
  }

  {
    const { page: q, tabId } = await trackersPage('/trackers-quiet');
    const p = await trackersPopup(tabId);
    const r = find(await readTrackers(p), 'Meta Pixel', QUIET_PIXEL);
    check('pixel that inits but sends nothing: Loaded, not sending', r?.status === 'loaded' && r.label === 'Loaded, not sending', show(r));
    check('no hit went out for it', !hits().some((u) => u.includes(QUIET_PIXEL)));
    await p.close();
    await q.close();
  }

  {
    const { page: b, tabId } = await trackersPage('/trackers-blocked');
    const p = await trackersPopup(tabId);
    const r = find(await readTrackers(p), 'Meta Pixel', BLOCKED_PIXEL);
    check('pixel whose script is blocked: In the page, not loaded', r?.status === 'in-page' && r.label === 'In the page, not loaded', show(r));
    check('its fbevents.js was aborted', external.some((e) => e.url === BLOCKED_FBEVENTS && !e.served));
    await p.close();
    await b.close();
  }

  {
    const { page: c, tabId } = await trackersPage('/trackers-csp');
    const p = await trackersPopup(tabId);
    const r = find(await readTrackers(p), 'Meta Pixel', CSP_PIXEL);
    check('page under a strict CSP: Sending, live state read', r?.status === 'sending' && r.evidence.includes('live fbq state'), show(r));
    await p.close();
    await c.close();
  }

  {
    const { page: n, tabId } = await trackersPage('/trackers-none');
    const p = await trackersPopup(tabId);
    const empty = await p.locator('#panel-trackers').innerText();
    check('no-tracker page: empty state says what was checked', /No trackers found/.test(empty) && /1 script tag, 1 inline script, \d+ requests? and the page’s live state/.test(empty), empty);
    await shot(p, 'light-14-trackers-empty');
    const dn = await trackersPopup(tabId, { dark: true });
    await shot(dn, 'dark-14-trackers-empty');
    await dn.close();
    await p.close();
    await n.close();
  }

  // ------------------------------------------------------------------ tech
  console.log('\nTech');
  const readTech = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll('#panel-tech .te-row')].map((r) => ({
        group: r.closest('section')?.querySelector('.block-title')?.textContent ?? '',
        name: r.querySelector('.tr-name b')?.textContent ?? '',
        version: r.querySelector('.te-version')?.textContent ?? null,
        hidden: Boolean(r.querySelector('.te-hidden')),
        likely: [...r.querySelectorAll('.tr-name .chip')].some((c) => c.textContent === 'Likely'),
        update: r.querySelector('.tr-head > .chip')?.textContent ?? null,
        sub: r.querySelector('.te-sub')?.textContent ?? null,
        evidence: [...r.querySelectorAll('.tr-ev li')].map((li) => li.textContent),
      })),
    );
  const techDone = (p) =>
    p.waitForFunction(
      () => {
        const el = document.querySelector('#panel-tech');
        return el && !el.querySelector('.spinner') && (el.querySelector('.te-row') || el.querySelector('.te-empty'));
      },
      null,
      { timeout: 20000 },
    );
  async function techPopup(tabId, opts) {
    const p = await loadedPopup(tabId, opts);
    await tab(p, 'tech');
    await techDone(p);
    await sleep(600);
    return p;
  }
  async function techPage(pagePath) {
    const page = await context.newPage();
    await page.goto(`${base}${pagePath}`);
    await sleep(700);
    return { page, tabId: await tabIdAt(`${base}${pagePath}`) };
  }
  const techRow = (list, name) => list.find((r) => r.name === name);
  const showTech = (r) => (r ? `${r.name} ${r.version ?? (r.hidden ? 'hidden' : '-')} [${r.update ?? ''}] ${r.sub ?? ''} {${r.evidence.join('; ')}}` : 'missing');
  // WordPress probes: the popup's fetches (dest "empty") of a feed, the REST
  // index, a stylesheet or wp-links-opml.php on the fixture site.
  const WP_PROBE = /\/feed\/|wp-json|\/style\.css|wp-links-opml\.php/;
  const probesSince = (from) => seen.all.slice(from).filter((r) => r.dest === 'empty' && WP_PROBE.test(r.path));
  const lookupsSince = (from) => external.slice(from).filter((e) => /^https:\/\/(?:api\.wordpress\.org|registry\.npmjs\.org)\//.test(e.url));

  {
    // WordPress, installed in /wp/: every probe URL comes from the page's links.
    const { page: wpPage, tabId } = await techPage('/wp/');
    const [serverFrom, externalFrom] = [seen.all.length, external.length];
    const p = await techPopup(tabId);
    await p.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(400);
    const list = await readTech(p);
    const wp = techRow(list, 'WordPress');
    check('WordPress 6.9.4, from the site’s feed (no generator tag on the page)', wp?.version === '6.9.4' && /^feed generator/.test(wp.evidence[0] ?? ''), showTech(wp));
    check('WordPress update status: Update available (6.9.10), the 6.9 branch’s patch', wp?.update === 'Update available (6.9.10)', showTech(wp));
    const child = techRow(list, 'Loupe Child');
    check('child theme from its style.css: Loupe Child 1.2.0, child of twentytwentyfive, not on wordpress.org', child?.version === '1.2.0' && /Child theme of twentytwentyfive/.test(child.sub ?? '') && child.update === 'Not on wordpress.org', showTech(child));
    const parent = techRow(list, 'Twenty Twenty-Five');
    check('parent theme: Twenty Twenty-Five 1.2, Latest is 1.3', parent?.version === '1.2' && parent.update === 'Latest is 1.3', showTech(parent));
    const cf7 = techRow(list, 'Contact Form 7');
    check('Contact Form 7 5.9.5 from its asset, Latest is 6.2.2', cf7?.version === '5.9.5' && cf7.update === 'Latest is 6.2.2', showTech(cf7));
    const yoast = techRow(list, 'Yoast SEO');
    check('Yoast SEO 27.2 from its comment, Latest', yoast?.version === '27.2' && yoast.update === 'Latest', showTech(yoast));
    check('WPML 4.6.5: premium, Not on wordpress.org', techRow(list, 'WPML')?.version === '4.6.5' && techRow(list, 'WPML')?.update === 'Not on wordpress.org', showTech(techRow(list, 'WPML')));
    const gallery = techRow(list, 'loupe-gallery');
    check('unknown plugin shown by its folder name', gallery?.sub === 'Plugin folder name' && gallery.version === '2.0.1', showTech(gallery));
    check('jQuery 3.7.1 under Frameworks and libraries', /^Frameworks and libraries/.test(techRow(list, 'jQuery')?.group ?? '') && techRow(list, 'jQuery')?.version === '3.7.1', showTech(techRow(list, 'jQuery')));
    const ns = await p.locator('#panel-tech .te-ns summary').innerText();
    check('REST namespaces listed, one not matched to a plugin', /8 REST namespaces, 1 not matched to a plugin/.test(ns), ns);
    const probed = probesSince(serverFrom);
    const paths = probed.map((r) => r.path).sort();
    check(
      'probes: the feed, the namespaces and both themes’ style.css, from /wp/',
      JSON.stringify(paths) === JSON.stringify(['/wp/feed/', '/wp/wp-content/themes/loupe-child/style.css', '/wp/wp-content/themes/twentytwentyfive/style.css', '/wp/wp-json/?_fields=namespaces']),
      paths.join(' '),
    );
    check('no wp-links-opml.php when the feed gives the version', !paths.some((x) => x.includes('opml')), paths.join(' '));
    check('five probes at most', probed.length <= 5, String(probed.length));
    const pageSent = seen.all.some((r) => r.dest !== 'empty' && r.path.startsWith('/wp/wp-content/') && r.cookie.includes('wp_e2e_session'));
    check('probes send no cookie (the page’s own requests do)', pageSent && probed.every((r) => !r.cookie), JSON.stringify([pageSent, probed.map((r) => r.cookie)]));
    const lookups = lookupsSince(externalFrom);
    const lookupPaths = lookups.map((e) => decodeURIComponent(e.url.replace(/^https:\/\/[^/]+/, '')));
    check('latest versions asked of api.wordpress.org: core, contact-form-7, wordpress-seo, both themes', ['/core/version-check/1.7/', 'request[slug]=contact-form-7', 'request[slug]=wordpress-seo', 'request[slug]=twentytwentyfive', 'request[slug]=loupe-child'].every((x) => lookupPaths.some((u) => u.includes(x))), lookupPaths.join(' '));
    check('premium WPML is not looked up', !lookupPaths.some((u) => /wpml|sitepress/.test(u)), lookupPaths.join(' '));
    check('lookups carry only a slug: no page URL, host or port', lookups.every((e) => !e.url.includes('127.0.0.1') && !e.url.includes(new URL(base).port)), lookups.map((e) => e.url).join(' '));
    check('lookups come from the popup and go through the route', lookups.length > 0 && lookups.every((e) => e.served && e.from.startsWith('chrome-extension://')), JSON.stringify(lookups.map((e) => [e.url.slice(0, 60), e.served])));
    const toolbar = await p.locator('#panel-tech .toolbar').innerText();
    check('count chip: 8 technologies', /8 technologies/.test(toolbar), toolbar);
    await p.locator('#panel-tech .toolbar button', { hasText: 'Copy list' }).click();
    await sleep(200);
    const copied = await p.evaluate(() => navigator.clipboard.readText());
    check('Copy list: one "Name version" per line', copied.split('\n').includes('WordPress 6.9.4') && copied.split('\n').includes('Loupe Child 1.2.0 (theme)') && copied.split('\n').includes('Contact Form 7 5.9.5'), copied);
    await p.locator('#panel-tech .te-row', { hasText: 'WordPress' }).first().locator('summary').click();
    await sleep(400);
    await shot(p, 'light-15-tech-wordpress');
    await tallShot(p, 'light-15-tech-wordpress-full');

    // Overview: the Built with row, and a click (or Enter) opens the tab.
    await tab(p, 'overview');
    await sleep(500);
    const row = p.locator('#panel-overview .te-overview');
    const chips = await row.locator('.chip').allInnerTexts();
    check('Overview Built with: WordPress 6.9.4 and its update status, no jQuery', JSON.stringify(chips) === JSON.stringify(['WordPress 6.9.4', 'Update available (6.9.10)']), chips.join(' | '));
    await row.scrollIntoViewIfNeeded();
    await sleep(300);
    await row.screenshot({ path: path.join(shots, 'light-16-overview-tech-row.png') });
    await row.click();
    await sleep(500);
    check('clicking Built with opens the Tech tab', (await p.locator('.tabs [data-tab="tech"]').getAttribute('aria-selected')) === 'true');
    await tab(p, 'overview');
    await sleep(400);
    await row.focus();
    await p.keyboard.press('Enter');
    await sleep(400);
    check('Enter on Built with opens the Tech tab', (await p.locator('.tabs [data-tab="tech"]').getAttribute('aria-selected')) === 'true');

    const before = external.length;
    const d = await techPopup(tabId, { dark: true });
    await d.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(400);
    check('latest versions cached: a second popup asks nothing again', lookupsSince(before).length === 0, lookupsSince(before).map((e) => e.url).join(' '));
    await d.locator('#panel-tech .te-row', { hasText: 'WordPress' }).first().locator('summary').click();
    await sleep(400);
    await shot(d, 'dark-15-tech-wordpress');
    await tallShot(d, 'dark-15-tech-wordpress-full');
    await tab(d, 'overview');
    await sleep(500);
    const darkRow = d.locator('#panel-overview .te-overview');
    await darkRow.scrollIntoViewIfNeeded();
    await sleep(300);
    await darkRow.screenshot({ path: path.join(shots, 'dark-16-overview-tech-row.png') });
    await d.close();
    await p.close();
    await wpPage.close();
  }

  {
    // The same install, a page whose feed answers 404: the other probes still
    // show, and wp-links-opml.php gives the version.
    const { page: about, tabId } = await techPage('/wp/about/');
    const from = seen.all.length;
    const p = await techPopup(tabId);
    await p.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(300);
    const list = await readTech(p);
    const wp = techRow(list, 'WordPress');
    check('feed 404: WordPress 6.9.4 from wp-links-opml.php', wp?.version === '6.9.4' && /^wp-links-opml\.php/.test(wp.evidence[0] ?? ''), showTech(wp));
    const read = await p.locator('#panel-tech .te-probes .tr-container').allInnerTexts();
    const line = (label) => read.find((t) => t.startsWith(label)) ?? '';
    check('the failed feed says so, the rest read', /Couldn’t read \(HTTP 404\)/.test(line('Feed')) && /Read$/.test(line('REST namespaces')) && read.filter((t) => /^Theme .* style\.css/.test(t) && /Read$/.test(t)).length === 2 && /Read$/.test(line('wp-links-opml.php')), read.join(' | '));
    check('themes and plugins still show', techRow(list, 'Loupe Child')?.version === '1.2.0' && techRow(list, 'Contact Form 7')?.version === '5.9.5', list.map((r) => r.name).join(', '));
    const paths = probesSince(from).map((r) => r.path);
    check('probes: the 404 feed, then wp-links-opml.php from the WordPress folder, five in all', paths.includes('/wp/about/feed/') && paths.includes('/wp/wp-links-opml.php') && paths.length === 5, paths.join(' '));
    await tallShot(p, 'light-19-tech-probe-failed');
    await p.close();
    await about.close();
  }

  // Nuxt (under a strict CSP), Astro and Angular, with their latest versions.
  for (const [pagePath, want, chipsWanted] of [
    ['/tech-nuxt', [['Nuxt', '4.6.1', 'Latest'], ['Vue', '3.5.43', 'Latest is 3.5.44'], ['Netlify', null, null]], ['Nuxt 4.6.1', 'Netlify']],
    ['/tech-astro', [['Astro', '7.3.5', 'Latest is 7.3.8'], ['Cloudflare', null, null]], ['Astro 7.3.5', 'Cloudflare']],
    ['/tech-angular', [['Angular', '22.2.2', 'Latest'], ['Fastly', null, null]], ['Angular 22.2.2', 'Fastly']],
  ]) {
    const { page: fx, tabId } = await techPage(pagePath);
    const from = seen.all.length;
    const p = await techPopup(tabId);
    await p.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(300);
    const list = await readTech(p);
    for (const [name, version, update] of want) {
      const r = techRow(list, name);
      check(`${pagePath}: ${name}${version ? ` ${version}` : ''}${update ? `, ${update}` : ''}`, r && r.version === version && (update === null || r.update === update), showTech(r));
    }
    check(`${pagePath}: nothing else in Frameworks`, list.filter((r) => /^Frameworks/.test(r.group)).every((r) => want.some(([n]) => n === r.name)), list.map((r) => r.name).join(', '));
    check(`${pagePath}: no WordPress probe`, probesSince(from).length === 0);
    await tab(p, 'overview');
    await sleep(400);
    const chips = await p.locator('#panel-overview .te-overview .chip').allInnerTexts();
    check(`${pagePath}: Overview Built with ${chipsWanted.join(', ')}`, JSON.stringify(chips) === JSON.stringify(chipsWanted), chips.join(' | '));
    await p.close();
    await fx.close();
  }

  {
    // A framework page with a feed link: no WordPress probe at all.
    const { page: nx, tabId } = await techPage('/tech-next');
    const [from, externalFrom] = [seen.all.length, external.length];
    const p = await techPopup(tabId);
    await p.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(400);
    const list = await readTech(p);
    const next = techRow(list, 'Next.js');
    check('Next.js 16.3.6 from the page’s live state, Latest is 16.4.0', next?.version === '16.3.6' && next.update === 'Latest is 16.4.0' && next.evidence.includes('window.next.version = 16.3.6'), showTech(next));
    check('React, implied by Next.js', techRow(list, 'React')?.evidence.includes('implied by Next.js'), showTech(techRow(list, 'React')));
    check('Vercel, from x-vercel-id', /^Hosting/.test(techRow(list, 'Vercel')?.group ?? ''), showTech(techRow(list, 'Vercel')));
    check('not WordPress', !techRow(list, 'WordPress'));
    const probed = probesSince(from);
    check('a page that isn’t WordPress gets no WordPress probe', probed.length === 0, probed.map((r) => r.path).join(' '));
    const lookups = lookupsSince(externalFrom).map((e) => e.url);
    check('only npm is asked, for next', lookups.length === 1 && lookups[0] === 'https://registry.npmjs.org/next/latest', lookups.join(' '));
    await shot(p, 'light-17-tech-framework');
    await tab(p, 'overview');
    await sleep(400);
    const chips = await p.locator('#panel-overview .te-overview .chip').allInnerTexts();
    check('Overview Built with: Next.js 16.3.6 and Vercel', JSON.stringify(chips) === JSON.stringify(['Next.js 16.3.6', 'Vercel']), chips.join(' | '));
    const d = await techPopup(tabId, { dark: true });
    await d.waitForFunction(() => !document.querySelector('#panel-tech .te-checking'), null, { timeout: 20000 });
    await sleep(300);
    await shot(d, 'dark-17-tech-framework');
    await d.close();
    await p.close();
    await nx.close();
  }

  {
    const { page: n, tabId } = await techPage('/trackers-none');
    const from = seen.all.length;
    const p = await techPopup(tabId);
    const empty = await p.locator('#panel-tech').innerText();
    check('nothing recognized: the empty state says what was checked', /Nothing recognized/.test(empty) && /\d+ asset URLs?/.test(empty) && /1 inline script/.test(empty) && /response headers/.test(empty), empty);
    check('…and probed nothing', probesSince(from).length === 0);
    await shot(p, 'light-18-tech-empty');
    const dn = await techPopup(tabId, { dark: true });
    await shot(dn, 'dark-18-tech-empty');
    await dn.close();
    await p.close();
    await n.close();
  }

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
  for (const [i, name] of ['headings', 'links', 'images', 'schema', 'social', 'tech', 'trackers', 'tools'].entries()) {
    await tab(dark, name);
    await sleep(900);
    await shot(dark, `dark-${i + 2}-${name}`);
  }
  check('dark mode rendered', true);

  // Network 404s (e.g. a site without /favicon.ico) are expected; code errors are not.
  const codeErrors = popupErrors.filter((e) => !e.startsWith('Failed to load resource'));
  check('no errors in popup console', codeErrors.length === 0, codeErrors.join(' | '));
  check('UA requests recorded by server', seen.ua.length >= 2);
  // Every request of the run, the fixture site's and the outside world's.
  const never = /\/(?:readme\.txt|readme\.html|wp-login\.php)(?:[?#]|$)|\/wp-admin(?:\/|$)/;
  const forbidden = [...seen.all.map((r) => r.path), ...external.map((e) => new URL(e.url).pathname)].filter((x) => never.test(x));
  check(`no request ever went to readme.txt, readme.html, wp-login.php or wp-admin (${seen.all.length + external.length} requests)`, forbidden.length === 0, forbidden.join(' '));

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
