// Local fixture site for the end-to-end suite. Every SEO signal Loupe reads is
// present here with a known value, served under a strict style CSP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, 'assets');

export function startServer() {
  const seen = { ua: [] };
  const server = http.createServer(async (req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);
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
