import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolUrl, domainOf, exactPhrase, duplicateSearchUrl, siteSearchUrl, googleSearchUrl, isGoogleSerp } from '../../extension/lib/tools.js';
import { toCSV } from '../../extension/lib/csv.js';

const PAGE = 'https://www.example.com/blog/post?x=1';

test('every tool builds at least one https URL', () => {
  for (const t of TOOLS) {
    const urls = [toolUrl(t.id, 'page', PAGE), toolUrl(t.id, 'domain', PAGE)].filter(Boolean);
    assert.ok(urls.length > 0, t.id);
    for (const u of urls) assert.match(u, /^https:\/\//, t.id);
  }
});

test('page and domain targets', () => {
  assert.equal(domainOf(PAGE), 'example.com');
  assert.equal(
    toolUrl('ahrefs', 'page', PAGE),
    'https://app.ahrefs.com/site-explorer/overview/v2/exact/live?target=https%3A%2F%2Fwww.example.com%2Fblog%2Fpost%3Fx%3D1',
  );
  assert.equal(toolUrl('ahrefs', 'domain', PAGE), 'https://app.ahrefs.com/site-explorer/overview/v2/subdomains/live?target=example.com');
  assert.equal(toolUrl('similarweb', 'domain', PAGE), 'https://www.similarweb.com/website/example.com/');
  assert.equal(toolUrl('similarweb', 'page', PAGE), null);
  assert.equal(toolUrl('ahrefs', 'page', 'chrome://settings'), null);
});

test('exact phrase searches strip quotes and cap words', () => {
  assert.equal(exactPhrase('  He said “hello”  "world" '), 'He said hello world');
  assert.equal(exactPhrase(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')).split(' ').length, 32);
  assert.equal(duplicateSearchUrl('a "b" c', 'www.google.ca'), 'https://www.google.ca/search?q=%22a%20b%20c%22');
  assert.equal(duplicateSearchUrl('   '), null);
  assert.equal(siteSearchUrl(PAGE), 'https://www.google.com/search?q=site%3Aexample.com');
  // unknown hosts fall back to google.com instead of opening arbitrary domains
  assert.equal(googleSearchUrl('x', 'evil.com'), 'https://www.google.com/search?q=x');
});

test('google SERP detection', () => {
  assert.ok(isGoogleSerp('https://www.google.com/search?q=x'));
  assert.ok(isGoogleSerp('https://www.google.co.uk/search?q=x'));
  assert.ok(!isGoogleSerp('https://www.google.com/maps'));
  assert.ok(!isGoogleSerp('https://google.evil.com/search'));
});

test('CSV escaping, BOM and formula guarding', () => {
  const csv = toCSV(
    [
      { a: 'plain', b: 'has, comma' },
      { a: '=HYPERLINK("x")', b: 'line\nbreak' },
      { a: null, b: 'quote "q"' },
    ],
    [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
  );
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'A,B');
  assert.equal(lines[1], 'plain,"has, comma"');
  assert.equal(lines[2], `"'=HYPERLINK(""x"")","line\nbreak"`);
  assert.equal(lines[3], ',"quote ""q"""');
});
