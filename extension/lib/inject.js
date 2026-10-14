// Functions injected into the inspected tab with scripting.executeScript({ func }).
// The browser serialises each one with Function.prototype.toString, so every
// function here must be fully self-contained: no imports, no outer variables.

export function collectPage() {
  const LIMIT = 5000;
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const metaByName = (name) =>
    all('meta[name]').filter((m) => (m.getAttribute('name') || '').trim().toLowerCase() === name);
  const firstMeta = (name) => {
    const m = metaByName(name)[0];
    return m ? m.getAttribute('content') ?? '' : null;
  };
  const isShown = (el) => {
    try {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }
      if (!el.getClientRects().length) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.opacity !== '0';
    } catch {
      return true;
    }
  };
  const absolute = (value) => {
    if (value == null) return '';
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return String(value);
    }
  };

  // ---- head
  const titles = all('title').filter((t) => !t.closest('svg'));
  const head = {
    title: titles.length ? clean(titles[0].textContent) : null,
    titleCount: titles.length,
    description: firstMeta('description'),
    descriptionCount: metaByName('description').length,
    robots: firstMeta('robots'),
    robotsCount: metaByName('robots').length,
    googlebot: firstMeta('googlebot'),
    keywords: firstMeta('keywords'),
    author: firstMeta('author'),
    generator: firstMeta('generator'),
    viewport: firstMeta('viewport'),
    themeColor: firstMeta('theme-color'),
    charset: document.characterSet,
    lang: document.documentElement.getAttribute('lang'),
    dir: document.documentElement.getAttribute('dir'),
    canonicals: all('link[rel~="canonical" i]').map((l) => ({ href: absolute(l.getAttribute('href')), raw: l.getAttribute('href') })),
    favicon: (() => {
      const l = all('link[rel~="icon" i]')[0];
      return l ? absolute(l.getAttribute('href')) : absolute('/favicon.ico');
    })(),
    amphtml: (() => {
      const l = document.querySelector('link[rel~="amphtml" i]');
      return l ? absolute(l.getAttribute('href')) : null;
    })(),
    prev: (() => {
      const l = document.querySelector('link[rel~="prev" i]');
      return l ? absolute(l.getAttribute('href')) : null;
    })(),
    next: (() => {
      const l = document.querySelector('link[rel~="next" i]');
      return l ? absolute(l.getAttribute('href')) : null;
    })(),
    metaRefresh: (() => {
      const m = document.querySelector('meta[http-equiv="refresh" i]');
      return m ? m.getAttribute('content') : null;
    })(),
    base: (() => {
      const b = document.querySelector('base[href]');
      return b ? b.getAttribute('href') : null;
    })(),
  };

  // ---- body text
  const bodyText = document.body ? document.body.innerText || '' : '';
  const words = bodyText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];

  // ---- headings
  const headingEls = all('h1, h2, h3, h4, h5, h6');
  const headings = headingEls.slice(0, LIMIT).map((el, index) => ({
    index,
    level: Number(el.tagName.charAt(1)),
    text: clean(el.innerText || el.textContent),
    shown: isShown(el),
  }));

  // ---- links
  const anchorEls = all('a[href], area[href]');
  const links = anchorEls.slice(0, LIMIT).map((a, index) => {
    const raw = a.getAttribute('href');
    let text = clean(a.innerText || a.textContent);
    let textSource = 'text';
    if (!text) {
      const img = a.querySelector('img[alt]');
      const imgAlt = img ? clean(img.getAttribute('alt')) : '';
      if (imgAlt) {
        text = imgAlt;
        textSource = 'image alt';
      } else {
        const label = clean(a.getAttribute('aria-label') || a.getAttribute('title'));
        if (label) {
          text = label;
          textSource = 'label';
        }
      }
    }
    return {
      index,
      href: absolute(raw),
      raw,
      text,
      textSource,
      rel: clean(a.getAttribute('rel')).toLowerCase(),
      target: a.getAttribute('target') || '',
      shown: isShown(a),
    };
  });

  // ---- images
  const imageEls = all('img');
  const images = imageEls.slice(0, LIMIT).map((img, index) => {
    const rect = img.getBoundingClientRect();
    return {
      index,
      src: img.currentSrc || absolute(img.getAttribute('src')) || absolute(img.getAttribute('data-src')),
      raw: img.getAttribute('src') || img.getAttribute('data-src') || '',
      alt: img.getAttribute('alt'),
      title: img.getAttribute('title'),
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
      shownWidth: Math.round(rect.width),
      shownHeight: Math.round(rect.height),
      loading: img.getAttribute('loading') || '',
      srcset: Boolean(img.getAttribute('srcset')),
      shown: isShown(img),
    };
  });

  // ---- structured data
  const jsonld = all('script[type="application/ld+json" i]').map((s) => s.textContent || '');

  const propValue = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.hasAttribute('content')) return el.getAttribute('content');
    if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].includes(tag)) return absolute(el.getAttribute('src'));
    if (['a', 'area', 'link'].includes(tag)) return absolute(el.getAttribute('href'));
    if (tag === 'object') return absolute(el.getAttribute('data'));
    if (tag === 'data' || tag === 'meter') return el.getAttribute('value');
    if (tag === 'time') return el.getAttribute('datetime') || clean(el.textContent);
    return clean(el.textContent);
  };
  const parseItem = (root, depth) => {
    const item = { type: clean(root.getAttribute('itemtype')), id: root.getAttribute('itemid') || undefined, props: [] };
    const walk = (node) => {
      for (const child of node.children) {
        if (child.hasAttribute('itemprop')) {
          const names = clean(child.getAttribute('itemprop')).split(' ');
          const nested = child.hasAttribute('itemscope');
          const value = nested
            ? depth < 6
              ? parseItem(child, depth + 1)
              : { type: clean(child.getAttribute('itemtype')), props: [] }
            : propValue(child);
          for (const name of names) item.props.push({ name, value });
          if (!nested) walk(child);
        } else if (!child.hasAttribute('itemscope')) {
          walk(child);
        }
      }
    };
    walk(root);
    return item;
  };
  const microdata = all('[itemscope]')
    .filter((el) => !el.hasAttribute('itemprop'))
    .slice(0, 200)
    .map((el) => parseItem(el, 0));

  const rdfaTypes = all('[typeof]')
    .slice(0, 200)
    .map((el) => clean(el.getAttribute('typeof')))
    .filter(Boolean);

  // ---- hreflang
  const hreflang = all('link[rel~="alternate" i][hreflang]').map((l) => ({
    lang: clean(l.getAttribute('hreflang')),
    href: absolute(l.getAttribute('href')),
    raw: l.getAttribute('href'),
  }));

  // ---- social
  const og = all('meta[property]')
    .filter((m) => /^(og|article|fb|book|profile|product|music|video):/i.test(m.getAttribute('property') || ''))
    .map((m) => ({ key: m.getAttribute('property'), value: m.getAttribute('content') ?? '' }));
  const twitter = all('meta[name^="twitter:" i], meta[property^="twitter:" i]').map((m) => ({
    key: (m.getAttribute('name') || m.getAttribute('property')).toLowerCase(),
    value: m.getAttribute('content') ?? '',
  }));

  return {
    url: location.href,
    collectedAt: Date.now(),
    head,
    wordCount: words.length,
    headings,
    headingTotal: headingEls.length,
    links,
    linkTotal: anchorEls.length,
    images,
    imageTotal: imageEls.length,
    jsonld,
    microdata,
    rdfaTypes,
    hreflang,
    og,
    twitter,
  };
}

// Scroll to an element and pulse an outline on it. Uses CSSOM and WAAPI only,
// which page Content-Security-Policy does not block.
export function flashElement(selector, index) {
  const el = document.querySelectorAll(selector)[index];
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  const prev = {
    outline: el.style.getPropertyValue('outline'),
    outlinePriority: el.style.getPropertyPriority('outline'),
    offset: el.style.getPropertyValue('outline-offset'),
  };
  el.style.setProperty('outline', '3px solid rgba(16, 185, 129, 0.95)', 'important');
  el.style.setProperty('outline-offset', '4px', 'important');
  try {
    el.animate(
      [
        { outlineColor: 'rgba(16, 185, 129, 0)' },
        { outlineColor: 'rgba(16, 185, 129, 0.95)', offset: 0.15 },
        { outlineColor: 'rgba(16, 185, 129, 0.35)', offset: 0.5 },
        { outlineColor: 'rgba(16, 185, 129, 0.95)', offset: 0.75 },
        { outlineColor: 'rgba(16, 185, 129, 0)' },
      ],
      { duration: 1800, easing: 'ease-in-out' },
    );
  } catch {}
  setTimeout(() => {
    el.style.setProperty('outline', prev.outline, prev.outlinePriority);
    el.style.setProperty('outline-offset', prev.offset);
  }, 1850);
  return true;
}

// Save text as a file through the page itself. Safari has no downloads API,
// and a blob link clicked from the page is the path every web app uses.
export function downloadFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  (document.body || document.documentElement).appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
  return true;
}

// "People also ask" on a Google results page. Google changes its markup
// often, so this combines several independent signals.
export function extractPAA() {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const HEADINGS =
    /^(people also ask|autres questions posées|d'autres questions|les internautes ont aussi demandé|las personas también preguntan|más preguntas|andere fragen|ähnliche fragen|altre domande|outras perguntas|as pessoas também perguntam|mensen vragen ook)/i;
  const out = [];
  const seen = new Set();

  const answerFor = (node) => {
    if (!node) return { answer: '', source: '', sourceTitle: '' };
    let region = null;
    const controls = node.getAttribute && node.getAttribute('aria-controls');
    if (controls) region = document.getElementById(controls);
    const pair = node.closest('.related-question-pair, [data-q], [data-initq]');
    const scope = region || pair;
    if (!scope || node.getAttribute('aria-expanded') === 'false') return { answer: '', source: '', sourceTitle: '' };
    const link = Array.from(scope.querySelectorAll('a[href^="http"]')).find((a) => {
      try {
        return !/(^|\.)google\./i.test(new URL(a.href).hostname);
      } catch {
        return false;
      }
    });
    const sourceTitle = link ? clean((link.querySelector('h3') || link).textContent) : '';
    let answer = '';
    if (region) {
      answer = clean(region.innerText || region.textContent);
    } else if (pair) {
      const full = clean(pair.innerText || pair.textContent);
      const q = clean(node.innerText || node.textContent);
      answer = clean(full.replace(q, '').replace(sourceTitle, ''));
    }
    return { answer: answer.slice(0, 600), source: link ? link.href : '', sourceTitle };
  };

  const add = (question, node) => {
    const q = clean(question);
    if (!q || q.length > 300) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ question: q, ...answerFor(node) });
  };

  for (const el of document.querySelectorAll('[data-q]')) {
    add(el.getAttribute('data-q'), el.querySelector('[aria-expanded]') || el);
  }
  for (const el of document.querySelectorAll('[data-initq]')) {
    add(el.getAttribute('data-initq'), el.querySelector('[aria-expanded]') || el);
  }
  for (const el of document.querySelectorAll('.related-question-pair')) {
    const button = el.querySelector('[aria-expanded], [role="button"]');
    add(button ? button.innerText || button.textContent : '', button || el);
  }
  const headingEls = Array.from(document.querySelectorAll('[role="heading"], h2, h3, span, div')).filter(
    (el) => el.children.length <= 2 && HEADINGS.test(clean(el.textContent)),
  );
  for (const heading of headingEls) {
    let box = heading;
    for (let i = 0; i < 8 && box; i++) {
      if (box.querySelectorAll('[aria-expanded]').length >= 2) break;
      box = box.parentElement;
    }
    if (!box) continue;
    for (const button of box.querySelectorAll('[aria-expanded]')) {
      const text = clean(button.innerText || button.textContent);
      if (text && text.length <= 300 && !HEADINGS.test(text)) add(text, button);
    }
  }
  return { url: location.href, questions: out };
}

// Click collapsed questions so Google loads more of them. Returns the click count.
export function expandPAA(max) {
  const HEADINGS = /^(people also ask|autres questions posées|las personas también preguntan|andere fragen|altre domande|outras perguntas)/i;
  const buttons = new Set();
  for (const el of document.querySelectorAll('[data-q] [aria-expanded="false"], .related-question-pair [aria-expanded="false"]')) {
    buttons.add(el);
  }
  for (const heading of document.querySelectorAll('[role="heading"], h2, h3, span, div')) {
    if (heading.children.length > 2 || !HEADINGS.test((heading.textContent || '').trim())) continue;
    let box = heading;
    for (let i = 0; i < 8 && box; i++) {
      if (box.querySelectorAll('[aria-expanded]').length >= 2) break;
      box = box.parentElement;
    }
    if (box) box.querySelectorAll('[aria-expanded="false"]').forEach((b) => buttons.add(b));
  }
  let clicks = 0;
  for (const button of buttons) {
    if (clicks >= max) break;
    button.click();
    clicks++;
  }
  return clicks;
}

// What the page's code holds and which requests it made, for the Trackers tab
// (lib/trackers.js reads it). Runs in the isolated world like collectPage.
// Inline scripts are capped at 200 KB each and 2 MB in all; `capped` says so.
export function collectTrackerSignals() {
  const PER_SCRIPT = 200_000;
  const TOTAL = 2_000_000;
  const out = { url: location.href, scripts: [], inline: [], noscript: [], iframes: [], resources: [], capped: null };
  let total = 0;
  let cutScripts = 0;
  let cutTotal = 0;
  const attrs = (el) => {
    let s = '';
    for (const a of Array.from(el.attributes)) {
      if (a.name !== 'src') s += ` ${a.name}="${String(a.value).slice(0, 400)}"`;
    }
    return s.slice(0, 1500);
  };
  for (const el of Array.from(document.querySelectorAll('script'))) {
    try {
      const type = (el.getAttribute('type') || '').trim().toLowerCase();
      if (type === 'application/ld+json' || type === 'importmap' || type === 'speculationrules') continue;
      if (el.hasAttribute('src')) {
        if (out.scripts.length < 500) out.scripts.push({ src: String(el.src).slice(0, 2000), attrs: attrs(el) });
        continue;
      }
      let text = el.textContent || '';
      if (!text.trim()) continue;
      if (text.length > PER_SCRIPT) {
        text = text.slice(0, PER_SCRIPT);
        cutScripts++;
      }
      if (total + text.length > TOTAL) {
        text = text.slice(0, Math.max(0, TOTAL - total));
        cutTotal++;
      }
      if (!text) continue;
      total += text.length;
      out.inline.push(text);
    } catch {}
  }
  for (const el of Array.from(document.querySelectorAll('noscript')).slice(0, 100)) {
    try {
      out.noscript.push(String(el.textContent || '').slice(0, 20_000));
    } catch {}
  }
  for (const el of Array.from(document.querySelectorAll('iframe[src]')).slice(0, 200)) {
    try {
      out.iframes.push(String(el.src).slice(0, 2000));
    } catch {}
  }
  try {
    for (const e of performance.getEntriesByType('resource').slice(0, 5000)) out.resources.push(String(e.name).slice(0, 2000));
  } catch {}
  if (cutScripts || cutTotal) out.capped = { scripts: cutScripts, total: cutTotal > 0, limit: '200 KB per script, 2 MB in all' };
  return out;
}

// Trackers' live state, read in the page's own world (executeScript world
// MAIN). Read-only: property reads only, plus Meta's getState() as a fallback,
// which returns state and sends nothing. Every read is wrapped, and only plain
// strings come back. `names`: window globals whose presence counts.
// `ran` says whether a library's own runtime is there, beyond the stub the
// base code defines: the browser lists a request a content blocker stopped in
// resource timing as if it had loaded, so a script's request alone is no proof.
export function readTrackerState(names) {
  const out = { globals: [], values: {}, ran: {} };
  const w = window;
  const add = (key, v) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const s = String(v).slice(0, 120);
    const list = (out.values[key] ??= []);
    if (s && list.length < 50 && !list.includes(s)) list.push(s);
  };
  const read = (fn) => {
    try {
      fn();
    } catch {}
  };
  for (const name of Array.isArray(names) ? names.slice(0, 100) : []) {
    read(() => {
      if (typeof name === 'string' && name in w && w[name] != null) out.globals.push(name);
    });
  }
  // Meta Pixel: fbevents.js replaces the stub's queue with its own instance.
  read(() => {
    out.ran.fbq = !!(w.fbq && (typeof w.fbq.instance === 'object' || typeof w.fbq.getState === 'function'));
  });
  // Google: gtm.js and gtag.js register their containers and tags here.
  read(() => {
    out.ran.google = !!(w.google_tag_manager && typeof w.google_tag_manager === 'object');
  });
  // Meta Pixel: the pixels fbevents.js initialised, then inits still queued.
  read(() => {
    const byId = w.fbq?.instance?.pixelsByID;
    if (byId && typeof byId === 'object') for (const id of Object.keys(byId)) add('fbq.pixels', id);
  });
  read(() => {
    if (out.values['fbq.pixels'] || typeof w.fbq?.getState !== 'function') return;
    for (const px of w.fbq.getState()?.pixels ?? []) add('fbq.pixels', px?.id);
  });
  read(() => {
    for (const args of Array.from(w.fbq?.queue ?? []).slice(0, 200)) read(() => args?.[0] === 'init' && add('fbq.queue', args[1]));
  });
  // Google: containers and tags the runtime holds, and gtag('config') calls.
  read(() => {
    const gtm = w.google_tag_manager;
    if (gtm && typeof gtm === 'object') for (const key of Object.keys(gtm).slice(0, 200)) if (/^[A-Z]{1,3}-/.test(key)) add('gtm', key);
  });
  read(() => {
    if (!Array.isArray(w.dataLayer)) return;
    for (const entry of w.dataLayer.slice(0, 1000)) read(() => entry?.[0] === 'config' && add('dataLayer.config', entry[1]));
  });
  // LinkedIn, TikTok, Hotjar, Matomo.
  read(() => add('linkedin.partner', w._linkedin_partner_id));
  read(() => {
    for (const id of Array.from(w._linkedin_data_partner_ids ?? []).slice(0, 20)) add('linkedin.partner', id);
  });
  read(() => {
    const pixels = w.ttq?._i;
    if (pixels && typeof pixels === 'object') for (const id of Object.keys(pixels).slice(0, 20)) add('ttq.pixels', id);
  });
  read(() => add('hotjar.site', w.hjSiteSettings?.site_id));
  read(() => add('hotjar.settings', w._hjSettings?.hjid));
  read(() => {
    if (!Array.isArray(w._paq)) return;
    for (const entry of w._paq.slice(0, 200)) read(() => entry?.[0] === 'setSiteId' && add('matomo.site', entry[1]));
  });
  return out;
}

// What the Tech tab reads beyond collectTrackerSignals (script srcs, inline
// scripts, requests): every generator meta (collectPage keeps the first only),
// stylesheet and preload URLs, HTML comments, the feed and REST API links,
// <body> classes and a few framework markers. Isolated world, read-only.
// Comments are capped: 400 characters each, the first 250 and the last 50.
export function collectTechSignals() {
  const out = { url: location.href, generators: [], links: [], comments: [], feeds: [], restLinks: [], bodyClass: '', dom: {} };
  const attr = (el, name) => String(el.getAttribute(name) ?? '').slice(0, 300);
  const read = (fn) => {
    try {
      fn();
    } catch {}
  };
  read(() => {
    for (const m of Array.from(document.querySelectorAll('meta[name="generator" i]')).slice(0, 20)) {
      const c = attr(m, 'content').trim();
      if (c) out.generators.push(c);
    }
  });
  read(() => {
    for (const l of Array.from(document.querySelectorAll('link[href]')).slice(0, 1500)) {
      const rel = (l.getAttribute('rel') || '').trim().toLowerCase();
      const href = String(l.href).slice(0, 2000);
      if (/(?:^|\s)(?:stylesheet|preload|modulepreload|prefetch)(?:\s|$)/.test(rel) && out.links.length < 500) out.links.push(href);
      else if (/(?:^|\s)alternate(?:\s|$)/.test(rel) && /(?:rss|atom)\+xml/i.test(l.getAttribute('type') || '') && out.feeds.length < 5) out.feeds.push({ href, title: attr(l, 'title').slice(0, 120) });
      else if (rel === 'https://api.w.org/' && out.restLinks.length < 3) out.restLinks.push(href);
    }
  });
  read(() => {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    const last = [];
    let seen = 0;
    for (let n = walker.nextNode(); n && seen < 20_000; n = walker.nextNode()) {
      seen++;
      const t = String(n.nodeValue || '').trim().slice(0, 400);
      if (!t) continue;
      if (out.comments.length < 250) out.comments.push(t);
      else {
        last.push(t);
        if (last.length > 50) last.shift();
      }
    }
    out.comments.push(...last);
  });
  read(() => {
    out.bodyClass = String(document.body?.className || '').slice(0, 3000);
  });
  const dom = out.dom;
  read(() => {
    const ng = document.querySelector('[ng-version]');
    if (ng) dom.ngVersion = attr(ng, 'ng-version').slice(0, 60);
  });
  read(() => {
    const site = document.documentElement.getAttribute('data-wf-site');
    if (site) dom.wfSite = String(site).slice(0, 60);
  });
  for (const [key, id] of [
    ['nuxtRoot', '__nuxt'],
    ['nuxtData', '__NUXT_DATA__'],
    ['nextData', '__NEXT_DATA__'],
    ['gatsbyRoot', '___gatsby'],
  ]) {
    read(() => {
      if (document.getElementById(id)) dom[key] = true;
    });
  }
  read(() => {
    const n = document.querySelectorAll('astro-island').length;
    if (n) dom.astroIsland = n;
  });
  read(() => {
    if (document.querySelector('[data-v-app]')) dom.vueApp = true;
  });
  read(() => {
    if (document.querySelector('[data-reactroot]')) dom.reactRoot = true;
  });
  read(() => {
    if (document.querySelector('link[rel="https://api.w.org/"]')) dom.restLink = true;
  });
  // Attribute names: one pass over the first 3000 elements.
  read(() => {
    for (const el of Array.from(document.getElementsByTagName('*')).slice(0, 3000)) {
      for (const a of Array.from(el.attributes)) {
        const name = a.name;
        if (name.startsWith('data-astro-cid')) dom.astroCid = true;
        else if (name.startsWith('data-sveltekit-')) dom.svelteKitAttr = true;
        else if (/^hx-(?:get|post|put|patch|delete|target|swap|trigger|boost)$/.test(name)) dom.htmxAttr = true;
        else if (name === 'x-data') dom.alpineAttr = true;
      }
    }
  });
  return out;
}

// Tech's live state, read in the page's own world (executeScript world MAIN),
// like readTrackerState: property reads only, never a call to a page function,
// every read in its own try/catch, and only plain strings come back. `values`
// holds versions and names, `flags` the globals and DOM marks that are there.
export function readTechState() {
  const out = { values: {}, flags: [] };
  const w = window;
  const set = (key, v) => {
    if (out.values[key] !== undefined) return;
    if ((typeof v === 'string' && v) || (typeof v === 'number' && Number.isFinite(v))) out.values[key] = String(v).slice(0, 80);
  };
  const flag = (key) => {
    if (!out.flags.includes(key)) out.flags.push(key);
  };
  const read = (fn) => {
    try {
      fn();
    } catch {}
  };
  read(() => set('next.version', w.next?.version));
  // Nuxt: the app on #__nuxt holds Nuxt's and Vue's versions.
  read(() => {
    const app = document.getElementById('__nuxt')?.__vue_app__;
    read(() => set('nuxt.version', app?.$nuxt?.versions?.nuxt));
    read(() => set('nuxt.vue', app?.$nuxt?.versions?.vue));
    read(() => set('vue.version', app?.version));
  });
  read(() => {
    if (w.__NUXT__ || w.$nuxt) flag('nuxt');
  });
  read(() => set('vue.version', document.querySelector('[data-v-app]')?.__vue_app__?.version));
  read(() => set('vue2.version', w.Vue?.version));
  read(() => set('jquery.version', w.jQuery?.fn?.jquery));
  read(() => set('gsap.version', w.gsap?.version));
  read(() => set('alpine.version', w.Alpine?.version));
  read(() => set('htmx.version', w.htmx?.version));
  read(() => set('elementor.version', w.elementorFrontendConfig?.version));
  read(() => set('react.version', w.React?.version));
  read(() => set('reactrouter.version', w.__reactRouterVersion));
  read(() => {
    const theme = w.Shopify?.theme;
    if (!theme || typeof theme !== 'object') return;
    flag('shopify.theme');
    read(() => set('shopify.theme.name', theme.name));
    read(() => set('shopify.theme.schema_name', theme.schema_name));
    read(() => set('shopify.theme.schema_version', theme.schema_version));
  });
  // Svelte keeps its major version in a Set: asked with the built-in Set has(),
  // never by iterating it (no page code runs).
  read(() => {
    const v = w.__svelte?.v;
    if (!(v instanceof Set)) return;
    for (let major = 9; major >= 3; major--) {
      if (Set.prototype.has.call(v, String(major))) {
        set('svelte.version', String(major));
        break;
      }
    }
  });
  read(() => {
    for (const key of Object.keys(w)) {
      if (/^__sveltekit_/.test(key)) {
        flag('sveltekit');
        break;
      }
    }
  });
  for (const [key, name] of [
    ['remix', '__remixContext'],
    ['reactrouter', '__reactRouterContext'],
    ['gatsby', '___loader'],
    ['drupal', 'Drupal'],
    ['joomla', 'Joomla'],
    ['webflow', 'Webflow'],
    ['preact.global', 'preact'],
  ]) {
    read(() => {
      if (w[name] != null) flag(key);
    });
  }
  // React and Preact leave their marks on the DOM nodes they render into.
  read(() => {
    const nodes = [document, document.documentElement, document.body, ...Array.from(document.querySelectorAll('#root, #__next, #app, #___gatsby, [data-reactroot], astro-island, body > *')).slice(0, 80)];
    for (const n of nodes) {
      read(() => {
        if (!n) return;
        for (const key of Object.keys(n)) if (/^__react(?:Fiber|Container)\$|^_reactRootContainer$/.test(key)) flag('react');
      });
      read(() => {
        const vnode = n?.__k;
        if (vnode && typeof vnode === 'object' && 'props' in vnode && 'type' in vnode) flag('preact');
      });
    }
  });
  return out;
}
