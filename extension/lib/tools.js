// Third-party SEO tools the current page or domain can be opened in.
// `page` builds a URL for one exact page, `domain` for the whole site.

const enc = encodeURIComponent;

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Bare domain without a leading "www." (what most tools expect for site-wide reports).
export function domainOf(url) {
  return hostOf(url).replace(/^www\./i, '');
}

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export const TOOLS = [
  {
    id: 'ahrefs',
    name: 'Ahrefs',
    page: (u) => `https://app.ahrefs.com/site-explorer/overview/v2/exact/live?target=${enc(u)}`,
    domain: (d) => `https://app.ahrefs.com/site-explorer/overview/v2/subdomains/live?target=${enc(d)}`,
  },
  {
    id: 'semrush',
    name: 'Semrush',
    page: (u) => `https://www.semrush.com/analytics/overview/?q=${enc(u)}&searchType=url`,
    domain: (d) => `https://www.semrush.com/analytics/overview/?q=${enc(d)}&searchType=domain`,
  },
  {
    id: 'moz',
    name: 'Moz',
    page: (u) => `https://analytics.moz.com/pro/link-explorer/overview?site=${enc(u)}&target=page`,
    domain: (d) => `https://analytics.moz.com/pro/link-explorer/overview?site=${enc(d)}&target=domain`,
  },
  {
    id: 'majestic',
    name: 'Majestic',
    page: (u) => `https://majestic.com/reports/site-explorer?q=${enc(u)}&IndexDataSource=F`,
    domain: (d) => `https://majestic.com/reports/site-explorer?q=${enc(d)}&IndexDataSource=F`,
  },
  {
    id: 'similarweb',
    name: 'Similarweb',
    domain: (d) => `https://www.similarweb.com/website/${d}/`,
  },
  {
    id: 'wayback',
    name: 'Wayback Machine',
    short: 'Wayback',
    page: (u) => `https://web.archive.org/web/*/${u}`,
    domain: (d) => `https://web.archive.org/web/*/${d}*`,
  },
  {
    id: 'pagespeed',
    name: 'PageSpeed Insights',
    short: 'PageSpeed',
    page: (u) => `https://pagespeed.web.dev/analysis?url=${enc(u)}`,
  },
  {
    id: 'richresults',
    name: 'Rich Results Test',
    short: 'Rich Results',
    page: (u) => `https://search.google.com/test/rich-results?url=${enc(u)}`,
  },
  {
    id: 'schemaorg',
    name: 'Schema.org Validator',
    short: 'Schema.org',
    page: (u) => `https://validator.schema.org/#url=${enc(u)}`,
  },
  {
    id: 'builtwith',
    name: 'BuiltWith',
    domain: (d) => `https://builtwith.com/${d}`,
  },
];

export function toolById(id) {
  return TOOLS.find((t) => t.id === id) ?? null;
}

// mode: 'page' | 'domain'
export function toolUrl(id, mode, url) {
  const tool = toolById(id);
  if (!tool || !/^https?:/i.test(url ?? '')) return null;
  if (mode === 'domain' && tool.domain) return tool.domain(domainOf(url));
  if (mode === 'page' && tool.page) return tool.page(url);
  return null;
}

export const GOOGLE_DOMAINS = [
  'www.google.com',
  'www.google.ca',
  'www.google.co.uk',
  'www.google.fr',
  'www.google.com.au',
  'www.google.de',
  'www.google.es',
];

export function googleSearchUrl(query, host = 'www.google.com') {
  const safeHost = GOOGLE_DOMAINS.includes(host) ? host : 'www.google.com';
  return `https://${safeHost}/search?q=${enc(query)}`;
}

export function bingSearchUrl(query) {
  return `https://www.bing.com/search?q=${enc(query)}`;
}

export function siteSearchUrl(url, host) {
  return googleSearchUrl(`site:${domainOf(url)}`, host);
}

// Google ignores words past ~32, and nested quotes break exact match.
export function exactPhrase(text, maxWords = 32) {
  const words = String(text ?? '')
    .replace(/["“”„«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

export function duplicateSearchUrl(text, host) {
  const phrase = exactPhrase(text);
  if (!phrase) return null;
  return googleSearchUrl(`"${phrase}"`, host);
}

export function isGoogleSerp(url) {
  try {
    const u = new URL(url);
    return /(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(u.hostname) && u.pathname === '/search';
  } catch {
    return false;
  }
}
