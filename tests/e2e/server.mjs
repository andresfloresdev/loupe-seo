// Local fixture site for the end-to-end suite. Every SEO signal Loupe reads is
// present here with a known value, served under a strict style CSP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, 'assets');

export function startServer() {
  // ua: every /ua-page request's User-Agent. requests: every request, with what
  // tells a page load (dest "document") from a fetch (dest "empty").
  const seen = { ua: [], requests: [] };
  const server = http.createServer(async (req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);
    seen.requests.push({ path: url.pathname + url.search, ua: req.headers['user-agent'] ?? '', dest: req.headers['sec-fetch-dest'] ?? '' });
    const html = (body, headers = {}, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
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
  return null;
}
