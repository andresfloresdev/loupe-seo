// Tracker catalog and detection. Pure: no DOM, no browser APIs, unit-tested in
// Node (tests/unit/trackers.test.js).
//
// The catalog is data. Each entry says how to find one tracker and pull out its
// ID from four read-only sources:
// - the page's code: script tags, inline scripts, noscript (`src`, `code`);
// - the requests the page already made, from resource timing (`src`, `hits`);
// - the tracker's live state, read in the page's own world (`live`);
// - the GTM containers the page loads, fetched by Loupe (`code` patterns that
//   capture an ID, plus `gtm` and `gtmVariable`).
// The quarterly upkeep (LOUPE-03) updates signatures here, never in the UI.

// A quote, maybe escaped: custom HTML inside a GTM container is a JSON string.
const Q = String.raw`\\?["']`;
// A slash, maybe escaped: containers write https:\/\/.
const SL = String.raw`\\?\/`;
// The start of a query string up to the parameter that follows (`?a=1&id=`).
const ARG = String.raw`\?(?:[^#\s"'<>]*?&(?:amp;)?)?`;
// Anything inside one GTM tag object: stops before the next tag's "function".
const IN_TAG = String.raw`(?:(?!"function")[\s\S]){0,4000}?`;
const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

// One signature. `label` names the evidence in the UI, `prefix` is added to a
// captured ID that lacks it (Google Ads conversion IDs), `within` must also
// match the same text (for loose patterns like UET's `ti:`).
function p(source, label, { prefix, within, flags = '' } = {}) {
  const re = new RegExp(source, `g${flags}`);
  const groups = new RegExp(`${source}|`).exec('').length - 1;
  return { re, label, prefix, within, groups };
}

export const GROUPS = [
  { id: 'analytics', name: 'Analytics and tags' },
  { id: 'ads', name: 'Ad pixels' },
  { id: 'consent', name: 'Consent banner' },
];

export const TRACKERS = [
  // ---------------------------------------------------------------- analytics
  {
    id: 'gtm',
    ran: 'google',
    name: 'Google Tag Manager',
    short: 'GTM',
    group: 'analytics',
    sends: false,
    format: /^GTM-[A-Z0-9]{4,10}$/,
    src: [p(String.raw`\/gtm\.js${ARG}id=(GTM-[A-Z0-9]{4,10})`, 'gtm.js')],
    code: [
      p(String.raw`${Q}(GTM-[A-Z0-9]{4,10})${Q}`, 'GTM snippet'),
      p(String.raw`ns\.html${ARG}id=(GTM-[A-Z0-9]{4,10})`, 'GTM iframe'),
    ],
    live: [{ key: 'gtm', kind: 'loaded', label: 'live google_tag_manager' }],
  },
  {
    id: 'ga4',
    ran: 'google',
    name: 'Google Analytics 4',
    short: 'GA4',
    group: 'analytics',
    format: /^G-[A-Z0-9]{6,12}$/,
    src: [p(String.raw`\/gtag\/js${ARG}id=(G-[A-Z0-9]{6,12})`, 'gtag.js')],
    hits: [p(String.raw`\/g\/collect${ARG}tid=(G-[A-Z0-9]{6,12})`, '/g/collect')],
    code: [
      p(String.raw`${Q}config${Q}\s*,\s*${Q}(G-[A-Z0-9]{6,12})${Q}`, 'gtag config'),
      p(String.raw`gtag${SL}js${ARG}id=(G-[A-Z0-9]{6,12})`, 'gtag.js'),
    ],
    gtm: [p(String.raw`"(G-[A-Z0-9]{6,12})"`, 'GA4 ID')],
    live: [
      { key: 'gtm', kind: 'loaded', label: 'live google_tag_manager' },
      { key: 'dataLayer.config', kind: 'code', label: 'dataLayer config' },
    ],
  },
  {
    id: 'google-tag',
    ran: 'google',
    name: 'Google tag',
    short: 'Google tag',
    group: 'analytics',
    sends: false,
    format: /^GT-[A-Z0-9]{6,12}$/,
    src: [p(String.raw`\/gtag\/js${ARG}id=(GT-[A-Z0-9]{6,12})`, 'gtag.js')],
    code: [
      p(String.raw`${Q}config${Q}\s*,\s*${Q}(GT-[A-Z0-9]{6,12})${Q}`, 'gtag config'),
      p(String.raw`gtag${SL}js${ARG}id=(GT-[A-Z0-9]{6,12})`, 'gtag.js'),
    ],
    gtm: [p(String.raw`"(GT-[A-Z0-9]{6,12})"`, 'Google tag ID')],
    live: [
      { key: 'gtm', kind: 'loaded', label: 'live google_tag_manager' },
      { key: 'dataLayer.config', kind: 'code', label: 'dataLayer config' },
    ],
  },
  {
    id: 'ua',
    name: 'Universal Analytics',
    short: 'UA',
    group: 'analytics',
    retired: true,
    format: /^UA-\d{4,10}-\d{1,4}$/,
    src: [
      p(String.raw`\/gtag\/js${ARG}id=(UA-\d{4,10}-\d{1,4})`, 'gtag.js'),
      p(String.raw`google-analytics\.com\/(?:analytics|ga)\.js`, 'analytics.js'),
    ],
    hits: [p(String.raw`google-analytics\.com\/(?:[rj]\/)?collect${ARG}tid=(UA-\d{4,10}-\d{1,4})`, 'google-analytics.com/collect')],
    code: [p(String.raw`${Q}(UA-\d{4,10}-\d{1,4})${Q}`, 'UA ID')],
    live: [
      { key: 'gtm', kind: 'loaded', label: 'live google_tag_manager' },
      { key: 'dataLayer.config', kind: 'code', label: 'dataLayer config' },
    ],
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    short: 'Google Ads',
    group: 'ads',
    format: /^AW-\d{8,12}$/,
    src: [
      p(String.raw`\/gtag\/js${ARG}id=(AW-\d{8,12})`, 'gtag.js'),
      p(String.raw`googleadservices\.com\/pagead\/conversion(?:_async)?\.js`, 'conversion.js'),
    ],
    hits: [
      p(String.raw`googleadservices\.com\/pagead\/conversion\/(\d{8,12})\/`, 'googleadservices.com conversion', { prefix: 'AW-' }),
      p(String.raw`googleads\.g\.doubleclick\.net\/pagead\/viewthroughconversion\/(\d{8,12})\/`, 'doubleclick.net viewthroughconversion', { prefix: 'AW-' }),
      p(String.raw`google\.[a-z.]+\/pagead\/1p-(?:user-list|conversion)\/(\d{8,12})\/`, 'google.com pagead', { prefix: 'AW-' }),
    ],
    code: [
      p(String.raw`${Q}config${Q}\s*,\s*${Q}(AW-\d{8,12})${Q}`, 'gtag config'),
      p(String.raw`google_conversion_id\s*=\s*${Q}?(\d{8,12})`, 'google_conversion_id', { prefix: 'AW-' }),
    ],
    gtm: [
      p(String.raw`"(AW-\d{8,12})"`, 'Google Ads ID'),
      p(String.raw`"vtp_conversionId":"(\d{8,12})"`, 'Google Ads tag', { prefix: 'AW-' }),
    ],
    live: [
      { key: 'gtm', kind: 'loaded', label: 'live google_tag_manager' },
      { key: 'dataLayer.config', kind: 'code', label: 'dataLayer config' },
    ],
  },
  {
    id: 'clarity',
    name: 'Microsoft Clarity',
    short: 'Clarity',
    group: 'analytics',
    format: /^[a-z0-9]{8,12}$/,
    src: [
      p(String.raw`clarity\.ms\/tag\/([a-z0-9]{8,12})(?![a-z0-9])`, 'clarity.ms/tag'),
      p(String.raw`clarity\.ms\/[^\s"'?#]*clarity\.js`, 'clarity.js'),
    ],
    hits: [p(String.raw`[a-z]\.clarity\.ms\/collect`, 'clarity.ms/collect')],
    code: [
      p(String.raw`${Q}clarity${Q}\s*,\s*${Q}script${Q}\s*,\s*${Q}([a-z0-9]{8,12})${Q}`, 'Clarity snippet'),
      p(String.raw`clarity\.ms${SL}tag${SL}([a-z0-9]{8,12})(?![a-z0-9])`, 'clarity.ms/tag'),
    ],
    live: [{ key: 'global:clarity', kind: 'code', label: 'clarity function' }],
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    short: 'Hotjar',
    group: 'analytics',
    format: /^\d{5,9}$/,
    src: [
      p(String.raw`static\.hotjar\.com\/c\/hotjar-(\d{5,9})\.js`, 'hotjar.js'),
      p(String.raw`script\.hotjar\.com\/modules`, 'Hotjar modules'),
    ],
    hits: [
      p(String.raw`in\.hotjar\.com\/api\/v\d+\/client\/sites\/(\d{5,9})\/`, 'in.hotjar.com'),
      p(String.raw`(?:in|vc)\.hotjar\.(?:com|io)\/`, 'hotjar.com'),
    ],
    code: [
      p(String.raw`hjid\s*:\s*(\d{5,9})`, 'Hotjar snippet'),
      p(String.raw`hotjar-(\d{5,9})\.js`, 'hotjar.js'),
    ],
    gtm: [p(String.raw`"function":"__hjtc"${IN_TAG}"vtp_hotjar_site_id":"(\d{5,9})"`, 'Hotjar tag')],
    gtmVariable: [p(String.raw`"function":"__hjtc"${IN_TAG}"vtp_hotjar_site_id":\["macro"`, 'Hotjar tag')],
    live: [
      { key: 'hotjar.site', kind: 'loaded', label: 'live hjSiteSettings' },
      { key: 'hotjar.settings', kind: 'code', label: '_hjSettings' },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    short: 'HubSpot',
    group: 'analytics',
    format: /^\d{5,10}$/,
    src: [
      p(String.raw`js(?:-[a-z0-9]+)?\.hs-scripts\.com\/(\d{5,10})\.js`, 'hs-scripts.com loader'),
      p(String.raw`js(?:-[a-z0-9]+)?\.hs-analytics\.net\/analytics\/\d+\/(\d{5,10})\.js`, 'hs-analytics.net'),
    ],
    hits: [p(String.raw`track(?:-[a-z0-9]+)?\.hubspot\.com\/__pt[a-z]\.gif${ARG}a=(\d{5,10})`, 'track.hubspot.com')],
    code: [p(String.raw`hs-scripts\.com${SL}(\d{5,10})\.js`, 'HubSpot loader')],
    live: [{ key: 'global:_hsq', kind: 'code', label: '_hsq queue' }],
  },
  {
    id: 'matomo',
    name: 'Matomo',
    short: 'Matomo',
    group: 'analytics',
    format: /^\d{1,6}$/,
    src: [p(String.raw`\/(?:matomo|piwik)\.js(?:[?#]|$)`, 'matomo.js')],
    hits: [p(String.raw`\/(?:matomo|piwik)\.php${ARG}idsite=(\d{1,6})`, 'matomo.php')],
    code: [p(String.raw`${Q}setSiteId${Q}\s*,\s*${Q}?(\d{1,6})`, '_paq setSiteId')],
    live: [{ key: 'matomo.site', kind: 'code', label: '_paq setSiteId' }],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    short: 'Plausible',
    group: 'analytics',
    format: /^[a-z0-9.-]+\.[a-z]{2,}$/i,
    src: [p(String.raw`plausible\.io\/js\/[\w.-]+\.js`, 'plausible.io script')],
    hits: [p(String.raw`plausible\.io\/api\/event`, 'plausible.io/api/event')],
    tag: [p(String.raw`data-domain="([^"\s,]+)"`, 'data-domain', { within: /plausible/ })],
    live: [{ key: 'global:plausible', kind: 'code', label: 'plausible function' }],
  },
  {
    id: 'fathom',
    name: 'Fathom',
    short: 'Fathom',
    group: 'analytics',
    format: /^[A-Z]{4,10}$/,
    src: [p(String.raw`cdn\.usefathom\.com\/script\.js`, 'usefathom.com script')],
    hits: [p(String.raw`usefathom\.com\/${ARG}sid=([A-Z]{4,10})`, 'usefathom.com')],
    tag: [p(String.raw`data-site="([A-Z]{4,10})"`, 'data-site', { within: /usefathom/ })],
    live: [{ key: 'global:fathom', kind: 'loaded', label: 'fathom object' }],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Web Analytics',
    short: 'Cloudflare',
    group: 'analytics',
    format: /^[a-f0-9]{32}$/,
    src: [p(String.raw`static\.cloudflareinsights\.com\/beacon\.min\.js`, 'beacon.min.js')],
    hits: [p(String.raw`\/cdn-cgi\/rum(?:[?#]|$)`, '/cdn-cgi/rum')],
    tag: [p(String.raw`data-cf-beacon="\{[^}]*?"token"\s*:\s*"([a-f0-9]{32})"`, 'data-cf-beacon')],
    live: [{ key: 'global:__cfBeacon', kind: 'loaded', label: '__cfBeacon' }],
  },
  {
    id: 'segment',
    name: 'Segment',
    short: 'Segment',
    group: 'analytics',
    format: /^[A-Za-z0-9]{20,40}$/,
    src: [p(String.raw`cdn\.segment\.(?:com|io)\/analytics\.js\/v1\/([A-Za-z0-9]{20,40})\/analytics(?:\.min)?\.js`, 'analytics.js')],
    hits: [p(String.raw`api\.segment\.io\/v1\/[a-z]+`, 'api.segment.io')],
    code: [p(String.raw`analytics\.load\(\s*${Q}([A-Za-z0-9]{20,40})${Q}`, 'analytics.load')],
  },

  // ---------------------------------------------------------------- ad pixels
  {
    id: 'meta',
    name: 'Meta Pixel',
    short: 'Meta Pixel',
    group: 'ads',
    format: /^\d{15,17}$/,
    ran: 'fbq',
    src: [
      p(String.raw`connect\.facebook\.net\/signals\/config\/(\d{15,17})`, 'signals/config'),
      p(String.raw`connect\.facebook\.net\/[A-Za-z_]+\/fbevents\.js`, 'fbevents.js'),
    ],
    hits: [
      p(String.raw`facebook\.com\/tr\/?${ARG}id=(\d{15,17})`, 'facebook.com/tr'),
      p(String.raw`facebook\.com\/privacy_sandbox\/pixel\/register\/trigger\/?${ARG}id=(\d{15,17})`, 'facebook.com/privacy_sandbox'),
      p(String.raw`facebook\.com\/tr\/?(?:[?#]|$)`, 'facebook.com/tr'),
    ],
    code: [
      p(String.raw`fbq\(\s*${Q}init${Q}\s*,\s*${Q}(\d{15,17})${Q}`, 'fbq init'),
      p(String.raw`facebook\.com${SL}tr${SL}?${ARG}id=(\d{15,17})`, 'facebook.com/tr'),
      p(String.raw`connect\.facebook\.net${SL}[A-Za-z_]+${SL}fbevents\.js`, 'fbevents.js loader'),
    ],
    gtm: [p(String.raw`"vtp_pixelId":"(\d{15,17})"`, 'Meta Pixel template')],
    // A template tag whose pixel ID is a GTM variable. Only counts when the
    // template's permissions inject Meta's script (other templates use pixelId too).
    gtmVariable: [p(String.raw`"function":"(__cvt_[A-Za-z0-9_]+)"${IN_TAG}"vtp_pixelId":\["macro"`, 'Meta Pixel template')],
    template: /connect\.facebook\.net/,
    live: [
      { key: 'fbq.pixels', kind: 'loaded', label: 'live fbq state' },
      { key: 'fbq.queue', kind: 'code', label: 'queued fbq init' },
      { key: 'global:fbq', kind: 'code', label: 'fbq function' },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok Pixel',
    short: 'TikTok',
    group: 'ads',
    format: /^[A-Z0-9]{20}$/,
    src: [
      p(String.raw`analytics\.tiktok\.com\/i18n\/pixel\/events\.js${ARG}sdkid=([A-Z0-9]{20})`, 'events.js'),
      p(String.raw`analytics\.tiktok\.com\/i18n\/pixel\/(?:events|sdk|static\/[\w.-]+)\.js`, 'TikTok pixel script'),
    ],
    hits: [p(String.raw`analytics\.tiktok\.com\/api\/v\d\/pixel`, 'analytics.tiktok.com/api')],
    code: [p(String.raw`ttq\.load\(\s*${Q}([A-Z0-9]{20})${Q}`, 'ttq.load')],
    gtm: [p(String.raw`"vtp_pixel_?[cC]ode":"([A-Z0-9]{20})"`, 'TikTok template')],
    live: [
      { key: 'ttq.pixels', kind: 'code', label: 'ttq pixels' },
      { key: 'global:ttq', kind: 'code', label: 'ttq object' },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Insight Tag',
    short: 'LinkedIn',
    group: 'ads',
    format: /^\d{3,10}$/,
    src: [p(String.raw`snap\.licdn\.com\/li\.lms-analytics\/insight(?:\.min)?\.js`, 'insight.min.js')],
    hits: [
      p(String.raw`px\.ads\.linkedin\.com\/(?:collect|attribution_trigger)\/?${ARG}pid=(\d{3,10})`, 'px.ads.linkedin.com'),
      p(String.raw`px\.ads\.linkedin\.com\/`, 'px.ads.linkedin.com'),
    ],
    code: [
      p(String.raw`_linkedin_partner_id\s*=\s*${Q}?(\d{3,10})`, '_linkedin_partner_id'),
      p(String.raw`px\.ads\.linkedin\.com${SL}collect${SL}?${ARG}pid=(\d{3,10})`, 'px.ads.linkedin.com'),
    ],
    gtm: [p(String.raw`"function":"__bzi"${IN_TAG}"vtp_id":"(\d{3,10})"`, 'LinkedIn Insight tag')],
    live: [{ key: 'linkedin.partner', kind: 'code', label: '_linkedin_partner_id' }],
  },
  {
    id: 'pinterest',
    name: 'Pinterest Tag',
    short: 'Pinterest',
    group: 'ads',
    format: /^\d{13}$/,
    src: [p(String.raw`s\.pinimg\.com\/ct\/(?:core|lib\/main\.[a-z0-9]+)\.js`, 'pinimg.com core.js')],
    hits: [p(String.raw`ct\.pinterest\.com\/(?:v3|user)\/?${ARG}tid=(\d{13})`, 'ct.pinterest.com')],
    code: [
      p(String.raw`pintrk\(\s*${Q}load${Q}\s*,\s*${Q}(\d{13})${Q}`, 'pintrk load'),
      p(String.raw`ct\.pinterest\.com${SL}v3${SL}?${ARG}tid=(\d{13})`, 'ct.pinterest.com'),
    ],
    gtm: [p(String.raw`"function":"__pntr"${IN_TAG}"vtp_tagId":"(\d{13})"`, 'Pinterest tag')],
    live: [{ key: 'global:pintrk', kind: 'code', label: 'pintrk function' }],
  },
  {
    id: 'snap',
    name: 'Snap Pixel',
    short: 'Snap',
    group: 'ads',
    format: new RegExp(`^${UUID}$`),
    src: [p(String.raw`sc-static\.net\/scevent\.min\.js`, 'scevent.min.js')],
    hits: [
      p(String.raw`tr(?:-shadow)?\.snapchat\.com\/[^\s?#]*${ARG}pid=(${UUID})`, 'tr.snapchat.com'),
      p(String.raw`tr(?:-shadow)?\.snapchat\.com\/`, 'tr.snapchat.com'),
    ],
    code: [p(String.raw`snaptr\(\s*${Q}init${Q}\s*,\s*${Q}(${UUID})${Q}`, 'snaptr init')],
    live: [{ key: 'global:snaptr', kind: 'code', label: 'snaptr function' }],
  },
  {
    id: 'x',
    name: 'X (Twitter) pixel',
    short: 'X pixel',
    group: 'ads',
    format: /^[a-z0-9]{4,8}$/,
    src: [p(String.raw`static\.ads-twitter\.com\/(?:uwt|oct)\.js`, 'uwt.js')],
    hits: [
      p(String.raw`(?:analytics\.twitter\.com|t\.co)\/i\/adsct${ARG}txn_id=([a-z0-9]{4,8})(?![a-z0-9])`, 'i/adsct'),
      p(String.raw`(?:analytics\.twitter\.com|t\.co)\/i\/adsct`, 'i/adsct'),
    ],
    code: [p(String.raw`twq\(\s*${Q}(?:config|init)${Q}\s*,\s*${Q}([a-z0-9]{4,8})${Q}`, 'twq config')],
    live: [{ key: 'global:twq', kind: 'code', label: 'twq function' }],
  },
  {
    id: 'uet',
    name: 'Microsoft Advertising UET',
    short: 'UET',
    group: 'ads',
    format: /^\d{6,10}$/,
    src: [p(String.raw`bat\.bing\.com\/bat\.js`, 'bat.js')],
    hits: [
      p(String.raw`bat\.bing\.(?:com|net)\/action\/0${ARG}ti=(\d{6,10})`, 'bat.bing.com/action'),
      p(String.raw`bat\.bing\.(?:com|net)\/action\/`, 'bat.bing.com/action'),
    ],
    code: [p(String.raw`\bti\s*:\s*${Q}(\d{6,10})${Q}`, 'UET tag', { within: /uetq|bat\.bing/ })],
    live: [{ key: 'global:uetq', kind: 'code', label: 'uetq queue' }],
  },
  {
    id: 'reddit',
    name: 'Reddit Pixel',
    short: 'Reddit',
    group: 'ads',
    format: /^(?:t2|a2)_[a-z0-9]{4,14}$/,
    src: [
      p(String.raw`redditstatic\.com\/ads\/(?:v2\/)?pixel\.js`, 'pixel.js'),
      p(String.raw`pixel-config\.reddit\.com\/pixels\/((?:t2|a2)_[a-z0-9]{4,14})\/`, 'pixel config'),
    ],
    hits: [
      p(String.raw`alb\.reddit\.com\/rp\.gif${ARG}id=((?:t2|a2)_[a-z0-9]{4,14})`, 'alb.reddit.com'),
      p(String.raw`alb\.reddit\.com\/rp\.gif`, 'alb.reddit.com'),
    ],
    code: [p(String.raw`rdt\(\s*${Q}init${Q}\s*,\s*${Q}((?:t2|a2)_[a-z0-9]{4,14})${Q}`, 'rdt init')],
    live: [{ key: 'global:rdt', kind: 'code', label: 'rdt function' }],
  },

  // ---------------------------------------------------------------- consent
  ...[
    ['cookiebot', 'Cookiebot', String.raw`consent(?:cdn)?\.cookiebot\.(?:com|eu)\/`, [['Cookiebot', 'loaded']]],
    ['onetrust', 'OneTrust', String.raw`(?:cdn\.cookielaw\.org|cookie-cdn\.cookiepro\.com|optanon\.blob\.core\.windows\.net)\/`, [['OneTrust', 'loaded'], ['OptanonWrapper', 'code']]],
    ['axeptio', 'Axeptio', String.raw`(?:static|client)\.axept\.io\/`, [['axeptioSettings', 'code']]],
    ['didomi', 'Didomi', String.raw`sdk\.privacy-center\.org\/`, [['Didomi', 'loaded'], ['didomiConfig', 'code']]],
    ['cookieyes', 'CookieYes', String.raw`cdn-cookieyes\.com\/`, [['getCkyConsent', 'loaded']]],
    ['termly', 'Termly', String.raw`app\.termly\.io\/`, [['Termly', 'loaded']]],
    ['iubenda', 'Iubenda', String.raw`(?:cdn|cs)\.iubenda\.com\/`, [['_iub', 'code']]],
    ['osano', 'Osano', String.raw`cmp\.osano\.com\/`, [['Osano', 'loaded']]],
    ['complianz', 'Complianz', String.raw`\/wp-content\/plugins\/complianz-gdpr(?:-premium)?\/`, [['complianz', 'code']]],
    ['usercentrics', 'Usercentrics', String.raw`(?:app|web\.cmp|privacy-proxy)\.usercentrics\.eu\/`, [['UC_UI', 'loaded'], ['__ucCmp', 'loaded']]],
  ].map(([id, name, host, globals]) => ({
    id,
    name,
    short: name,
    group: 'consent',
    sends: false,
    noId: true,
    src: [p(host, `${name} script`)],
    live: globals.map(([g, kind]) => ({ key: `global:${g}`, kind, label: `${g} ${kind === 'loaded' ? 'object' : 'settings'}` })),
  })),
];

const BY_ID = new Map(TRACKERS.map((t) => [t.id, t]));
export const trackerById = (id) => BY_ID.get(id);

// Every window global a catalog entry reads, for the page-world reader.
export const LIVE_GLOBALS = [...new Set(TRACKERS.flatMap((t) => (t.live ?? []).filter((l) => l.key.startsWith('global:')).map((l) => l.key.slice(7))))];

// ---- statuses ------------------------------------------------------------

export const STATUS = {
  sending: { rank: 4, label: 'Sending', kind: 'good', hint: 'A hit to its collection endpoint went out from this page.' },
  loaded: { rank: 3, label: 'Loaded, not sending', kind: 'neutral', hint: 'Its script loaded or its live state holds the ID, but no hit was seen (consent revoked, or it waits for an event).' },
  'in-page': { rank: 2, label: 'In the page, not loaded', kind: 'warn', hint: 'Its code is in the page but its script never loaded (a content blocker, a consent tool holding it, or a broken tag).' },
  'gtm-only': { rank: 1, label: 'In GTM only', kind: 'outline', hint: 'Configured in a GTM container the page loads, but not seen on this page (held by consent, fired on other pages or events).' },
};
const KIND_STATUS = { hit: 'sending', loaded: 'loaded', code: 'in-page', container: 'gtm-only' };

// GTM, the Google tag and consent banners never send hits of their own, so for
// them "loaded" is the best there is.
export function statusLabel(row) {
  if (row.status === 'loaded' && trackerById(row.tracker)?.sends === false) return 'Loaded';
  return STATUS[row.status]?.label ?? row.status;
}

// ---- IDs -----------------------------------------------------------------

export function validId(tracker, id) {
  if (typeof id !== 'string' || !tracker.format?.test(id)) return false;
  if (tracker.placeholders?.includes(id)) return false;
  const body = id.replace(/^[A-Z]{1,3}-/, '').replace(/[-_]/g, '');
  if (/^x+$/i.test(body)) return false; // G-XXXXXXXXXX, GTM-XXXXXXX
  if (/^(.)\1+$/.test(body)) return false; // 000000000000000
  if (/^(?:0?123456789|1234567)/.test(body)) return false; // 1234567890
  return true;
}

function idFrom(tracker, pattern, match) {
  const raw = match.slice(1).find((g) => g != null);
  if (raw == null) return { id: null };
  const id = pattern.prefix && !raw.startsWith(pattern.prefix) ? pattern.prefix + raw : raw;
  return validId(tracker, id) ? { id } : { invalid: true };
}

function* matches(tracker, patterns, text) {
  for (const pattern of patterns ?? []) {
    if (pattern.within && !pattern.within.test(text)) continue;
    for (const m of text.matchAll(pattern.re)) {
      const r = idFrom(tracker, pattern, m);
      if (!r.invalid) yield { pattern, id: r.id };
    }
  }
}

// The first signature that matches a URL (signatures with an ID come first).
function firstMatch(tracker, patterns, url) {
  for (const hit of matches(tracker, patterns, url)) return hit;
  return null;
}

// ---- GTM containers ------------------------------------------------------

// The container's `var data = {...}` object, or null (an excerpt, or a shape
// Google changed). Scans with string awareness to find the closing brace.
export function containerData(text) {
  const at = text.indexOf('var data = ');
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Inline GTM constant variables: ["macro",103] becomes "171496286752985" when
// macro 103 is a Constant. Lookup tables and other variables stay as they are.
export function resolveConstants(text) {
  const macros = containerData(text)?.resource?.macros;
  if (!Array.isArray(macros)) return text;
  return text.replace(/\["macro",\s*(\d+)\]/g, (whole, n) => {
    const m = macros[Number(n)];
    return m?.function === '__c' && typeof m.vtp_value === 'string' ? JSON.stringify(m.vtp_value) : whole;
  });
}

// Whether the permissions of a custom template (`__cvt_…`) let it inject a
// script from `host`, e.g. Meta's fbevents.js.
function templateInjects(text, fn, host) {
  const key = `"${fn}":{`;
  let at = text.indexOf(key);
  while (at >= 0) {
    const end = text.indexOf('\n"__', at + key.length);
    const block = text.slice(at, end < 0 ? at + 8000 : Math.min(end, at + 8000));
    if (/inject_script/.test(block) && host.test(block.replace(/\\\//g, '/'))) return true;
    at = text.indexOf(key, at + key.length);
  }
  return false;
}

// IDs a GTM container configures: [{ tracker, id, label }], plus
// { tracker, id: null, variable: true } for a template whose ID is a variable.
// Paused tags carry no parameters, so their IDs never show up here.
export function scanContainer(text, selfId = null) {
  const src = resolveConstants(String(text ?? ''));
  const out = [];
  const seen = new Set();
  for (const t of TRACKERS) {
    const patterns = [...(t.code ?? []).filter((x) => x.groups), ...(t.gtm ?? [])];
    for (const { pattern, id } of matches(t, patterns, src)) {
      if (!id || (t.id === 'gtm' && id === selfId)) continue;
      const key = `${t.id}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tracker: t.id, id, label: pattern.label });
    }
    for (const pattern of t.gtmVariable ?? []) {
      for (const m of src.matchAll(pattern.re)) {
        if (t.template && !(m[1] && templateInjects(src, m[1], t.template))) continue;
        out.push({ tracker: t.id, id: null, label: pattern.label, variable: true });
        break;
      }
    }
  }
  return out;
}

// ---- detection -----------------------------------------------------------

const RANK = (status) => STATUS[status]?.rank ?? 0;

// signals: what collectTrackerSignals() returned, plus `live` from
// readTrackerState() (or null). containers: [{ id, url, text } | { id, url, error }].
// Returns { trackers, containers, checked }. One row per tracker and ID.
export function detectTrackers(signals, containers = []) {
  const s = signals ?? {};
  const resources = [...new Set((s.resources ?? []).filter((u) => typeof u === 'string'))];
  const loaded = new Set(resources.map(stripHash));
  const evidence = new Map(); // tracker id -> [{ kind, label, id, variable }]
  const add = (t, kind, label, id, extra = {}) => {
    const list = evidence.get(t.id) ?? [];
    if (!list.some((e) => e.kind === kind && e.label === label && e.id === id)) list.push({ kind, label, id, ...extra });
    evidence.set(t.id, list);
  };

  for (const t of TRACKERS) {
    // Requests the page made: hits first, then the tracker's own scripts.
    for (const url of resources) {
      const hit = firstMatch(t, t.hits, url);
      if (hit) {
        add(t, 'hit', `hit to ${hit.pattern.label}`, hit.id);
        continue;
      }
      const script = firstMatch(t, t.src, url);
      if (!script) continue;
      // Requested is not loaded: a request a content blocker stopped is listed
      // too. Where the library's runtime can be checked and is missing, it never ran.
      if (didNotRun(t, s.live)) add(t, 'code', `${script.pattern.label} requested, never ran (blocked?)`, script.id);
      else add(t, 'loaded', `${script.pattern.label} loaded`, script.id);
    }
    // Script and iframe elements whose request never shows in resource timing.
    const elements = [
      ...(s.scripts ?? []).map((x) => ({ src: x?.src, attrs: x?.attrs ?? '', what: 'script' })),
      ...(s.iframes ?? []).map((src) => ({ src, attrs: '', what: 'iframe' })),
    ];
    for (const el of elements) {
      if (typeof el.src === 'string' && el.src && !loaded.has(stripHash(el.src))) {
        const m = firstMatch(t, [...(t.src ?? []), ...(t.hits ?? [])], el.src);
        if (m) add(t, 'code', `${m.pattern.label} ${el.what} in the page, not loaded`, m.id);
      }
      if (el.attrs && t.tag) {
        const tagText = `${el.attrs} src="${el.src ?? ''}"`;
        for (const m of matches(t, t.tag, tagText)) add(t, typeof el.src === 'string' && loaded.has(stripHash(el.src)) ? 'loaded' : 'code', `script ${m.pattern.label}`, m.id);
      }
    }
    // Inline code and noscript.
    for (const [list, where] of [
      [s.inline, 'inline'],
      [s.noscript, 'noscript'],
    ]) {
      for (const text of list ?? []) {
        if (typeof text !== 'string') continue;
        for (const m of matches(t, t.code, text)) add(t, 'code', `${where} ${m.pattern.label}`, m.id);
      }
    }
    // Live state from the page's own world.
    if (s.live) {
      for (const l of t.live ?? []) {
        if (l.key.startsWith('global:')) {
          if ((s.live.globals ?? []).includes(l.key.slice(7))) add(t, l.kind, l.label, null);
          continue;
        }
        for (const v of s.live.values?.[l.key] ?? []) if (validId(t, v)) add(t, l.kind, l.label, v);
      }
    }
  }

  // GTM containers.
  for (const c of containers ?? []) {
    if (typeof c?.text !== 'string') continue;
    for (const f of scanContainer(c.text, c.id)) {
      const t = trackerById(f.tracker);
      add(t, 'container', `${f.label} in ${c.id}`, f.id, f.variable ? { variable: true } : {});
    }
  }

  const rows = [];
  for (const t of TRACKERS) {
    const list = evidence.get(t.id);
    if (!list?.length) continue;
    const byId = new Map();
    for (const e of list.filter((e) => e.id)) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
    const general = list.filter((e) => !e.id && !e.variable);
    const variable = list.filter((e) => e.variable);
    const onPage = (evs) => evs.some((e) => e.kind !== 'container');
    const pageIds = [...byId.keys()].filter((id) => onPage(byId.get(id)));

    // Evidence without an ID (fbevents.js loaded, a Clarity collect hit) backs
    // every ID seen on the page. With none, the tracker gets a row of its own.
    if (general.length) {
      if (pageIds.length) for (const id of pageIds) byId.set(id, [...byId.get(id), ...general]);
      else byId.set(null, general);
    }
    // A template whose ID is a variable: it is the pixel seen on the page when
    // there is exactly one, otherwise its own "ID set by a GTM variable" row.
    if (variable.length) {
      const target = pageIds.length === 1 ? pageIds[0] : null;
      byId.set(target, [...(byId.get(target) ?? []), ...variable.map((e) => ({ ...e, label: `${e.label} (ID set by a GTM variable)` }))]);
    }

    for (const [id, evs] of byId) {
      let status = evs.reduce((best, e) => (RANK(KIND_STATUS[e.kind]) > RANK(best) ? KIND_STATUS[e.kind] : best), 'gtm-only');
      if (status === 'sending' && t.sends === false) status = 'loaded';
      const order = { hit: 0, loaded: 1, code: 2, container: 3 };
      rows.push({
        key: `${t.id}|${id ?? ''}`,
        tracker: t.id,
        name: t.name,
        short: t.short ?? t.name,
        group: t.group,
        id,
        idNote: id ? null : t.noId ? null : evs.some((e) => e.variable) ? 'ID set by a GTM variable' : 'No ID found',
        status,
        retired: !!t.retired,
        evidence: evs.sort((a, b) => order[a.kind] - order[b.kind]).map((e) => e.label),
      });
    }
  }

  const groupOrder = GROUPS.map((g) => g.id);
  const catalogOrder = TRACKERS.map((t) => t.id);
  rows.sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      catalogOrder.indexOf(a.tracker) - catalogOrder.indexOf(b.tracker) ||
      RANK(b.status) - RANK(a.status) ||
      String(a.id ?? '').localeCompare(String(b.id ?? '')),
  );

  return {
    trackers: rows,
    containers: (containers ?? []).map((c) => ({ id: c.id, url: c.url, ok: typeof c.text === 'string', error: c.error ?? null })),
    checked: {
      scripts: (s.scripts ?? []).length,
      inline: (s.inline ?? []).length,
      noscript: (s.noscript ?? []).length,
      resources: resources.length,
      live: !!s.live,
      capped: !!s.capped,
    },
  };
}

// The page-world read says the tracker's runtime is missing (not just unread).
function didNotRun(tracker, live) {
  return Boolean(tracker.ran && live?.ran && live.ran[tracker.ran] === false);
}

function stripHash(url) {
  const i = String(url).indexOf('#');
  return i < 0 ? String(url) : String(url).slice(0, i);
}

// The GTM containers to fetch: the exact gtm.js URL the page requested or holds
// in a script tag, else the default loader URL for a GTM ID only in its code.
export const MAX_CONTAINERS = 5;
export function containerTargets(signals, result) {
  const byId = new Map();
  const loader = /\/gtm\.js\?(?:[^#\s"'<>]*?&)?id=(GTM-[A-Z0-9]{4,10})(?![A-Z0-9])/;
  const gtm = trackerById('gtm');
  const urls = [...(signals?.resources ?? []), ...(signals?.scripts ?? []).map((x) => x?.src)];
  for (const url of urls) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const m = url.match(loader);
    if (m && validId(gtm, m[1]) && !byId.has(m[1])) byId.set(m[1], url);
  }
  for (const row of result?.trackers ?? []) {
    if (row.tracker === 'gtm' && row.id && row.status !== 'gtm-only' && !byId.has(row.id)) {
      byId.set(row.id, `https://www.googletagmanager.com/gtm.js?id=${row.id}`);
    }
  }
  return [...byId].slice(0, MAX_CONTAINERS).map(([id, url]) => ({ id, url }));
}

// ---- text for the popup --------------------------------------------------

// "Tracker: ID", one per line.
export function copyList(rows) {
  return (rows ?? []).map((r) => (r.id ? `${r.name}: ${r.id}` : r.idNote && r.idNote !== 'No ID found' ? `${r.name}: ${r.idNote}` : r.name)).join('\n');
}

// Overview chips: one per tracker, Meta Pixel once per ID.
export function overviewChips(rows) {
  const out = [];
  const seen = new Map();
  for (const r of rows ?? []) {
    const perId = r.tracker === 'meta';
    const key = perId ? r.key : r.tracker;
    const prev = seen.get(key);
    if (prev) {
      if (RANK(r.status) > RANK(prev.status)) prev.status = r.status;
      continue;
    }
    const chip = { key, tracker: r.tracker, label: perId && r.id ? `${r.short} ${r.id}` : r.short, status: r.status, group: r.group };
    seen.set(key, chip);
    out.push(chip);
  }
  return out;
}
