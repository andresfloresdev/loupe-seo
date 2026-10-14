// Local fixture site for the end-to-end suite. Every SEO signal Loupe reads is
// present here with a known value, served under a strict style CSP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, 'assets');

export function startServer() {
  // ua: every /ua-page request's User-Agent. requests: every request, with what
  // tells a page load (dest "document") from a fetch (dest "empty"). all: the
  // same, never cleared, for the suite-wide checks.
  const seen = { ua: [], requests: [], all: [] };
  const server = http.createServer(async (req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);
    const record = { path: url.pathname + url.search, ua: req.headers['user-agent'] ?? '', dest: req.headers['sec-fetch-dest'] ?? '', cookie: req.headers.cookie ?? '' };
    seen.requests.push(record);
    seen.all.push(record);
    const html = (body, headers = {}, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(body);
    };
    const css = (body) => {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(body);
    };

    if (url.pathname === '/') {
      return html(MAIN(base), {
        'x-robots-tag': 'googlebot: noarchive',
        link: `<${base}/it/>; rel="alternate"; hreflang="it"`,
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:",
      });
    }
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`User-agent: *\nDisallow: /blocked\nAllow: /\n\nSitemap: ${base}/sitemap.xml\nSitemap: ${base}/sitemap-news.xml\n`);
    }
    if (url.pathname === '/blocked') {
      return html(
        `<!doctype html><html lang="en"><head><title>Blocked page</title><meta name="robots" content="noindex"><link rel="canonical" href="/blocked"></head><body><h1>Blocked</h1></body></html>`,
        { 'x-robots-tag': 'noindex' },
      );
    }
    if (url.pathname === '/fr/') {
      return html(`<!doctype html><html lang="fr"><head><title>FR</title><link rel="alternate" hreflang="en" href="${base}/"><link rel="alternate" hreflang="fr" href="${base}/fr/"></head><body>fr</body></html>`);
    }
    if (url.pathname === '/es/' || url.pathname === '/it/') {
      return html(`<!doctype html><html><head><title>No return link</title></head><body>x</body></html>`);
    }
    if (url.pathname === '/old-es') {
      res.writeHead(301, { location: '/es/' });
      return res.end();
    }
    if (url.pathname === '/de/') return html('not found', {}, 404);
    if (url.pathname === '/ua-page') {
      seen.ua.push(req.headers['user-agent']);
      return html(`<!doctype html><html><head><title>UA</title></head><body><pre id="ua">${escapeHtml(req.headers['user-agent'] ?? '')}</pre></body></html>`);
    }
    if (url.pathname === '/serp') return html(SERP);
    if (url.pathname === '/trackers') return html(TRACKERS_PAGE());
    if (url.pathname === '/trackers-quiet') return html(PIXEL_PAGE({ title: 'Quiet pixel', id: QUIET_PIXEL, consent: 'revoke' }));
    if (url.pathname === '/trackers-blocked') return html(PIXEL_PAGE({ title: 'Blocked pixel', id: BLOCKED_PIXEL, script: BLOCKED_FBEVENTS }));
    if (url.pathname === '/trackers-csp') {
      return html(PIXEL_PAGE({ title: 'Pixel under a CSP', id: CSP_PIXEL, nonce: 'loupe-csp' }), {
        'content-security-policy':
          "default-src 'self'; script-src 'nonce-loupe-csp' https://connect.facebook.net; img-src 'self' https://www.facebook.com; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'",
      });
    }
    if (url.pathname === '/trackers-none') {
      return html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>No trackers</title><script src="/app.js"></script></head><body><h1>Nothing to see</h1><script>document.body.dataset.ready = '1';</script></body></html>`,
      );
    }
    // Tech: a WordPress install in a subdirectory (/wp/), so every probe URL
    // has to come from the page's own links; and a Next.js page with a feed
    // link and a /wp-json/-looking link, which must trigger no WordPress probe.
    // A session cookie, as a WordPress site sets one: the probes must not send it.
    if (url.pathname === '/wp/') return html(WP_PAGE({ feed: true }), { link: '</wp/wp-json/>; rel="https://api.w.org/"', 'set-cookie': 'wp_e2e_session=1; Path=/; SameSite=Lax' });
    if (url.pathname === '/wp/about/') return html(WP_PAGE({ feed: false }));
    if (url.pathname === '/wp/about/feed/') return html('<!doctype html><title>Not found</title>', {}, 404);
    if (url.pathname === '/wp/feed/') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=UTF-8' });
      return res.end(WP_FEED);
    }
    if (url.pathname === '/wp/wp-json/') {
      // Only the namespaces: the full index is never asked for.
      if (url.searchParams.get('_fields') !== 'namespaces') return html('{"code":"loupe_e2e","message":"Only _fields=namespaces"}', {}, 400);
      res.writeHead(200, { 'content-type': 'application/json; charset=UTF-8' });
      return res.end(JSON.stringify({ namespaces: WP_NAMESPACES }));
    }
    if (url.pathname === '/wp/wp-content/themes/loupe-child/style.css') return css(`/*\nTheme Name: Loupe Child\nTemplate: twentytwentyfive\nVersion: 1.2.0\n*/\nbody{margin:0}`);
    if (url.pathname === '/wp/wp-content/themes/twentytwentyfive/style.css') return css(`/*\nTheme Name: Twenty Twenty-Five\nAuthor: the WordPress team\nVersion: 1.2\n*/`);
    if (/^\/wp\/wp-content\/(?:themes|plugins)\/.+\.css$/.test(url.pathname)) return css('/* asset */');
    if (/^\/wp\/wp-(?:content|includes)\/.+\.js$/.test(url.pathname) || /^\/_next\/static\/.+\.js$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('/* asset */');
    }
    if (url.pathname === '/wp/wp-links-opml.php') {
      res.writeHead(200, { 'content-type': 'text/xml; charset=UTF-8' });
      return res.end('<?xml version="1.0"?>\n<!-- generator="WordPress/6.9.4" -->\n<opml version="1.0"><head><title>Links</title></head><body></body></opml>');
    }
    // Paths Loupe must never ask for: answered, so a request would show in `seen`.
    if (/\/(?:readme\.txt|readme\.html|wp-login\.php)$|\/wp-admin(?:\/|$)/.test(url.pathname)) return html('<!doctype html><title>Never</title>');
    if (url.pathname === '/tech-next') {
      return html(NEXT_PAGE, { 'x-powered-by': 'Next.js', 'x-vercel-id': 'yul1::iad1::loupe-e2e' });
    }
    // Nuxt under a strict CSP: the page-world read must still work.
    if (url.pathname === '/tech-nuxt') {
      return html(NUXT_PAGE, {
        'content-security-policy': "default-src 'self'; script-src 'nonce-loupe-tech'; style-src 'self'; base-uri 'none'; object-src 'none'",
        'x-nf-request-id': '01JLOUPEE2E',
      });
    }
    if (url.pathname === '/tech-astro') return html(ASTRO_PAGE, { server: 'cloudflare', 'cf-ray': '9a1b2c3d4e5f6a7b-YUL' });
    if (url.pathname === '/tech-angular') return html(ANGULAR_PAGE, { 'x-served-by': 'cache-yul8920045-YUL' });
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('window.app = true;');
    }
    if (url.pathname.endsWith('.png')) {
      try {
        const file = await readFile(path.join(assets, path.basename(url.pathname)));
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(file);
      } catch {}
    }
    html('<!doctype html><title>404</title>', {}, 404);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}`, seen });
    });
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const MAIN = (base) => `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loupe fixture page for SEO checks</title>
<meta name="description" content="A fixture page with every kind of SEO signal Loupe reads, used by the end to end test suite.">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="generator" content="Fixture CMS 1.0">
<link rel="canonical" href="/">
<link rel="icon" href="/a.png">
<link rel="alternate" hreflang="en" href="/">
<link rel="alternate" hreflang="fr" href="/fr/">
<link rel="alternate" hreflang="de" href="${base}/de/">
<link rel="alternate" hreflang="es" href="${base}/old-es">
<link rel="alternate" hreflang="x-default" href="${base}/">
<meta property="og:title" content="Loupe fixture, Open Graph title">
<meta property="og:description" content="Open Graph description for the fixture.">
<meta property="og:image" content="/og.png">
<meta property="og:url" content="${base}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fixture Inc">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="X title for the fixture">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Fixture Inc","url":"https://fixture.example","address":{"@type":"PostalAddress","addressLocality":"Montréal"}},{"@type":"WebSite","name":"Fixture"}]}</script>
<script type="application/ld+json">{ "broken": </script>
</head>
<body>
<h1>Main heading</h1>
<p>Loupe reads this page in one pass. It counts these words, the headings, every link and every image.</p>
<h2>Section one</h2>
<h4>Skipped level</h4>
<h2>Section two</h2>
<h3 hidden>Hidden heading</h3>
<nav>
  <a href="/about">About us</a>
  <a href="/about">About again</a>
  <a href="https://example.org/" rel="nofollow">Nofollow external</a>
  <a href="https://example.net/" rel="sponsored noopener" target="_blank">Sponsored</a>
  <a href="https://example.com/ugc" rel="ugc">UGC link</a>
  <a href="mailto:hi@example.com">Email</a>
  <a href="tel:+15145550000">Call</a>
  <a href="#top">Back to top</a>
  <a href="/img-link"><img src="/a.png" alt="Image link alt" width="40" height="40"></a>
  <a href="/empty"></a>
</nav>
<img src="/b.png" width="80" height="80">
<img src="/c.png" alt="" width="10" height="10">
<img src="/big.png" alt="Big" title="Big image" width="100" loading="lazy">
<div itemscope itemtype="https://schema.org/Product">
  <span itemprop="name">Widget</span>
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
    <meta itemprop="price" content="9.99"><span itemprop="priceCurrency">CAD</span>
  </div>
</div>
<ul id="dyn"></ul>
<script>
setTimeout(() => {
  const a = document.createElement('a');
  a.href = 'https://late.example/';
  a.rel = 'nofollow';
  a.textContent = 'Late nofollow';
  document.getElementById('dyn').append(a);
}, 400);
</script>
</body>
</html>`;

// Mimics the structure of Google's "People also ask" box closely enough to
// exercise every extraction strategy, including Google adding questions on click.
const SERP = `<!doctype html>
<html><head><title>what is seo - Google Search</title></head>
<body>
<div id="paa">
  <div role="heading" aria-level="2"><span>People also ask</span></div>
  <div jsname="yEVEwb" data-q="What is technical SEO?"><div role="button" aria-expanded="false"><span>What is technical SEO?</span></div></div>
  <div jsname="yEVEwb" data-q="How do I start SEO?"><div role="button" aria-expanded="false"><span>How do I start SEO?</span></div></div>
  <div class="related-question-pair">
    <div role="button" aria-expanded="true" aria-controls="ans3">Is SEO dead in 2026?</div>
    <div id="ans3">No. Search still drives most discovery. <a href="https://example.org/seo-guide"><h3>Example SEO guide</h3></a></div>
  </div>
  <div><div role="button" aria-expanded="false">How long does SEO take?</div></div>
</div>
<script>
let n = 0;
document.getElementById('paa').addEventListener('click', (e) => {
  const b = e.target.closest('[aria-expanded="false"]');
  if (!b) return;
  b.setAttribute('aria-expanded', 'true');
  n++;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-q', 'Loaded question ' + n + '?');
  wrap.innerHTML = '<div role="button" aria-expanded="false"><span>Loaded question ' + n + '?</span></div>';
  document.getElementById('paa').append(wrap);
});
</script>
</body></html>`;

// ---- trackers ----------------------------------------------------------------
// Tracker pages load third-party scripts by their real URLs. The suite serves
// those hosts with Playwright routes (fakeThirdParty below) and aborts every
// other external request, so nothing leaves the machine.

export const FIRING_PIXEL = '611234567890123';
export const GTM_HTML_PIXEL = '722345678901234';
export const GTM_TEMPLATE_PIXEL = '833456789012345';
export const QUIET_PIXEL = '944567890123456';
export const BLOCKED_PIXEL = '955678901234567';
export const CSP_PIXEL = '966789012345678';
export const GTM_ID = 'GTM-LOUPE01';
export const GA4_ID = 'G-LOUPEFX01';
export const CLARITY_ID = 'loupefx01';
export const ADS_ID = 'AW-9876543210';
export const BLOCKED_FBEVENTS = 'https://connect.facebook.net/fr_CA/fbevents.js';

// Meta's base code, as sites paste it.
const fbqSnippet = ({ id, script = 'https://connect.facebook.net/en_US/fbevents.js', consent, nonce }) => `<script${nonce ? ` nonce="${nonce}"` : ''}>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script','${script}');
${consent ? `fbq('consent', '${consent}');\n` : ''}fbq('init', '${id}');
fbq('track', 'PageView');
</script>`;

const PIXEL_PAGE = ({ title, ...pixel }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
${fbqSnippet(pixel)}
</head><body><h1>${title}</h1>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${pixel.id}&amp;ev=PageView&amp;noscript=1"/></noscript>
</body></html>`;

const TRACKERS_PAGE = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Loupe trackers fixture</title>
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- Google tag (gtag.js), and a placeholder ID left in by a theme -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());gtag('config', '${GA4_ID}');gtag('config', 'G-XXXXXXXXXX');</script>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "${CLARITY_ID}");</script>
<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="00000000-0000-0000-0000-000000000000" type="text/javascript"></script>
${fbqSnippet({ id: FIRING_PIXEL })}
</head><body><h1>Trackers</h1><p>A page with trackers: a firing Meta Pixel, GTM, GA4, Clarity and a consent banner.</p>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${FIRING_PIXEL}&amp;ev=PageView&amp;noscript=1"/></noscript>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
</body></html>`;

// A GTM container in Google's shape (var data = {"resource": …}), with tags
// as real containers hold them: Meta's base code in a Custom HTML tag (escaped
// once more inside the JSON string), the Meta Pixel community template with a
// literal vtp_pixelId, a GA4 tag left on the placeholder ID, a paused tag and a
// Google Ads conversion tag. None of them run: the fake runtime only registers
// the container, so these pixels are "In GTM only".
const GTM_CONTAINER = () => {
  const html = `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init","${GTM_HTML_PIXEL}");fbq("track","PageView");</script>`;
  const data = {
    resource: {
      version: '7',
      macros: [{ function: '__e' }, { function: '__c', vtp_value: 'G-XXXXXXXXXX' }],
      tags: [
        { function: '__html', metadata: ['map'], once_per_event: true, vtp_html: html, vtp_supportDocumentWrite: false, tag_id: 3 },
        { function: '__cvt_9_12', metadata: ['map'], once_per_event: true, vtp_pixelId: GTM_TEMPLATE_PIXEL, vtp_standardEventName: 'PageView', tag_id: 5 },
        { function: '__gaawc', metadata: ['map'], once_per_event: true, vtp_measurementId: ['macro', 1], tag_id: 6 },
        { function: '__paused', vtp_originalTagType: 'html', tag_id: 7 },
        { function: '__awct', metadata: ['map'], once_per_event: true, vtp_conversionId: ADS_ID.slice(3), vtp_conversionLabel: 'LoupeLabel', tag_id: 8 },
      ],
    },
    runtime: [],
    permissions: { __cvt_9_12: { inject_script: { urls: ['https://connect.facebook.net/en_US/fbevents.js'] } } },
  };
  return `
// Copyright 2012 Google Inc. All rights reserved. (Loupe e2e fake)
(function(){

var data = ${JSON.stringify(data).replace(/</g, '\\u003C').replace(/\//g, '\\/')};
window.google_tag_manager = window.google_tag_manager || {};
window.google_tag_manager[${JSON.stringify(GTM_ID)}] = { dataLayer: { name: 'dataLayer' } };
})();`;
};

// fbevents.js, cut down: it runs the queue, honours consent, loads the
// pixel's signals config and fires a PageView hit per pixel to facebook.com/tr.
const FBEVENTS = `(function(){
  var f = window.fbq; if (!f) return;
  var pixels = {}; var revoked = false;
  function hit(id, ev) { var i = new Image(); i.src = 'https://www.facebook.com/tr/?id=' + id + '&ev=' + ev + '&dl=' + encodeURIComponent(location.href); }
  function run(a) {
    if (a[0] === 'consent') revoked = a[1] === 'revoke';
    else if (a[0] === 'init') {
      pixels[a[1]] = { id: a[1] };
      var s = document.createElement('script'); s.async = true;
      s.src = 'https://connect.facebook.net/signals/config/' + a[1] + '?v=2.9.300&r=stable';
      document.head.appendChild(s);
    } else if (a[0] === 'track' && !revoked) for (var id in pixels) hit(id, a[1]);
  }
  f.callMethod = function(){ run(arguments); };
  f.instance = { pixelsByID: pixels };
  f.getState = function(){ return { pixels: Object.keys(pixels).map(function(id){ return { id: id }; }) }; };
  var q = f.queue.slice(); f.queue.length = 0; q.forEach(run);
})();`;

// gtag.js: registers its tags and sends one collect hit per config ID, as
// GA4 sends page_view.
const GTAG = `(function(){
  var seen = {};
  var gtm = (window.google_tag_manager = window.google_tag_manager || {});
  (window.dataLayer || []).forEach(function(a){
    if (a && a[0] === 'config' && !seen[a[1]]) { seen[a[1]] = 1; gtm[a[1]] = gtm[a[1]] || {};
      fetch('https://region1.google-analytics.com/g/collect?v=2&tid=' + a[1] + '&en=page_view&dl=' + encodeURIComponent(location.href), { method: 'POST', mode: 'no-cors', keepalive: true });
    }
  });
})();`;

const CLARITY = `(function(){
  window.clarity = window.clarity || function(){};
  fetch('https://k.clarity.ms/collect', { method: 'POST', mode: 'no-cors', body: 'loupe-e2e' });
})();`;

const COOKIEBOT = `window.Cookiebot = { consented: false, declined: false, hasResponse: false };`;

const js = (body) => ({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// What a third-party URL answers in the suite, or null to abort it. `hit`
// marks a tracker's collection endpoint.
export function fakeThirdParty(url) {
  const u = new URL(url);
  const at = (host, path) => u.hostname === host && (typeof path === 'string' ? u.pathname === path : path.test(u.pathname));
  if (url.startsWith(BLOCKED_FBEVENTS)) return null; // a content blocker
  if (at('connect.facebook.net', /^\/[a-z]{2}_[A-Z]{2}\/fbevents\.js$/)) return js(FBEVENTS);
  if (at('connect.facebook.net', /^\/signals\/config\/\d+$/)) return js('/* signals config */');
  if (at('www.facebook.com', /^\/tr\/?$/)) return { status: 200, contentType: 'image/gif', body: GIF, hit: true };
  if (at('www.googletagmanager.com', '/gtm.js') && u.searchParams.get('id') === GTM_ID) return js(GTM_CONTAINER());
  if (at('www.googletagmanager.com', '/gtag/js')) return js(GTAG);
  if (at('region1.google-analytics.com', '/g/collect')) return { status: 204, body: '', hit: true };
  if (at('www.clarity.ms', `/tag/${CLARITY_ID}`)) return js(CLARITY);
  if (at('k.clarity.ms', '/collect')) return { status: 204, body: '', hit: true };
  if (at('consent.cookiebot.com', '/uc.js')) return js(COOKIEBOT);
  // Latest versions for the Tech tab: trimmed real answers.
  if (at('api.wordpress.org', '/core/version-check/1.7/')) return json(WP_OFFERS);
  if (at('api.wordpress.org', '/plugins/info/1.2/') || at('api.wordpress.org', '/themes/info/1.2/')) {
    const slug = u.searchParams.get('request[slug]');
    const known = WPORG_LATEST[slug];
    return known ? json(known) : json({ error: u.pathname.includes('plugins') ? 'Plugin not found.' : 'Theme not found' }, 404);
  }
  if (u.hostname === 'registry.npmjs.org') {
    const known = NPM_LATEST[decodeURIComponent(u.pathname)];
    return known ? json(known) : json({ error: 'Not found' }, 404);
  }
  return null;
}

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// https://api.wordpress.org/core/version-check/1.7/ on 2026-10-13, the offers'
// version fields only (the unit tests' copy).
const WP_OFFERS = JSON.parse(readFileSync(path.join(here, '..', 'unit', 'fixtures', 'wp-version-check-2026-10-13.json'), 'utf8'));
// plugins/info and themes/info answers, cut to the fields Loupe reads; the
// other slugs answer 404 as wordpress.org does for a premium or custom one.
const WPORG_LATEST = {
  'contact-form-7': { name: 'Contact Form 7', slug: 'contact-form-7', version: '6.2.2' },
  'wordpress-seo': { name: 'Yoast SEO', slug: 'wordpress-seo', version: '27.2' },
  twentytwentyfive: { name: 'Twenty Twenty-Five', slug: 'twentytwentyfive', version: '1.3' },
};
// registry.npmjs.org/<package>/latest on 2026-10-13, cut to name and version.
const NPM_LATEST = {
  '/next/latest': { name: 'next', version: '16.4.0' },
  '/nuxt/latest': { name: 'nuxt', version: '4.6.1' },
  '/vue/latest': { name: 'vue', version: '3.5.44' },
  '/astro/latest': { name: 'astro', version: '7.3.8' },
  '/@angular/core/latest': { name: '@angular/core', version: '22.2.2' },
};

export const WP_NAMESPACES = ['oembed/1.0', 'contact-form-7/v1', 'yoast/v1', 'wpml/v1', 'loupe-gallery/v2', 'wp/v2', 'wp-site-health/v1', 'wp-block-editor/v1'];

const WP_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Loupe WordPress fixture</title><link>/wp/</link>
<lastBuildDate>Tue, 13 Oct 2026 12:00:00 +0000</lastBuildDate><language>en-CA</language>
<generator>https://wordpress.org/?v=6.9.4</generator>
</channel></rss>`;

// A WordPress page as WordPress writes it, from /wp/: no generator meta (the
// core version comes from the feed; on /wp/about/ the feed answers 404, so it
// comes from wp-links-opml.php), a child theme of Twenty Twenty-Five, three named
// plugins and one Loupe only knows by its folder. It links to wp-login.php,
// wp-admin and readme.txt the way a Meta widget does; Loupe never asks for them.
const WP_PAGE = ({ feed }) => `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<title>${feed ? 'Loupe WordPress fixture' : 'About, Loupe WordPress fixture'}</title>
${feed ? `<link rel="alternate" type="application/rss+xml" title="Fixture &raquo; Feed" href="/wp/feed/">
<link rel="alternate" type="application/rss+xml" title="Fixture &raquo; Comments Feed" href="/wp/comments/feed/">` : `<link rel="alternate" type="application/rss+xml" title="Fixture &raquo; About Feed" href="/wp/about/feed/">`}
<link rel="https://api.w.org/" href="/wp/wp-json/">
<meta name="generator" content="WPML ver:4.6.5 stt:1,4;">
<!-- This site is optimized with the Yoast SEO plugin v27.2 - https://yoast.com/wordpress/plugins/seo/ -->
<link rel="stylesheet" id="contact-form-7-css" href="/wp/wp-content/plugins/contact-form-7/includes/css/styles.css?ver=5.9.5">
<link rel="stylesheet" id="loupe-gallery-css" href="/wp/wp-content/plugins/loupe-gallery/css/gallery.css?ver=2.0.1">
<link rel="stylesheet" id="twentytwentyfive-style-css" href="/wp/wp-content/themes/twentytwentyfive/assets/css/base.css?ver=1.2">
<link rel="stylesheet" id="loupe-child-style-css" href="/wp/wp-content/themes/loupe-child/style.css?ver=1.2.0">
<script src="/wp/wp-includes/js/jquery/jquery.min.js?ver=3.7.1" id="jquery-core-js"></script>
<script src="/wp/wp-includes/js/dist/hooks.min.js?ver=4d63a3d491d11ffd8ac6" id="wp-hooks-js"></script>
</head>
<body class="home blog wp-embed-responsive wp-theme-twentytwentyfive wp-child-theme-loupe-child">
<h1>WordPress fixture</h1>
<p>A WordPress page served from a subdirectory install.</p>
<ul><li><a href="/wp/wp-login.php">Log in</a></li><li><a href="/wp/wp-admin/">Site admin</a></li><li><a href="/wp/readme.txt">Read me</a></li></ul>
</body>
</html>`;

// Next.js, as its pages give it away, with a feed link that only a WordPress
// page would make Loupe follow.
const NEXT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Next.js fixture</title>
<link rel="alternate" type="application/rss+xml" href="/feed/">
<script src="/_next/static/chunks/main-app.js" async></script>
</head>
<body>
<div id="__next"><h1>Next.js fixture</h1><p>Built with Next.js.</p></div>
<script>window.next = { version: '16.3.6', appDir: true };</script>
</body>
</html>`;


// Nuxt as nuxt.com gives it away: the #__nuxt mount element's Vue app, with
// Nuxt's versions on $nuxt, set by a nonce'd script under a strict CSP.
const NUXT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nuxt fixture</title>
</head>
<body>
<div id="__nuxt"><h1>Nuxt fixture</h1></div>
<script nonce="loupe-tech">document.getElementById('__nuxt').__vue_app__ = { version: '3.5.43', $nuxt: { versions: { nuxt: '4.6.1', vue: '3.5.43' } } };</script>
</body>
</html>`;

// Astro: the generator meta gives the version, an island proves it. The word
// Astro in the text is not a signal.
const ASTRO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="Astro v7.3.5">
<title>Astro fixture</title>
</head>
<body>
<h1>Astro fixture</h1>
<p>Astronomy and Astro, as words in a page.</p>
<astro-island uid="Z1lo0e" component-url="/_astro/Counter.js" client="visible"><button>0</button></astro-island>
</body>
</html>`;

// Angular: the ng-version attribute, as angular.dev's raw HTML has it.
const ANGULAR_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Angular fixture</title>
</head>
<body>
<app-root ng-version="22.2.2+sha-68c6c57"><h1>Angular fixture</h1></app-root>
</body>
</html>`;