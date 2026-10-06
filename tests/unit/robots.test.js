import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, checkUrl, matchesRule } from '../../extension/lib/robots.js';

const TXT = `
# comment
User-agent: *
Disallow: /private
Allow: /private/ok
Disallow: /*.pdf$
Crawl-delay: 5

User-agent: Googlebot
User-agent: Googlebot-News
Disallow: /no-google
Allow: /no-google/but-this

Sitemap: https://example.com/sitemap.xml
sitemap: https://example.com/news.xml
`;

test('collects sitemaps and groups', () => {
  const r = parseRobots(TXT);
  assert.deepEqual(r.sitemaps, ['https://example.com/sitemap.xml', 'https://example.com/news.xml']);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[1].agents, ['googlebot', 'googlebot-news']);
});

test('specific group replaces the * group', () => {
  const r = parseRobots(TXT);
  // Googlebot has its own group, so the * rules do not apply to it.
  assert.equal(checkUrl(r, 'https://example.com/private/x').allowed, true);
  assert.equal(checkUrl(r, 'https://example.com/no-google/x').allowed, false);
  assert.equal(checkUrl(r, 'https://example.com/no-google/x', 'bingbot').allowed, true);
  assert.equal(checkUrl(r, 'https://example.com/private/x', 'bingbot').allowed, false);
});

test('longest rule wins, allow wins ties', () => {
  const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /same\nAllow: /same');
  assert.equal(checkUrl(r, 'https://x.com/a/b/c', 'any').allowed, true);
  assert.equal(checkUrl(r, 'https://x.com/a/c', 'any').allowed, false);
  assert.equal(checkUrl(r, 'https://x.com/same', 'any').allowed, true);
});

test('wildcards and end anchors', () => {
  assert.ok(matchesRule('/*.pdf$', '/files/report.pdf'));
  assert.ok(!matchesRule('/*.pdf$', '/files/report.pdf?x=1'));
  assert.ok(matchesRule('/*?', '/page?x=1'));
  assert.ok(matchesRule('/fish*', '/fish.html'));
  assert.ok(!matchesRule('/fish', '/Fish.html'));
});

test('query strings are part of the matched path', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*?sort=');
  assert.equal(checkUrl(r, 'https://x.com/list?sort=asc', 'googlebot').allowed, false);
  assert.equal(checkUrl(r, 'https://x.com/list', 'googlebot').allowed, true);
});

test('empty disallow allows everything; robots.txt itself is always allowed', () => {
  const r = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(checkUrl(r, 'https://x.com/anything').allowed, true);
  const all = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(checkUrl(all, 'https://x.com/page').allowed, false);
  assert.equal(checkUrl(all, 'https://x.com/robots.txt').allowed, true);
});

test('reports the matching rule and group', () => {
  const r = parseRobots(TXT);
  const res = checkUrl(r, 'https://example.com/no-google/x');
  assert.equal(res.rule.line, 'Disallow: /no-google');
  assert.equal(res.group, 'googlebot');
});

test('non-ascii rule paths match percent-encoded URLs', () => {
  const r = parseRobots('User-agent: *\nDisallow: /café');
  assert.equal(checkUrl(r, 'https://x.com/café/menu').allowed, false);
});
