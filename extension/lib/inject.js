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
