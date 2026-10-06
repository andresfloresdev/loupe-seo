// Pure analysis over the data collected from the page. No browser APIs here,
// so all of it is unit tested in Node.

export const LIMITS = {
  title: [30, 60],
  description: [70, 160],
};

export function lengthStatus(text, [min, max]) {
  if (text == null || text === '') return 'missing';
  const n = [...text].length;
  if (n < min) return 'short';
  if (n > max) return 'long';
  return 'good';
}

export function stripHash(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url ?? '';
  }
}

export function canonicalStatus(canonicals, pageUrl) {
  if (!canonicals?.length) return { kind: 'missing' };
  if (canonicals.length > 1) {
    const distinct = new Set(canonicals.map((c) => stripHash(c.href)));
    if (distinct.size > 1) return { kind: 'conflict', href: canonicals[0].href, count: canonicals.length };
  }
  const href = canonicals[0].href;
  if (!href) return { kind: 'empty' };
  return { kind: stripHash(href) === stripHash(pageUrl) ? 'self' : 'other', href, count: canonicals.length };
}

// Directives that legitimately contain a colon, so they are not a user-agent prefix.
const VALUE_DIRECTIVES = new Set(['unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview']);

// Robots directives from a meta tag or an X-Robots-Tag header. Header values can
// be scoped to a crawler ("googlebot: noindex") and several headers arrive joined.
export function parseRobotsDirectives(value) {
  const scopes = [];
  let current = { agent: null, directives: [] };
  scopes.push(current);
  for (const part of String(value ?? '').split(',')) {
    let token = part.trim();
    if (!token) continue;
    const m = token.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && !VALUE_DIRECTIVES.has(m[1].toLowerCase())) {
      current = { agent: m[1].toLowerCase(), directives: [] };
      scopes.push(current);
      token = m[2].trim();
      if (!token) continue;
    }
    current.directives.push(token.toLowerCase());
  }
  return scopes.filter((s) => s.directives.length || s.agent);
}

export function directivesFor(value, agent = 'googlebot') {
  return parseRobotsDirectives(value)
    .filter((s) => s.agent === null || s.agent === agent)
    .flatMap((s) => s.directives);
}

export function hasNoindex(directives) {
  return directives.some((d) => d === 'noindex' || d === 'none');
}

export function hasNofollow(directives) {
  return directives.some((d) => d === 'nofollow' || d === 'none');
}

// Combine every signal into one verdict. `http` and `robotsTxt` may be null
// when they could not be fetched; unknown signals are reported, not guessed.
export function indexability({ head, pageUrl, http, robotsTxt }) {
  const reasons = [];
  const unknown = [];
  const meta = [...directivesFor(head.robots), ...directivesFor(head.googlebot)];
  if (hasNoindex(meta)) reasons.push('noindex in meta robots');

  if (http) {
    if (http.status && (http.status < 200 || http.status >= 300)) reasons.push(`HTTP status ${http.status}`);
    if (http.xRobotsTag && hasNoindex(directivesFor(http.xRobotsTag))) reasons.push('noindex in X-Robots-Tag header');
  } else {
    unknown.push('HTTP headers');
  }

  if (robotsTxt) {
    if (robotsTxt.check && !robotsTxt.check.allowed) reasons.push('blocked by robots.txt');
  } else {
    unknown.push('robots.txt');
  }

  const canonical = canonicalStatus(head.canonicals, http?.finalUrl || pageUrl);
  if (canonical.kind === 'other') reasons.push('canonical points to another URL');
  if (canonical.kind === 'conflict') reasons.push('conflicting canonical tags');
  if (head.metaRefresh) reasons.push('meta refresh redirect');

  return { indexable: reasons.length === 0, reasons, unknown };
}

export function headingIssues(headings) {
  const issues = [];
  const h1 = headings.filter((h) => h.level === 1);
  if (!h1.length) issues.push({ level: 'error', text: 'No H1 on the page' });
  else if (h1.length > 1) issues.push({ level: 'warn', text: `${h1.length} H1 tags` });
  let prev = 0;
  for (const h of headings) {
    if (prev && h.level > prev + 1) {
      issues.push({ level: 'warn', text: `Skips from H${prev} to H${h.level}`, index: h.index });
    }
    prev = h.level;
  }
  const empty = headings.filter((h) => !h.text).length;
  if (empty) issues.push({ level: 'warn', text: `${empty} empty heading${empty > 1 ? 's' : ''}` });
  return issues;
}

export function headingCounts(headings) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const h of headings) counts[h.level]++;
  return counts;
}

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');

export function classifyLink(link, pageUrl) {
  const raw = (link.raw ?? '').trim();
  const relTokens = new Set((link.rel ?? '').split(/\s+/).filter(Boolean));
  const flags = {
    nofollow: relTokens.has('nofollow'),
    ugc: relTokens.has('ugc'),
    sponsored: relTokens.has('sponsored'),
  };
  let kind;
  if (/^javascript:/i.test(raw)) kind = 'javascript';
  else if (/^mailto:/i.test(raw)) kind = 'mailto';
  else if (/^tel:/i.test(raw)) kind = 'tel';
  else if (raw.startsWith('#')) kind = 'fragment';
  else {
    try {
      const u = new URL(link.href);
      if (!/^https?:$/.test(u.protocol)) kind = 'other';
      else kind = bareHost(u.hostname) === bareHost(new URL(pageUrl).hostname) ? 'internal' : 'external';
    } catch {
      kind = 'other';
    }
  }
  return { kind, ...flags, qualified: flags.nofollow || flags.ugc || flags.sponsored };
}

export function linkStats(links, pageUrl) {
  const stats = { total: links.length, unique: 0, internal: 0, external: 0, nofollow: 0, other: 0, noText: 0 };
  const unique = new Set();
  for (const link of links) {
    const c = classifyLink(link, pageUrl);
    unique.add(link.href);
    if (c.kind === 'internal') stats.internal++;
    else if (c.kind === 'external') stats.external++;
    else stats.other++;
    if (c.qualified) stats.nofollow++;
    if (!link.text && (c.kind === 'internal' || c.kind === 'external')) stats.noText++;
  }
  stats.unique = unique.size;
  return stats;
}

export function imageFlags(img) {
  return {
    missingAlt: img.alt === null || img.alt === undefined,
    emptyAlt: img.alt !== null && img.alt !== undefined && img.alt.trim() === '',
    missingTitle: !img.title,
    lazy: img.loading === 'lazy',
    // Served at more than twice the size it is displayed at (and big enough to matter).
    oversized: img.shownWidth > 0 && img.width > 2 * img.shownWidth && img.width - img.shownWidth > 300,
  };
}

export function imageStats(images) {
  const stats = { total: images.length, missingAlt: 0, emptyAlt: 0, missingTitle: 0, lazy: 0, oversized: 0 };
  for (const img of images) {
    const f = imageFlags(img);
    for (const key of ['missingAlt', 'emptyAlt', 'missingTitle', 'lazy', 'oversized']) if (f[key]) stats[key]++;
  }
  return stats;
}

const HREFLANG = /^([a-z]{2,3})(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;

export function validHreflang(code) {
  return code.toLowerCase() === 'x-default' || HREFLANG.test(code);
}

export function hreflangIssues(entries, pageUrl) {
  const issues = [];
  if (!entries.length) return issues;
  if (!entries.some((e) => e.lang.toLowerCase() === 'x-default')) issues.push({ level: 'warn', text: 'No x-default' });
  if (!entries.some((e) => stripHash(e.href) === stripHash(pageUrl))) {
    issues.push({ level: 'warn', text: 'No self-referencing hreflang' });
  }
  const seen = new Map();
  for (const e of entries) {
    const key = e.lang.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!validHreflang(e.lang)) issues.push({ level: 'error', text: `Invalid code "${e.lang}"` });
    if (e.raw && !/^https?:\/\//i.test(e.raw.trim())) issues.push({ level: 'warn', text: `Relative URL for ${e.lang}` });
  }
  for (const [lang, n] of seen) if (n > 1) issues.push({ level: 'error', text: `"${lang}" listed ${n} times` });
  return issues;
}

// Parse Link response headers: <url>; rel="alternate"; hreflang="fr"
export function parseLinkHeader(value) {
  const out = [];
  if (!value) return out;
  for (const part of value.split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]*)>(.*)/);
    if (!m) continue;
    const params = {};
    for (const p of m[2].split(';')) {
      const kv = p.match(/^\s*([a-z-]+)\s*=\s*"?([^"]*)"?\s*$/i);
      if (kv) params[kv[1].toLowerCase()] = kv[2];
    }
    out.push({ url: m[1], rel: (params.rel ?? '').toLowerCase(), hreflang: params.hreflang ?? null });
  }
  return out;
}

// Collect every @type in a JSON-LD document, including @graph members and nested nodes.
export function schemaTypes(data) {
  const types = new Set();
  const visit = (node, depth) => {
    if (depth > 12 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const t = node['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    for (const [k, v] of Object.entries(node)) if (k !== '@context') visit(v, depth + 1);
  };
  visit(data, 0);
  return [...types];
}

export function parseJsonLdBlocks(texts) {
  return texts.map((text, index) => {
    try {
      const data = JSON.parse(text);
      return { index, ok: true, data, types: schemaTypes(data) };
    } catch (error) {
      return { index, ok: false, error: String(error.message || error), text: text.slice(0, 2000) };
    }
  });
}

export function microdataTypeName(type) {
  if (!type) return 'Untyped item';
  return type
    .split(/\s+/)
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, ''))
    .join(', ');
}

export const OG_RECOMMENDED = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];

export function missingSocial(og, twitter) {
  const have = new Set(og.map((o) => o.key.toLowerCase()));
  const missing = OG_RECOMMENDED.filter((k) => !have.has(k));
  if (!twitter.some((t) => t.key === 'twitter:card')) missing.push('twitter:card');
  return missing;
}

export function firstValue(pairs, key) {
  const hit = pairs.find((p) => p.key.toLowerCase() === key);
  return hit ? hit.value : null;
}
