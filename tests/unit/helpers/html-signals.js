// Turn a small HTML excerpt into the signals lib/tech.js reads, the way
// collectTrackerSignals and collectTechSignals (lib/inject.js) do in a page,
// so unit tests can run real excerpts (tests/unit/fixtures/tech-excerpts.json)
// through detectTech in Node. Regex-based: good enough for excerpts.

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

function attr(tag, name) {
  const m = new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, 'i').exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3]) : null;
}

export function signalsFromHtml(html, url) {
  const abs = (href) => {
    try {
      return new URL(href, url).href;
    } catch {
      return null;
    }
  };
  const out = { url, scripts: [], inline: [], resources: [], generators: [], links: [], comments: [], feeds: [], restLinks: [], bodyClass: '', dom: {}, live: null };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)(?:<\/script>|$)/gi)) {
    const src = attr(m[1], 'src');
    if (src) out.scripts.push({ src: abs(src) });
    else if (m[2].trim()) out.inline.push(m[2]);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    const href = attr(m[0], 'href');
    if (!href) continue;
    if (/(?:^|\s)(?:stylesheet|preload|modulepreload|prefetch)(?:\s|$)/.test(rel)) out.links.push(abs(href));
    else if (/(?:^|\s)alternate(?:\s|$)/.test(rel) && /(?:rss|atom)\+xml/i.test(attr(m[0], 'type') ?? '')) out.feeds.push({ href: abs(href), title: attr(m[0], 'title') ?? '' });
    else if (rel === 'https://api.w.org/') {
      out.restLinks.push(abs(href));
      out.dom.restLink = true;
    }
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ((attr(m[0], 'name') ?? '').toLowerCase() === 'generator') out.generators.push(attr(m[0], 'content') ?? '');
  }
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) out.comments.push(m[1].trim().slice(0, 400));
  const body = /<body\b[^>]*>/i.exec(html);
  if (body) out.bodyClass = attr(body[0], 'class') ?? '';
  const ng = /\sng-version\s*=\s*"([^"]*)"/i.exec(html);
  if (ng) out.dom.ngVersion = ng[1];
  if (/\sdata-wf-site\s*=/.test(html)) out.dom.wfSite = attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? '', 'data-wf-site') ?? 'x';
  if (/\sid\s*=\s*["']?__nuxt\b/.test(html)) out.dom.nuxtRoot = true;
  if (/\sid\s*=\s*["']?__NEXT_DATA__\b/.test(html)) out.dom.nextData = true;
  if (/\sid\s*=\s*["']?___gatsby\b/.test(html)) out.dom.gatsbyRoot = true;
  if (/<astro-island\b/i.test(html)) out.dom.astroIsland = 1;
  if (/\sdata-astro-cid-/i.test(html)) out.dom.astroCid = true;
  return out;
}
