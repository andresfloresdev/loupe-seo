// Tracker detection (lib/trackers.js), the GTM container fetch (lib/net.js),
// the page-world reader (lib/inject.js) and the MAIN-world option (lib/api.js).
// The container slices are real (tests/unit/fixtures/gtm-excerpts.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calls = [];
globalThis.chrome = {
  runtime: { id: 'loupetestid', getURL: (p) => `chrome-extension://loupetestid/${p}` },
  scripting: {
    executeScript: async (opts) => {
      calls.push(opts);
      return [{ frameId: 0, result: 'ran' }];
    },
  },
};
const { TRACKERS, detectTrackers, scanContainer, containerTargets, containerData, validId, trackerById, copyList, overviewChips, statusLabel, MAX_CONTAINERS } = await import(
  '../../extension/lib/trackers.js'
);
const { readTrackerState } = await import('../../extension/lib/inject.js');
const { fetchGtmContainer } = await import('../../extension/lib/net.js');
const { runInTab } = await import('../../extension/lib/api.js');

const X = JSON.parse(readFileSync(new URL('./fixtures/gtm-excerpts.json', import.meta.url), 'utf8'));
const found = (text, self) => scanContainer(text, self).map((f) => `${f.tracker}:${f.id ?? 'variable'}`);
const rows = (signals, containers) => detectTrackers(signals, containers).trackers;
const row = (rs, tracker, id) => rs.find((r) => r.tracker === tracker && (id === undefined || r.id === id));
const signals = (s) => ({ scripts: [], inline: [], noscript: [], iframes: [], resources: [], live: null, ...s });
// A container made of real slices: `var data = {"resource":{"macros":[…],"tags":[…]}}`.
function container({ tags = [], macros = [], extra = '' }) {
  return `var data = {"resource":{"version":"1","macros":[${macros.join(',')}],"tags":[${tags.join(',')}]},"runtime":[]};\n${extra}`;
}

// ---- real GTM containers ----------------------------------------------------

test('GTM-TGLV7MC: the Meta Pixel ID in a Custom HTML tag and in the Meta template', () => {
  assert.deepEqual(found(X['GTM-TGLV7MC'].customHtmlFbqInit), ['meta:2500384610363298']);
  assert.deepEqual(found(X['GTM-TGLV7MC'].metaTemplateLiteral), ['meta:2500384610363298']);
});

test('GTM-N9SKHQP: the Meta Pixel ID in a Custom HTML tag, the LinkedIn partner ID in its tag', () => {
  assert.deepEqual(found(X['GTM-N9SKHQP'].customHtmlFbqInit), ['meta:1802611106632565']);
  assert.deepEqual(found(X['GTM-N9SKHQP'].linkedinInsightTag), ['linkedin:23191']);
});

test('GTM-TGLV7MC: GA4, Google Ads, TikTok and Pinterest IDs from their tag fields', () => {
  const t = X['GTM-TGLV7MC'];
  assert.deepEqual(found(t.ga4MeasurementIdOverride), ['ga4:G-3L9QF4WT0T']);
  assert.deepEqual(found(t.googleAdsConversion), ['google-ads:AW-1063827787']);
  assert.deepEqual(found(t.tiktokTemplate), ['tiktok:D6EVQ1BC77UF9N4T8SVG']);
  assert.ok(found(t.pinterestTag).includes('pinterest:2613456358996'));
});

test('a pixelId that is not Meta’s (the OpenAI template in GTM-TGLV7MC) is not a Meta Pixel', () => {
  assert.deepEqual(found(X['GTM-TGLV7MC'].openAiPixelLookalike), []);
});

test('paused tags carry no IDs', () => {
  assert.deepEqual(found(X['GTM-TGLV7MC'].pausedTags), []);
});

test('GTM-N2WJ5SK8: the Meta template’s pixel ID comes from a Constant variable', () => {
  const t = X['GTM-N2WJ5SK8'];
  const macros = Array.from({ length: 103 }, () => '{"function":"__e"}');
  macros.push('{"function":"__c","vtp_value":"171496286752985"}');
  const text = container({ tags: [t.metaTemplateVariableTag], macros, extra: t.metaTemplatePermissions });
  assert.ok(containerData(text), 'the container data parses');
  assert.deepEqual(found(text), ['meta:171496286752985']);
});

test('GTM-N2WJ5SK8: a Meta template whose ID variable is not a constant still counts, as "ID set by a GTM variable"', () => {
  const t = X['GTM-N2WJ5SK8'];
  const text = container({ tags: [t.metaTemplateVariableTag], extra: t.metaTemplatePermissions });
  assert.deepEqual(found(text), ['meta:variable']);
  const r = row(rows(signals({}), [{ id: 'GTM-N2WJ5SK8', url: 'x', text }]), 'meta');
  assert.equal(r.id, null);
  assert.equal(r.idNote, 'ID set by a GTM variable');
  assert.equal(r.status, 'gtm-only');
});

test('a template with a pixelId variable is only Meta’s when its permissions inject fbevents.js', () => {
  const t = X['GTM-N2WJ5SK8'];
  assert.deepEqual(found(container({ tags: [t.metaTemplateVariableTag] })), []);
});

test('GTM-N2WJ5SK8: the G-XXXXXXXXXX placeholder is skipped, the real GA4 ID in the lookup table is kept', () => {
  assert.deepEqual(found(X['GTM-N2WJ5SK8'].ga4PlaceholderLookup), ['ga4:G-TEC2Q17QRF']);
});

test('GTM-N2WJ5SK8: a Hotjar tag whose site ID is a variable', () => {
  assert.deepEqual(found(X['GTM-N2WJ5SK8'].hotjarVariable), ['hotjar:variable']);
});

test('a container does not list itself, but lists the containers it loads', () => {
  const text = 'j.src="https://www.googletagmanager.com/gtm.js?id="+i;})(window,document,"script","dataLayer","GTM-TGLV7MC");("GTM-ABCD123")';
  assert.deepEqual(found(text, 'GTM-TGLV7MC'), ['gtm:GTM-ABCD123']);
});

// ---- the page --------------------------------------------------------------

const FBQ_SNIPPET = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
t.src=v;s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '611234567890123');fbq('track', 'PageView');`;

test('a Meta Pixel hit to facebook.com/tr is Sending, with its ID', () => {
  const rs = rows(
    signals({
      inline: [FBQ_SNIPPET],
      resources: ['https://connect.facebook.net/en_US/fbevents.js', 'https://www.facebook.com/tr/?id=611234567890123&ev=PageView&dl=x'],
    }),
  );
  const meta = rs.filter((r) => r.tracker === 'meta');
  assert.equal(meta.length, 1, 'one row per ID');
  assert.equal(meta[0].id, '611234567890123');
  assert.equal(meta[0].status, 'sending');
  assert.ok(meta[0].evidence.some((e) => /facebook\.com\/tr/.test(e)));
});

test('fbevents.js loaded and the live fbq state, with no hit, is "Loaded, not sending"', () => {
  const rs = rows(
    signals({
      inline: [FBQ_SNIPPET],
      resources: ['https://connect.facebook.net/en_US/fbevents.js'],
      live: { globals: ['fbq'], values: { 'fbq.pixels': ['611234567890123'] } },
    }),
  );
  const meta = row(rs, 'meta', '611234567890123');
  assert.equal(meta.status, 'loaded');
  assert.equal(statusLabel(meta), 'Loaded, not sending');
});

test('fbq init in the page with fbevents.js never loaded is "In the page, not loaded"', () => {
  const meta = row(rows(signals({ inline: [FBQ_SNIPPET] })), 'meta', '611234567890123');
  assert.equal(meta.status, 'in-page');
});

test('a Meta Pixel only in a GTM container is "In GTM only"; the same ID seen on the page keeps the better status', () => {
  const c = [{ id: 'GTM-TGLV7MC', url: 'x', text: X['GTM-TGLV7MC'].customHtmlFbqInit }];
  assert.equal(row(rows(signals({}), c), 'meta', '2500384610363298').status, 'gtm-only');
  const both = rows(signals({ resources: ['https://www.facebook.com/tr/?id=2500384610363298&ev=PageView'] }), c).filter((r) => r.tracker === 'meta');
  assert.equal(both.length, 1);
  assert.equal(both[0].status, 'sending');
  assert.ok(both[0].evidence.some((e) => /GTM-TGLV7MC/.test(e)), 'the container evidence is kept');
});

test('two Meta Pixel IDs make two rows', () => {
  const rs = rows(
    signals({ resources: ['https://www.facebook.com/tr/?id=611234567890123&ev=PageView', 'https://www.facebook.com/tr/?ev=PageView&id=722345678901234'] }),
  );
  assert.deepEqual(
    rs.filter((r) => r.tracker === 'meta').map((r) => r.id),
    ['611234567890123', '722345678901234'],
  );
});

test('floresagency.ca: gtag config and the Clarity snippet', () => {
  const rs = rows(
    signals({
      scripts: [{ src: 'https://www.googletagmanager.com/gtag/js?id=G-QKBEB3VR6L', attrs: ' async=""' }],
      inline: [
        'window.dataLayer=window.dataLayer||[];function a(){dataLayer.push(arguments)}a("js",new Date);a("config","G-QKBEB3VR6L");',
        '(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "tpslouoi7f");',
      ],
      resources: [
        'https://www.googletagmanager.com/gtag/js?id=G-QKBEB3VR6L',
        'https://region1.google-analytics.com/g/collect?v=2&tid=G-QKBEB3VR6L&gtm=45je&en=page_view',
        'https://www.clarity.ms/tag/tpslouoi7f',
        'https://scripts.clarity.ms/0.8.9/clarity.js',
        'https://k.clarity.ms/collect',
      ],
    }),
  );
  assert.equal(row(rs, 'ga4', 'G-QKBEB3VR6L').status, 'sending');
  const clarity = rs.filter((r) => r.tracker === 'clarity');
  assert.deepEqual(
    clarity.map((r) => [r.id, r.status]),
    [['tpslouoi7f', 'sending']],
    'the collect hit backs the ID from the snippet',
  );
});

test('a tracker loaded with no ID anywhere gets one row, "No ID found"', () => {
  const rs = rows(signals({ resources: ['https://static.ads-twitter.com/uwt.js'] }));
  const x = row(rs, 'x');
  assert.equal(x.id, null);
  assert.equal(x.idNote, 'No ID found');
  assert.equal(x.status, 'loaded');
});

test('GTM and consent banners never send: loaded is "Loaded"', () => {
  const rs = rows(
    signals({
      resources: ['https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC', 'https://consent.cookiebot.com/uc.js'],
      live: { globals: ['Cookiebot'], values: {} },
    }),
  );
  assert.equal(statusLabel(row(rs, 'gtm', 'GTM-TGLV7MC')), 'Loaded');
  assert.equal(statusLabel(row(rs, 'cookiebot')), 'Loaded');
  assert.equal(row(rs, 'cookiebot').idNote, null);
});

test('a script a content blocker stopped is listed in resource timing: with no runtime, it is "In the page, not loaded"', () => {
  const blocked = signals({
    inline: [FBQ_SNIPPET],
    scripts: [{ src: 'https://connect.facebook.net/en_US/fbevents.js', attrs: ' async=""' }],
    resources: ['https://connect.facebook.net/en_US/fbevents.js'],
    live: { globals: ['fbq'], values: { 'fbq.queue': ['611234567890123'] }, ran: { fbq: false } },
  });
  const meta = row(rows(blocked), 'meta', '611234567890123');
  assert.equal(meta.status, 'in-page');
  assert.ok(meta.evidence.includes('fbevents.js requested, never ran (blocked?)'), meta.evidence.join('; '));
  // Same page, the runtime there: loaded.
  blocked.live.ran.fbq = true;
  assert.equal(row(rows(blocked), 'meta', '611234567890123').status, 'loaded');
  // No page-world read at all (it failed): the request is taken as loaded.
  blocked.live = null;
  assert.equal(row(rows(blocked), 'meta', '611234567890123').status, 'loaded');
  // gtag.js stopped: Google's runtime missing.
  const ga = signals({
    inline: ["gtag('config', 'G-QKBEB3VR6L');"],
    resources: ['https://www.googletagmanager.com/gtag/js?id=G-QKBEB3VR6L'],
    live: { globals: [], values: {}, ran: { google: false } },
  });
  assert.equal(row(rows(ga), 'ga4', 'G-QKBEB3VR6L').status, 'in-page');
});

test('a script tag whose request never happened is "In the page, not loaded"', () => {
  const rs = rows(signals({ scripts: [{ src: 'https://static.hotjar.com/c/hotjar-3021337.js?sv=6', attrs: '' }] }));
  const hj = row(rs, 'hotjar', '3021337');
  assert.equal(hj.status, 'in-page');
});

test('placeholder and dummy IDs are not IDs', () => {
  const ga4 = trackerById('ga4');
  const meta = trackerById('meta');
  for (const id of ['G-XXXXXXXXXX', 'G-XXXXXXX']) assert.equal(validId(ga4, id), false, id);
  for (const id of ['000000000000000', '111111111111111', '1234567890123456', '0123456789012345']) assert.equal(validId(meta, id), false, id);
  assert.equal(validId(meta, '611234567890123'), true);
  const rs = rows(signals({ inline: ["fbq('init', 'XXXXXXXXXXXXXXX'); fbq('init', '1234567890123456'); gtag('config', 'G-XXXXXXXXXX');"] }));
  assert.equal(row(rs, 'ga4'), undefined);
  assert.equal(rs.filter((r) => r.tracker === 'meta' && r.id).length, 0);
});

test('a page with no trackers: no rows, and what was checked', () => {
  const r = detectTrackers(signals({ scripts: [{ src: 'https://example.com/app.js', attrs: '' }], inline: ['console.log(1)'], resources: ['https://example.com/app.js'] }));
  assert.deepEqual(r.trackers, []);
  assert.deepEqual(r.checked, { scripts: 1, inline: 1, noscript: 0, resources: 1, live: false, capped: false });
});

test('the GTM containers to fetch: the exact URL the page used (first-party ones too), then the default loader, at most five', () => {
  const s = signals({
    resources: ['https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC&gtm_auth=abc&gtm_preview=env-5', 'https://metrics.example.com/gtm.js?id=GTM-K7P2Q9X'],
    inline: ['(window,document,"script","dataLayer","GTM-N9SKHQP")'],
  });
  const targets = containerTargets(s, detectTrackers(s));
  assert.deepEqual(targets, [
    { id: 'GTM-TGLV7MC', url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC&gtm_auth=abc&gtm_preview=env-5' },
    { id: 'GTM-K7P2Q9X', url: 'https://metrics.example.com/gtm.js?id=GTM-K7P2Q9X' },
    { id: 'GTM-N9SKHQP', url: 'https://www.googletagmanager.com/gtm.js?id=GTM-N9SKHQP' },
  ]);
  const many = signals({ resources: Array.from({ length: 8 }, (_, i) => `https://www.googletagmanager.com/gtm.js?id=GTM-AB${i}CD${i}`) });
  assert.equal(containerTargets(many, detectTrackers(many)).length, MAX_CONTAINERS);
  // A container another container loads is listed, not fetched in turn.
  const nested = detectTrackers(signals({}), [{ id: 'GTM-TGLV7MC', url: 'x', text: '"GTM-ABCD123"' }]);
  assert.deepEqual(containerTargets(signals({}), nested), []);
});

test('a container that could not be read is reported, and the page results stand', () => {
  const r = detectTrackers(signals({ resources: ['https://www.facebook.com/tr/?id=611234567890123'] }), [{ id: 'GTM-TGLV7MC', url: 'x', error: 'HTTP 404' }]);
  assert.deepEqual(r.containers, [{ id: 'GTM-TGLV7MC', url: 'x', ok: false, error: 'HTTP 404' }]);
  assert.equal(row(r.trackers, 'meta').status, 'sending');
});

test('copy list and Overview chips: one line per tracker and ID, Meta Pixel chips per ID', () => {
  const rs = rows(
    signals({
      resources: [
        'https://www.facebook.com/tr/?id=611234567890123',
        'https://www.facebook.com/tr/?id=722345678901234',
        'https://region1.google-analytics.com/g/collect?v=2&tid=G-QKBEB3VR6L',
        'https://static.ads-twitter.com/uwt.js',
      ],
    }),
  );
  assert.equal(copyList(rs), ['Google Analytics 4: G-QKBEB3VR6L', 'Meta Pixel: 611234567890123', 'Meta Pixel: 722345678901234', 'X (Twitter) pixel'].join('\n'));
  assert.deepEqual(
    overviewChips(rs).map((c) => c.label),
    ['GA4', 'Meta Pixel 611234567890123', 'Meta Pixel 722345678901234', 'X pixel'],
  );
});

// ---- every catalog entry: one real-shaped sample, one look-alike -------------

const tag = (src, attrs = '') => ({ scripts: [{ src, attrs }], resources: [src] });
const CASES = {
  gtm: [tag('https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC'), 'GTM-TGLV7MC', 'loaded', { inline: ['(window,document,"script","dataLayer","GTM-XXXXXXX")'] }],
  ga4: [{ resources: ['https://region1.google-analytics.com/g/collect?v=2&tid=G-QKBEB3VR6L&en=page_view'] }, 'G-QKBEB3VR6L', 'sending', { inline: ["gtag('config', 'G-XXXXXXXXXX');"] }],
  'google-tag': [{ inline: ["gtag('config', 'GT-P8QSZ2K');"] }, 'GT-P8QSZ2K', 'in-page', { inline: ["gtag('config', 'GT-XXXXXXX');"] }],
  ua: [{ resources: ['https://www.google-analytics.com/collect?v=1&tid=UA-2094807-1&t=pageview'] }, 'UA-2094807-1', 'sending', { inline: ['<meta http-equiv="X-UA-Compatible">', "ga('create', 'UA-1')"] }],
  'google-ads': [
    { resources: ['https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1063827787/?random=1'] },
    'AW-1063827787',
    'sending',
    { inline: ["gtag('config', 'AW-123456789');"] },
  ],
  clarity: [tag('https://www.clarity.ms/tag/yrlg0i3snv'), 'yrlg0i3snv', 'loaded', { inline: ['(window, document, "clarity", "script", "xxxxxxxxxx");'] }],
  hotjar: [tag('https://static.hotjar.com/c/hotjar-3021337.js?sv=6'), '3021337', 'loaded', { inline: ['h._hjSettings={hjid:1234567,hjsv:6};'] }],
  hubspot: [tag('https://js.hs-scripts.com/4581163.js'), '4581163', 'loaded', { resources: ['https://example.com/hs-scripts.com/4581163.js'] }],
  matomo: [{ resources: ['https://stats.example.com/matomo.php?idsite=3&rec=1'] }, '3', 'sending', { resources: ['https://example.com/matomo-guide.php?idsite=3'] }],
  plausible: [
    tag('https://plausible.io/js/script.js', ' defer="" data-domain="floresagency.ca"'),
    'floresagency.ca',
    'loaded',
    tag('https://example.com/app.js', ' data-domain="floresagency.ca"'),
  ],
  fathom: [tag('https://cdn.usefathom.com/script.js', ' data-site="KXNQPLRM" defer=""'), 'KXNQPLRM', 'loaded', tag('https://example.com/app.js', ' data-site="KXNQPLRM"')],
  cloudflare: [
    tag('https://static.cloudflareinsights.com/beacon.min.js', ' defer="" data-cf-beacon="{"token": "4f3c2a1b9d8e7f6a5b4c3d2e1f0a9b8c"}"'),
    '4f3c2a1b9d8e7f6a5b4c3d2e1f0a9b8c',
    'loaded',
    tag('https://example.com/beacon.min.js', ' data-cf-beacon="{"token": "00000000000000000000000000000000"}"'),
  ],
  segment: [
    tag('https://cdn.segment.com/analytics.js/v1/Zq8xVn2Lr5TkW9pBcD3hYs/analytics.min.js'),
    'Zq8xVn2Lr5TkW9pBcD3hYs',
    'loaded',
    { inline: ['analytics.load("YOUR_WRITE_KEY");'] },
  ],
  meta: [{ resources: ['https://connect.facebook.net/signals/config/1802611106632565?v=2.9.300&r=stable'] }, '1802611106632565', 'loaded', { inline: ["fbq('init', '000000000000000');"] }],
  tiktok: [{ inline: ["ttq.load('D6EVQ1BC77UF9N4T8SVG');ttq.page();"] }, 'D6EVQ1BC77UF9N4T8SVG', 'in-page', { inline: ["ttq.load('XXXXXXXXXXXXXXXXXXXX');"] }],
  linkedin: [
    { inline: ['_linkedin_partner_id = "23191";'], ...tag('https://snap.licdn.com/li.lms-analytics/insight.min.js') },
    '23191',
    'loaded',
    { inline: ['_linkedin_partner_id = "0000";'] },
  ],
  pinterest: [{ inline: ["pintrk('load', '2613456358996', {em: ''});"] }, '2613456358996', 'in-page', { inline: ["pintrk('load', 'YOUR_TAG_ID');"] }],
  snap: [
    { inline: ["snaptr('init', '8f1c2b3a-4d5e-4f60-9a7b-1c2d3e4f5a6b', {});"] },
    '8f1c2b3a-4d5e-4f60-9a7b-1c2d3e4f5a6b',
    'in-page',
    { inline: ["snaptr('init', '00000000-0000-0000-0000-000000000000');"] },
  ],
  x: [{ inline: ['twq("config","ogcst");'] }, 'ogcst', 'in-page', { inline: ['twq("config","xxxxx");'] }],
  uet: [
    { inline: ['(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"5489498"};o.q=w[u],w[u]=new UET(o)}})(window,document,"script","//bat.bing.com/bat.js","uetq");'] },
    '5489498',
    'in-page',
    { inline: ['var settings = {ti:"5489498"};'] },
  ],
  reddit: [{ inline: ["rdt('init','t2_k3q9z1xa');rdt('track', 'PageVisit');"] }, 't2_k3q9z1xa', 'in-page', { inline: ["rdt('init','YOUR_PIXEL_ID');"] }],
  cookiebot: [tag('https://consent.cookiebot.com/uc.js'), null, 'loaded', { resources: ['https://example.com/cookiebot-guide.js'] }],
  onetrust: [tag('https://cdn.cookielaw.org/scripttemplates/otSDKStub.js'), null, 'loaded', { resources: ['https://example.com/cookielaw.org.js'] }],
  axeptio: [tag('https://static.axept.io/sdk.js'), null, 'loaded', { resources: ['https://example.com/axept.io/sdk.js'] }],
  didomi: [tag('https://sdk.privacy-center.org/loader.js'), null, 'loaded', { resources: ['https://example.com/privacy-center.org/loader.js'] }],
  cookieyes: [tag('https://cdn-cookieyes.com/client_data/abc/script.js'), null, 'loaded', { resources: ['https://example.com/cookieyes.js'] }],
  termly: [tag('https://app.termly.io/resource-blocker/abc'), null, 'loaded', { resources: ['https://example.com/termly.io/x.js'] }],
  iubenda: [tag('https://cs.iubenda.com/autoblocking/123.js'), null, 'loaded', { resources: ['https://example.com/iubenda.js'] }],
  osano: [tag('https://cmp.osano.com/abc/def/osano.js'), null, 'loaded', { resources: ['https://example.com/osano.js'] }],
  complianz: [tag('https://example.com/wp-content/plugins/complianz-gdpr/cookiebanner/js/complianz.min.js'), null, 'loaded', { resources: ['https://example.com/wp-content/plugins/other/complianz.js'] }],
  usercentrics: [tag('https://web.cmp.usercentrics.eu/ui/loader.js'), null, 'loaded', { resources: ['https://example.com/usercentrics.js'] }],
};

test('every catalog entry has a sample and a look-alike below', () => {
  assert.deepEqual(TRACKERS.map((t) => t.id).filter((id) => !CASES[id]), []);
});

for (const [id, [sample, wantId, wantStatus, lookAlike]] of Object.entries(CASES)) {
  test(`${id}: found with its ID and status; the look-alike is not`, () => {
    const got = rows(signals(sample)).filter((r) => r.tracker === id);
    assert.deepEqual(
      got.map((r) => [r.id, r.status]),
      [[wantId, wantStatus]],
      `${id} sample`,
    );
    assert.deepEqual(
      rows(signals(lookAlike)).filter((r) => r.tracker === id),
      [],
      `${id} look-alike`,
    );
  });
}

test('every catalog entry has a name, a group and at least one signature', () => {
  for (const t of TRACKERS) {
    assert.ok(t.name && t.group, t.id);
    assert.ok((t.src ?? []).length + (t.hits ?? []).length + (t.code ?? []).length + (t.live ?? []).length > 0, t.id);
  }
});

// ---- the page-world reader ---------------------------------------------------

test('readTrackerState only reads: it never calls fbq, ttq, gtag or any tracker function', () => {
  const sent = [];
  const fn = (name) => {
    const f = (...a) => sent.push([name, ...a]);
    return f;
  };
  const fbq = fn('fbq');
  fbq.callMethod = fn('fbq.callMethod');
  fbq.queue = [['init', '611234567890123'], ['track', 'PageView']];
  fbq.instance = { pixelsByID: { '722345678901234': {} } };
  fbq.getState = () => {
    sent.push(['getState']);
    return { pixels: [] };
  };
  const ttq = { track: fn('ttq.track'), page: fn('ttq.page'), load: fn('ttq.load'), _i: { D6EVQ1BC77UF9N4T8SVG: {} } };
  const dataLayer = [['config', 'G-QKBEB3VR6L']];
  dataLayer.push = fn('dataLayer.push');
  globalThis.window = { fbq, ttq, dataLayer, gtag: fn('gtag'), clarity: fn('clarity'), _linkedin_partner_id: '23191', google_tag_manager: { 'GTM-TGLV7MC': {}, 'G-QKBEB3VR6L': {}, dataLayer: {} } };
  const out = readTrackerState(['fbq', 'clarity', 'gtag', 'missing']);
  delete globalThis.window;
  assert.deepEqual(sent, [], 'no tracker function was called');
  assert.deepEqual(out.globals, ['fbq', 'clarity', 'gtag']);
  assert.deepEqual(out.values['fbq.pixels'], ['722345678901234']);
  assert.deepEqual(out.values['fbq.queue'], ['611234567890123']);
  assert.deepEqual(out.values['ttq.pixels'], ['D6EVQ1BC77UF9N4T8SVG']);
  assert.deepEqual(out.values.gtm, ['GTM-TGLV7MC', 'G-QKBEB3VR6L']);
  assert.deepEqual(out.values['dataLayer.config'], ['G-QKBEB3VR6L']);
  assert.deepEqual(out.values['linkedin.partner'], ['23191']);
  assert.deepEqual(out.ran, { fbq: true, google: true });
});

test('readTrackerState: the base-code stubs alone are not a runtime', () => {
  const stub = function () {};
  stub.queue = [['init', '611234567890123']];
  stub.loaded = true;
  stub.version = '2.0';
  globalThis.window = { fbq: stub, dataLayer: [] };
  const out = readTrackerState(['fbq']);
  delete globalThis.window;
  assert.deepEqual(out.ran, { fbq: false, google: false });
  assert.deepEqual(out.values['fbq.queue'], ['611234567890123']);
});

test('readTrackerState survives a page whose globals throw on every read', () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error('nope');
      },
      has() {
        throw new Error('nope');
      },
      ownKeys() {
        throw new Error('nope');
      },
    },
  );
  globalThis.window = new Proxy(
    {},
    {
      get: (_, k) => (k === 'fbq' || k === 'ttq' || k === 'dataLayer' || k === 'google_tag_manager' || k === '_paq' ? trap : undefined),
      has() {
        throw new Error('nope');
      },
    },
  );
  let out;
  assert.doesNotThrow(() => (out = readTrackerState(['fbq'])));
  delete globalThis.window;
  assert.deepEqual(out.globals, []);
  assert.deepEqual(out.values, {});
});

test('readTrackerState returns plain strings only', () => {
  globalThis.window = { fbq: { instance: { pixelsByID: { '611234567890123': { secret: {} } } } }, _linkedin_partner_id: { toString: () => 'x' } };
  const out = readTrackerState([]);
  delete globalThis.window;
  assert.deepEqual(out.values, { 'fbq.pixels': ['611234567890123'] });
  assert.doesNotThrow(() => structuredClone(out));
});

// ---- the extension side -----------------------------------------------------

test('runInTab passes world: MAIN only when asked', async () => {
  calls.length = 0;
  assert.equal(await runInTab(7, readTrackerState, [['fbq']], { world: 'MAIN' }), 'ran');
  assert.equal(calls[0].world, 'MAIN');
  assert.deepEqual(calls[0].target, { tabId: 7 });
  await runInTab(7, readTrackerState);
  assert.equal('world' in calls[1], false, 'the isolated world stays the default');
});

test('fetchGtmContainer: only gtm.js?id=GTM-… URLs, without cookies', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push([url, opts?.credentials]);
    if (url.includes('GTM-GONE')) return new Response('', { status: 404 });
    return new Response('var data = {"resource":{}};', { status: 200 });
  };
  try {
    assert.equal((await fetchGtmContainer('https://evil.example/collect?id=GTM-TGLV7MC')).error, 'Not a GTM container URL');
    assert.equal((await fetchGtmContainer('https://www.googletagmanager.com/gtag/js?id=G-QKBEB3VR6L')).error, 'Not a GTM container URL');
    assert.equal((await fetchGtmContainer('javascript:alert(1)//gtm.js?id=GTM-A')).error, 'Not a GTM container URL');
    assert.equal(seen.length, 0, 'nothing fetched for a URL that is not a container');
    const ok = await fetchGtmContainer('https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC&l=dataLayer');
    assert.match(ok.text, /var data/);
    assert.deepEqual(seen[0], ['https://www.googletagmanager.com/gtm.js?id=GTM-TGLV7MC&l=dataLayer', 'omit']);
    assert.equal((await fetchGtmContainer('https://www.googletagmanager.com/gtm.js?id=GTM-GONE')).error, 'HTTP 404');
  } finally {
    globalThis.fetch = realFetch;
  }
});
