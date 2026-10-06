import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lengthStatus,
  canonicalStatus,
  parseRobotsDirectives,
  directivesFor,
  indexability,
  headingIssues,
  classifyLink,
  linkStats,
  imageFlags,
  hreflangIssues,
  validHreflang,
  parseLinkHeader,
  schemaTypes,
  parseJsonLdBlocks,
  missingSocial,
  microdataTypeName,
} from '../../extension/lib/analysis.js';

test('length status', () => {
  assert.equal(lengthStatus(null, [30, 60]), 'missing');
  assert.equal(lengthStatus('short', [30, 60]), 'short');
  assert.equal(lengthStatus('x'.repeat(45), [30, 60]), 'good');
  assert.equal(lengthStatus('x'.repeat(61), [30, 60]), 'long');
  // counts characters, not UTF-16 units
  assert.equal(lengthStatus('é'.repeat(30), [30, 60]), 'good');
});

test('canonical status', () => {
  const page = 'https://a.com/p#frag';
  assert.equal(canonicalStatus([], page).kind, 'missing');
  assert.equal(canonicalStatus([{ href: 'https://a.com/p' }], page).kind, 'self');
  assert.equal(canonicalStatus([{ href: 'https://a.com/other' }], page).kind, 'other');
  assert.equal(canonicalStatus([{ href: 'https://a.com/p' }, { href: 'https://a.com/q' }], page).kind, 'conflict');
  assert.equal(canonicalStatus([{ href: 'https://a.com/p' }, { href: 'https://a.com/p' }], page).kind, 'self');
});

test('X-Robots-Tag parsing with agent scopes and value directives', () => {
  const v = 'noarchive, googlebot: noindex, nofollow, otherbot: none, unavailable_after: 25 Jun 2010 15:00:00 PST';
  const scopes = parseRobotsDirectives(v);
  assert.deepEqual(scopes[0], { agent: null, directives: ['noarchive'] });
  assert.deepEqual(scopes[1].agent, 'googlebot');
  assert.deepEqual(scopes[1].directives, ['noindex', 'nofollow']);
  assert.equal(scopes[2].agent, 'otherbot');
  assert.ok(scopes[2].directives.some((d) => d.startsWith('unavailable_after')));
  assert.deepEqual(directivesFor(v, 'googlebot'), ['noarchive', 'noindex', 'nofollow']);
  assert.deepEqual(directivesFor('otherbot: noindex', 'googlebot'), []);
  assert.deepEqual(directivesFor('max-snippet: 50, noindex'), ['max-snippet: 50', 'noindex']);
});

test('indexability combines every signal', () => {
  const head = { robots: 'index, follow', googlebot: null, canonicals: [{ href: 'https://a.com/' }], metaRefresh: null };
  const base = { head, pageUrl: 'https://a.com/', http: { status: 200, xRobotsTag: null }, robotsTxt: { check: { allowed: true } } };
  assert.deepEqual(indexability(base), { indexable: true, reasons: [], unknown: [] });
  assert.ok(indexability({ ...base, head: { ...head, robots: 'noindex' } }).reasons.includes('noindex in meta robots'));
  assert.ok(indexability({ ...base, http: { status: 200, xRobotsTag: 'googlebot: noindex' } }).reasons.includes('noindex in X-Robots-Tag header'));
  assert.equal(indexability({ ...base, http: { status: 200, xRobotsTag: 'bingbot: noindex' } }).indexable, true);
  assert.ok(indexability({ ...base, http: { status: 404 } }).reasons.includes('HTTP status 404'));
  assert.ok(indexability({ ...base, robotsTxt: { check: { allowed: false } } }).reasons.includes('blocked by robots.txt'));
  assert.ok(indexability({ ...base, head: { ...head, canonicals: [{ href: 'https://a.com/x' }] } }).reasons.includes('canonical points to another URL'));
  const unknown = indexability({ ...base, http: null, robotsTxt: null });
  assert.deepEqual(unknown.unknown, ['HTTP headers', 'robots.txt']);
  assert.equal(unknown.indexable, true);
});

test('heading issues', () => {
  const hs = [
    { index: 0, level: 2, text: 'A' },
    { index: 1, level: 4, text: '' },
  ];
  const texts = headingIssues(hs).map((i) => i.text);
  assert.ok(texts.includes('No H1 on the page'));
  assert.ok(texts.includes('Skips from H2 to H4'));
  assert.ok(texts.includes('1 empty heading'));
  assert.equal(headingIssues([{ level: 1, text: 'x' }, { level: 1, text: 'y' }])[0].text, '2 H1 tags');
});

test('link classification', () => {
  const page = 'https://www.site.com/a';
  const c = (raw, rel = '') => classifyLink({ raw, href: new URL(raw, page).href, rel }, page);
  assert.equal(c('/b').kind, 'internal');
  assert.equal(c('https://site.com/x').kind, 'internal'); // www-insensitive
  assert.equal(c('https://blog.site.com/x').kind, 'external');
  assert.equal(c('https://other.com', 'nofollow noopener').nofollow, true);
  assert.equal(c('https://other.com', 'sponsored').qualified, true);
  assert.equal(c('#top').kind, 'fragment');
  assert.equal(c('mailto:a@b.c').kind, 'mailto');
  assert.equal(c('tel:+1').kind, 'tel');
  assert.equal(c('javascript:void(0)').kind, 'javascript');
  const stats = linkStats(
    [
      { raw: '/b', href: 'https://www.site.com/b', text: 'B', rel: '' },
      { raw: '/b', href: 'https://www.site.com/b', text: '', rel: '' },
      { raw: 'https://x.com', href: 'https://x.com/', text: 'X', rel: 'ugc' },
      { raw: '#', href: 'https://www.site.com/a#', text: '', rel: '' },
    ],
    page,
  );
  assert.deepEqual(stats, { total: 4, unique: 3, internal: 2, external: 1, nofollow: 1, other: 1, noText: 1 });
});

test('image flags', () => {
  assert.equal(imageFlags({ alt: null }).missingAlt, true);
  assert.equal(imageFlags({ alt: '  ' }).emptyAlt, true);
  assert.equal(imageFlags({ alt: 'x', width: 2400, shownWidth: 600 }).oversized, true);
  assert.equal(imageFlags({ alt: 'x', width: 300, shownWidth: 100 }).oversized, false);
});

test('hreflang validation', () => {
  assert.ok(validHreflang('en'));
  assert.ok(validHreflang('fr-CA'));
  assert.ok(validHreflang('zh-Hant-TW'));
  assert.ok(validHreflang('es-419'));
  assert.ok(validHreflang('x-default'));
  assert.ok(!validHreflang('en_US'));
  assert.ok(!validHreflang('english'));
  const issues = hreflangIssues(
    [
      { lang: 'en', href: 'https://a.com/', raw: 'https://a.com/' },
      { lang: 'en', href: 'https://a.com/en', raw: '/en' },
      { lang: 'en_GB', href: 'https://a.com/gb', raw: 'https://a.com/gb' },
    ],
    'https://a.com/',
  ).map((i) => i.text);
  assert.ok(issues.includes('No x-default'));
  assert.ok(issues.includes('Invalid code "en_GB"'));
  assert.ok(issues.includes('Relative URL for en'));
  assert.ok(issues.includes('"en" listed 2 times'));
  assert.ok(!issues.includes('No self-referencing hreflang'));
});

test('Link header parsing', () => {
  const v = '<https://a.com/fr>; rel="alternate"; hreflang="fr", <https://a.com/>; rel="canonical"';
  assert.deepEqual(parseLinkHeader(v), [
    { url: 'https://a.com/fr', rel: 'alternate', hreflang: 'fr' },
    { url: 'https://a.com/', rel: 'canonical', hreflang: null },
  ]);
  assert.deepEqual(parseLinkHeader(null), []);
});

test('schema types include @graph and nested nodes', () => {
  const data = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, { '@type': ['Organization', 'LocalBusiness'], address: { '@type': 'PostalAddress' } }] };
  assert.deepEqual(schemaTypes(data).sort(), ['LocalBusiness', 'Organization', 'PostalAddress', 'WebSite']);
  const blocks = parseJsonLdBlocks(['{"@type":"Article"}', '{bad json']);
  assert.equal(blocks[0].ok, true);
  assert.equal(blocks[1].ok, false);
  assert.ok(blocks[1].error.length > 0);
  assert.equal(microdataTypeName('https://schema.org/Product'), 'Product');
});

test('missing social tags', () => {
  assert.deepEqual(missingSocial([{ key: 'og:title', value: 'x' }], []), ['og:description', 'og:image', 'og:url', 'og:type', 'twitter:card']);
});
