// Latest versions (lib/latest.js): the three APIs, only a slug or a package
// name sent, the 12-hour cache and three lookups at a time. Real answers
// trimmed: the version-check offers (fixtures/wp-version-check-2026-10-13.json),
// the plugin and npm fields the recon fetched on 2026-10-13. Imported with a
// fallback so that, on a checkout without the module, every test fails on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.chrome ??= { runtime: { id: 'loupetestid', getURL: (p) => `chrome-extension://loupetestid/${p}` } };
const L = await import('../../extension/lib/latest.js').catch(() => ({}));
const T = await import('../../extension/lib/tech.js').catch(() => ({}));
const { latestUrl, readAnswer, fetchLatest, LATEST_TTL } = L;
const { latestTargets, withLatest, updateLabel, MAX_PLUGIN_LOOKUPS } = T;

const OFFERS_TEXT = readFileSync(new URL('./fixtures/wp-version-check-2026-10-13.json', import.meta.url), 'utf8');

function fakeStorage() {
  const store = {};
  return {
    store,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
    set: async (o) => Object.assign(store, o),
  };
}

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const seen = [];
  let active = 0;
  let peak = 0;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), opts });
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return handler(String(url));
    } finally {
      active--;
    }
  };
  try {
    await fn(seen, () => peak);
  } finally {
    globalThis.fetch = real;
  }
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('latestUrl: the three APIs, with only a slug or a package name', () => {
  assert.equal(latestUrl({ kind: 'wp-core' }), 'https://api.wordpress.org/core/version-check/1.7/');
  const plugin = latestUrl({ kind: 'wp-plugin', name: 'contact-form-7' });
  assert.match(plugin, /^https:\/\/api\.wordpress\.org\/plugins\/info\/1\.2\/\?action=plugin_information&request\[slug\]=contact-form-7&/);
  assert.match(plugin, /request\[fields\]\[sections\]=0/, 'the big fields are off');
  assert.match(latestUrl({ kind: 'wp-theme', name: 'hello-elementor' }), /^https:\/\/api\.wordpress\.org\/themes\/info\/1\.2\/\?action=theme_information&request\[slug\]=hello-elementor&/);
  assert.equal(latestUrl({ kind: 'npm', name: '@angular/core' }), 'https://registry.npmjs.org/@angular/core/latest');
  assert.equal(latestUrl({ kind: 'npm', name: 'next' }), 'https://registry.npmjs.org/next/latest');
  for (const bad of [
    { kind: 'wp-plugin', name: 'https://client.example/' },
    { kind: 'wp-plugin', name: 'Zephyr' },
    { kind: 'wp-plugin', name: '../x' },
    { kind: 'npm', name: 'next/../../x' },
    { kind: 'npm', name: 'https://client.example' },
    { kind: 'wp-theme', name: 'a&b=c' },
    { kind: 'other', name: 'next' },
  ]) {
    assert.equal(latestUrl(bad), null, JSON.stringify(bad));
  }
});

test('readAnswer: offers for core, a version for the rest, unlisted for a 404 or a wordpress.org error', () => {
  assert.deepEqual(readAnswer({ kind: 'wp-core' }, { text: OFFERS_TEXT }).offers.slice(0, 4), ['7.1.3', '7.0.7', '6.9.10', '6.8.11'], 'deduplicated, in order');
  assert.deepEqual(readAnswer({ kind: 'wp-plugin' }, { text: '{"name":"Contact Form 7","slug":"contact-form-7","version":"6.2.2"}' }), { version: '6.2.2' });
  assert.deepEqual(readAnswer({ kind: 'wp-theme' }, { text: '{"name":"Hello Elementor","slug":"hello-elementor","version":"3.5.1"}' }), { version: '3.5.1', name: 'Hello Elementor' });
  assert.deepEqual(readAnswer({ kind: 'wp-plugin' }, { error: 'HTTP 404', status: 404 }), { unlisted: true }, 'WPML, WPBakery: premium');
  assert.deepEqual(readAnswer({ kind: 'wp-plugin' }, { text: '{"error":"closed","name":"10Web Map Builder"}' }), { unlisted: true });
  assert.deepEqual(readAnswer({ kind: 'npm' }, { text: '{"name":"next","version":"16.4.0"}' }), { version: '16.4.0' });
  assert.deepEqual(readAnswer({ kind: 'npm' }, { error: 'Timed out' }), { error: 'Timed out' });
  assert.deepEqual(readAnswer({ kind: 'npm' }, { text: '<html>', capped: false }), { error: 'Not JSON' });
  assert.deepEqual(readAnswer({ kind: 'wp-core' }, { text: '{"offers":[]}' }), { error: 'No offers' });
});

test('fetchLatest: three at a time, no cookies, answers cached 12 hours, failures retried', async () => {
  const storage = fakeStorage();
  const targets = [
    { key: 'wp-core', kind: 'wp-core' },
    { key: 'wp-plugin:contact-form-7', kind: 'wp-plugin', name: 'contact-form-7' },
    { key: 'wp-plugin:wordpress-seo', kind: 'wp-plugin', name: 'wordpress-seo' },
    { key: 'wp-plugin:sitepress-multilingual-cms', kind: 'wp-plugin', name: 'sitepress-multilingual-cms' },
    { key: 'npm:next', kind: 'npm', name: 'next' },
    { key: 'npm:astro', kind: 'npm', name: 'astro' },
  ];
  const answer = (url) => {
    if (url.includes('version-check')) return new Response(OFFERS_TEXT);
    if (url.includes('contact-form-7')) return json({ version: '6.2.2' });
    if (url.includes('wordpress-seo')) return json({ version: '28.7' });
    if (url.includes('sitepress')) return json({ error: 'Plugin not found.' }, 404);
    if (url.endsWith('/next/latest')) return json({ version: '16.4.0' });
    throw new TypeError('Failed to fetch');
  };
  await withFetch(answer, async (seen, peak) => {
    const out = await fetchLatest(targets, { storage, now: 1000 });
    assert.equal(seen.length, 6);
    assert.ok(peak() <= 3, `at most 3 at a time (saw ${peak()})`);
    for (const s of seen) assert.equal(s.opts.credentials, 'omit');
    for (const s of seen) assert.match(s.url, /^https:\/\/(?:api\.wordpress\.org|registry\.npmjs\.org)\//);
    assert.equal(out['wp-core'].offers[0], '7.1.3');
    assert.deepEqual(out['wp-plugin:contact-form-7'], { version: '6.2.2' });
    assert.deepEqual(out['wp-plugin:sitepress-multilingual-cms'], { unlisted: true });
    assert.deepEqual(out['npm:next'], { version: '16.4.0' });
    assert.match(out['npm:astro'].error, /Failed to fetch/);
    assert.deepEqual(Object.keys(storage.store).sort(), ['latest:npm:next', 'latest:wp-core', 'latest:wp-plugin:contact-form-7', 'latest:wp-plugin:sitepress-multilingual-cms', 'latest:wp-plugin:wordpress-seo']);
  });
  await withFetch(answer, async (seen) => {
    const out = await fetchLatest(targets, { storage, now: 1000 + LATEST_TTL - 1 });
    assert.deepEqual(
      seen.map((s) => s.url),
      ['https://registry.npmjs.org/astro/latest'],
      'within 12 hours only the failed lookup goes out again',
    );
    assert.deepEqual(out['wp-plugin:wordpress-seo'], { version: '28.7' });
  });
  await withFetch(answer, async (seen) => {
    await fetchLatest(targets, { storage, now: 1000 + LATEST_TTL + 1 });
    assert.equal(seen.length, 6, 'after 12 hours everything is asked again');
  });
});

const wpResult = (plugins, themes = []) => ({
  tech: [{ key: 'wordpress', id: 'wordpress', name: 'WordPress', group: 'platform', version: '6.9.4', npm: null, evidence: [] }],
  wordpress: { themes, plugins, namespaces: [], otherNamespaces: [], probes: [] },
});

test('latestTargets: core, plugins and themes on wordpress.org (10 plugins at most), frameworks with an exact version', () => {
  const plugins = Array.from({ length: 14 }, (_, i) => ({ key: `plugin|p${i}`, wporg: `plugin-${i}` }));
  plugins.splice(1, 0, { key: 'plugin|wpml', wporg: false }, { key: 'plugin|Odd', wporg: 'Bad Slug' });
  const themes = [{ slug: 'child', wporg: 'child' }, { slug: 'parent', wporg: 'parent' }, { slug: 'third', wporg: 'third' }];
  const keys = latestTargets(wpResult(plugins, themes)).map((t) => t.key);
  assert.equal(MAX_PLUGIN_LOOKUPS, 10);
  assert.equal(keys.filter((k) => k.startsWith('wp-plugin:')).length, 10);
  assert.ok(!keys.some((k) => /wpml|Bad Slug/.test(k)));
  assert.deepEqual(keys.filter((k) => k.startsWith('wp-theme:')), ['wp-theme:child', 'wp-theme:parent']);
  assert.equal(keys[0], 'wp-core');
  const frameworks = latestTargets({
    tech: [
      { id: 'nextjs', npm: 'next', version: '16.5.0-canary.9' },
      { id: 'svelte', npm: null, version: '5' },
      { id: 'vue', npm: 'vue', version: '3' },
      { id: 'astro', npm: 'astro', version: null },
      { id: 'angular', npm: '@angular/core', version: '22.2.2' },
    ],
    wordpress: null,
  }).map((t) => t.key);
  assert.deepEqual(frameworks, ['npm:next', 'npm:@angular/core'], 'only exact versions are compared');
});

test('withLatest: update statuses, premium plugins, hidden versions, a custom theme sharing a slug', () => {
  const offers = JSON.parse(OFFERS_TEXT).offers.map((o) => o.version);
  const r = withLatest(
    wpResult(
      [
        { key: 'plugin|cf7', name: 'Contact Form 7', version: '5.9.5', wporg: 'contact-form-7' },
        { key: 'plugin|wpml', name: 'WPML', version: '4.6.5', wporg: false },
        { key: 'plugin|yoast', name: 'Yoast SEO', version: null, wporg: 'wordpress-seo' },
        { key: 'plugin|akismet', name: 'Akismet', version: '5.5', wporg: 'akismet' },
      ],
      [
        { key: 'theme|hello-elementor', name: 'Hello Elementor', headerName: 'Hello Elementor', version: '3.5.1', wporg: 'hello-elementor' },
        { key: 'theme|kinsta', name: 'kinsta', headerName: 'Kinsta Theme', version: null, wporg: 'kinsta' },
      ],
    ),
    {
      'wp-core': { offers },
      'wp-plugin:contact-form-7': { version: '6.2.2' },
      'wp-plugin:wordpress-seo': { version: '28.7' },
      'wp-plugin:akismet': { version: '5.5' },
      'wp-theme:hello-elementor': { version: '3.5.1', name: 'Hello Elementor' },
      'wp-theme:kinsta': { version: '1.0.4', name: 'Kinsta Starter' },
    },
  );
  assert.deepEqual(r.tech[0].update, { status: 'update', latest: '7.1.3', branch: '6.9.10' });
  assert.deepEqual(updateLabel(r.tech[0].update), { kind: 'warn', label: 'Update available (6.9.10)', hint: '6.9.10 is out for this branch. The newest release is 7.1.3.' });
  const [cf7, wpml, yoast, akismet] = r.wordpress.plugins;
  assert.deepEqual(cf7.update, { status: 'behind', latest: '6.2.2' });
  assert.equal(updateLabel(cf7.update).label, 'Latest is 6.2.2');
  assert.deepEqual(wpml.update, { status: 'unlisted' });
  assert.equal(updateLabel(wpml.update).label, 'Not on wordpress.org');
  assert.deepEqual(yoast.update, { status: 'unknown', latest: '28.7' });
  assert.deepEqual(akismet.update, { status: 'latest', latest: '5.5' });
  const [hello, kinsta] = r.wordpress.themes;
  assert.deepEqual(hello.update, { status: 'latest', latest: '3.5.1' });
  assert.deepEqual(kinsta.update, { status: 'unlisted' }, 'a different theme on wordpress.org with the same folder name');
  for (const [status, label] of [
    ['latest', 'Latest'],
    ['patched', 'Older branch, patched'],
    ['unsupported', 'Unsupported'],
    ['prerelease', 'Prerelease'],
  ]) {
    assert.equal(updateLabel({ status, latest: '7.1.3', branch: '6.7.10' }).label, label);
  }
});
