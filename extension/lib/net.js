import { parseRobots, checkUrl } from './robots.js';
import { parseLinkHeader, stripHash } from './analysis.js';

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
