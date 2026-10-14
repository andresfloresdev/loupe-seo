import { parseRobots, checkUrl } from './robots.js';
import { parseLinkHeader, stripHash } from './analysis.js';
import { wpVersionFromFeed, FORBIDDEN_PATH, MAX_PROBES, MAX_THEME_PROBES } from './tech.js';

// Network checks run from the extension (host permission lets it read headers
// and cross-origin responses). Every function resolves with an { error } object
// instead of throwing, so the UI can say "couldn't check" instead of failing.

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone',
  429: 'Too Many Requests', 451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

export function statusText(code) {
  return STATUS_TEXT[code] ?? '';
}

async function timedFetch(url, init = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'follow', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const errorText = (e) => (e?.name === 'AbortError' ? 'Timed out' : String(e?.message || e));

export async function fetchPageHeaders(url) {
  try {
    const res = await timedFetch(url, { credentials: 'include' });
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    try {
      await res.body?.cancel();
    } catch {}
    return {
      status: res.status,
      statusText: res.statusText || statusText(res.status),
      redirected: res.redirected,
      finalUrl: res.url || url,
      headers,
      xRobotsTag: res.headers.get('x-robots-tag'),
      contentType: res.headers.get('content-type'),
      linkHeader: parseLinkHeader(res.headers.get('link')),
    };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function fetchRobotsTxt(pageUrl) {
  let url;
  try {
    url = new URL('/robots.txt', pageUrl).href;
  } catch {
    return { error: 'Invalid URL' };
  }
  try {
    const res = await timedFetch(url, { credentials: 'omit' });
    const status = res.status;
    if (status >= 500) {
      try {
        await res.body?.cancel();
      } catch {}
      // Google treats a server error on robots.txt as "disallow everything" for a while.
      return { url, status, exists: false, serverError: true, sitemaps: [], check: { allowed: false, rule: null } };
    }
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {}
      return { url, status, exists: false, sitemaps: [], check: { allowed: true, rule: null } };
    }
    const text = (await res.text()).slice(0, 512 * 1024);
    const robots = parseRobots(text);
    return { url, status, exists: true, sitemaps: robots.sitemaps, check: checkUrl(robots, pageUrl, 'googlebot') };
  } catch (e) {
    return { url, error: errorText(e) };
  }
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Fetch one hreflang alternate: status, redirect, and whether it links back.
export async function checkAlternate(entry, pageUrl) {
  try {
    const res = await timedFetch(entry.href, { credentials: 'omit' });
    const out = { status: res.status, statusText: statusText(res.status), redirected: res.redirected, finalUrl: res.url };
    const type = res.headers.get('content-type') || '';
    const headerAlternates = parseLinkHeader(res.headers.get('link')).filter((l) => l.hreflang);
    if (res.ok && /html/i.test(type) && typeof DOMParser !== 'undefined') {
      const html = (await res.text()).slice(0, 3 * 1024 * 1024);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const resolve = (h) => {
        try {
          return new URL(h, res.url).href;
        } catch {
          return h;
        }
      };
      const targets = [
        ...Array.from(doc.querySelectorAll('link[rel~="alternate" i][hreflang]')).map((l) => resolve(l.getAttribute('href'))),
        ...headerAlternates.map((l) => resolve(l.url)),
      ];
      out.returnLink = targets.some((t) => stripHash(t) === stripHash(pageUrl));
      const canonical = doc.querySelector('link[rel~="canonical" i]');
      out.canonical = canonical ? resolve(canonical.getAttribute('href')) : null;
    } else {
      try {
        await res.body?.cancel();
      } catch {}
      if (headerAlternates.length) {
        out.returnLink = headerAlternates.some((l) => stripHash(new URL(l.url, res.url).href) === stripHash(pageUrl));
      }
    }
    return out;
  } catch (e) {
    return { error: errorText(e) };
  }
}

// Fetch a GTM container the page itself loads (the exact gtm.js URL), to read
// the tags it configures. Only gtm.js?id=GTM-… URLs, without cookies, 4 MB at most.
export async function fetchGtmContainer(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'Invalid URL' };
  }
  if (!/^https?:$/.test(parsed.protocol) || !/\/gtm\.js$/.test(parsed.pathname) || !/^GTM-[A-Z0-9]+$/.test(parsed.searchParams.get('id') ?? '')) {
    return { error: 'Not a GTM container URL' };
  }
  try {
    const res = await timedFetch(parsed.href, { credentials: 'omit' });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {}
      return { error: `HTTP ${res.status}` };
    }
    return { text: (await res.text()).slice(0, 4 * 1024 * 1024) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

// Read a response body up to `max` bytes, then stop the download.
export async function readCapped(res, max) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return { text: text.slice(0, max), capped: text.length > max };
  }
  const chunks = [];
  let size = 0;
  let capped = false;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= max) capped = true;
  try {
    await reader.cancel();
  } catch {}
  const bytes = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, bytes.length - at);
    bytes.set(part, at);
    at += part.length;
    if (at >= bytes.length) break;
  }
  return { text: new TextDecoder().decode(bytes), capped };
}

// GET a URL without cookies and read at most `max` bytes. Never throws.
// Redirects are not followed, so a probe never lands on a URL it did not check
// (a REST index that redirects to wp-login.php, say).
export async function fetchCapped(url, max, timeout = 12000) {
  try {
    const res = await timedFetch(url, { credentials: 'omit', redirect: 'manual' }, timeout);
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      try {
        await res.body?.cancel();
      } catch {}
      return { url, status: res.status || null, error: 'Redirected, not followed' };
    }
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {}
      return { url, status: res.status, error: `HTTP ${res.status}` };
    }
    return { url, status: res.status, ...(await readCapped(res, max)) };
  } catch (e) {
    return { url, error: errorText(e) };
  }
}

// The light WordPress probes (lib/tech.js probeTargets picks the URLs from the
// page's own links): the feed, the REST namespaces and each theme's style.css,
// then wp-links-opml.php only when the core version is still unknown. Same
// origin as the page only, without cookies, 1 MB each, five in all. Never
// readme.txt, readme.html, wp-login.php or anything under wp-admin.
export const PROBE_BYTES = 1024 * 1024;
export async function fetchWordPressProbes(pageUrl, targets, { coreKnown = false } = {}) {
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return { error: 'Invalid URL' };
  }
  const allowed = (url, shape) => {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) && u.origin === origin && !FORBIDDEN_PATH.test(u.pathname) && shape(u) ? u.href : null;
    } catch {
      return null;
    }
  };
  const feed = targets?.feed ? allowed(targets.feed, () => true) : null;
  const rest = targets?.rest ? allowed(targets.rest, (u) => u.searchParams.get('_fields') === 'namespaces' && (/\/wp-json\//.test(u.pathname) || u.searchParams.has('rest_route'))) : null;
  const opml = targets?.opml ? allowed(targets.opml, (u) => /\/wp-links-opml\.php$/.test(u.pathname)) : null;
  const themes = (targets?.themes ?? [])
    .map((t) => ({ slug: String(t?.slug ?? '').slice(0, 80), url: allowed(t?.url, (u) => /\/themes\/[^/]+\/style\.css$/.test(u.pathname)) }))
    .filter((t) => t.slug && t.url)
    .slice(0, MAX_THEME_PROBES);

  let budget = MAX_PROBES;
  const get = (url) => {
    if (!url || budget <= 0) return null;
    budget--;
    return fetchCapped(url, PROBE_BYTES);
  };
  const out = { count: 0 };
  const [f, r, ...t] = await Promise.all([get(feed), get(rest), ...themes.map((x) => get(x.url))]);
  if (f) out.feed = f;
  if (r) out.rest = r;
  out.themes = themes.map((x, i) => (t[i] ? { slug: x.slug, ...t[i] } : null)).filter(Boolean);
  if (!coreKnown && !wpVersionFromFeed(f?.text)) {
    const o = await get(opml);
    if (o) out.opml = o;
  }
  out.count = MAX_PROBES - budget;
  return out;
}
