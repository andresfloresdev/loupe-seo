// Tech detection (lib/tech.js), the WordPress probes (lib/net.js) and the
// page-world reader (lib/inject.js). Every catalog entry has a positive sample
// and a look-alike that must not match; the real-site checks run excerpts of
// the pages, headers and WordPress URLs the LOUPE-10 recon fetched on
// 2026-10-13 (tests/unit/fixtures/tech-excerpts.json, a few hundred bytes
// each). Modules are imported with a fallback so that, on a checkout without
// them, every test still runs and fails on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signalsFromHtml } from './helpers/html-signals.js';

const calls = [];
globalThis.chrome ??= {
  runtime: { id: 'loupetestid', getURL: (p) => `chrome-extension://loupetestid/${p}` },
  scripting: {
    executeScript: async (opts) => {
      calls.push(opts);
      return [{ frameId: 0, result: 'ran' }];
    },
  },
};
const T = await import('../../extension/lib/tech.js').catch(() => ({}));
const { readTechState } = await import('../../extension/lib/inject.js');
const { fetchWordPressProbes, readCapped, PROBE_BYTES } = await import('../../extension/lib/net.js');
const { TECH, GROUPS, detectTech, probeTargets, namespacePlugin, parseNamespaces, parseThemeHeader, wpVersionFromFeed, wpVersionFromOpml, isAssetVersion, copyList, overviewChips, withLatest, MAX_PROBES } = T;

const X = JSON.parse(readFileSync(new URL('./fixtures/tech-excerpts.json', import.meta.url), 'utf8'));
const OFFERS = JSON.parse(readFileSync(new URL('./fixtures/wp-version-check-2026-10-13.json', import.meta.url), 'utf8')).offers.map((o) => o.version);

// ---- signal builders ----------------------------------------------------------

const S = (o = {}) => ({ url: 'https://example.com/', scripts: [], inline: [], resources: [], generators: [], links: [], comments: [], feeds: [], restLinks: [], bodyClass: '', dom: {}, live: null, ...o });
const gen = (...g) => ({ generators: g });
const src = (...u) => ({ scripts: u.map((s) => ({ src: s })) });
const link = (...u) => ({ links: u });
const inline = (...t) => ({ inline: t });
const comment = (...c) => ({ comments: c });
const body = (c) => ({ bodyClass: c });
const dom = (o) => ({ dom: o });
const live = (values = {}, flags = []) => ({ live: { values, flags } });
const hdr = (o) => ({ __headers: o });
const plugin = (dir, file = 'assets/app.js', ver) => src(`https://example.com/wp-content/plugins/${dir}/${file}${ver ? `?ver=${ver}` : ''}`);

function run(sample, probes = null) {
  const { __headers, ...rest } = sample;
  return detectTech(S(rest), __headers ?? null, probes);
}
function has(result, id) {
  return result.tech.some((r) => r.id === id && !r.implied) || !!result.wordpress?.plugins.some((p) => p.id === id);
}
function rowOf(result, id) {
  return result.tech.find((r) => r.id === id) ?? result.wordpress?.plugins.find((p) => p.id === id) ?? null;
}

// ---- every catalog entry: a positive sample (and the version it gives) and a look-alike

const SAMPLES = {
  // platform
  wordpress: [gen('WordPress 6.9.4'), '6.9.4', gen('WordPressify 2.1')],
  woocommerce: [gen('WooCommerce 10.0.5'), '10.0.5', body('home no-woocommerce')],
  shopify: [inline('Shopify.theme = {"name":"x","schema_name":"Dawn","schema_version":"15.0.0"};'), null, inline('console.log("Shopify is a platform")')],
  drupal: [gen('Drupal 10 (https://www.drupal.org)'), '10', gen('Drupalish 3')],
  joomla: [gen('Joomla! - Open Source Content Management'), null, src('https://example.com/media/jquery/x.js')],
  wix: [gen('Wix.com Website Builder'), null, src('https://example.com/static/parastorage.js')],
  squarespace: [hdr({ server: 'Squarespace' }), null, link('https://example.com/squarespace-tips.css')],
  webflow: [dom({ wfSite: '5f2b1c' }), null, gen('Webflowy')],
  framer: [gen('Framer 8b1d2a6'), null, src('https://example.com/framer-motion.js')],
  ghost: [gen('Ghost 5.88'), '5.88', gen('Ghostwriter 2')],
  'hubspot-cms': [gen('HubSpot'), null, src('https://example.com/hs/notes.js')],
  // frameworks and libraries
  nextjs: [live({ 'next.version': '16.4.0' }), '16.4.0', src('https://example.com/next/static/x.js')],
  nuxt: [live({ 'nuxt.version': '4.6.1' }), '4.6.1', src('https://example.com/nuxt/x.js')],
  astro: [gen('Astro v7.3.5'), '7.3.5', { ...inline('const astro = "Astro rocks"'), ...comment('Built with Astro'), ...link('https://astro.build/assets/logo.svg') }],
  sveltekit: [live({}, ['sveltekit']), null, inline('const svelteKit = 1')],
  svelte: [live({ 'svelte.version': '5' }), '5', inline('svelte')],
  gatsby: [gen('Gatsby 4.24.6'), '4.24.6', gen('The Great Gatsby')],
  remix: [inline('window.__remixContext = {"url":"/"};'), null, inline('remix the context')],
  angular: [dom({ ngVersion: '22.2.2+sha-68c6c57' }), '22.2.2', comment('ng-version')],
  vue: [live({ 'vue.version': '3.5.44' }), '3.5.44', inline('new Vue()')],
  react: [live({}, ['react']), null, inline('React')],
  preact: [live({}, ['preact']), null, inline('preact')],
  alpine: [src('https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js'), '3.14.1', link('https://example.com/alpine-hiking.jpg')],
  htmx: [src('https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js'), '2.0.4', link('https://example.com/htmx-notes.css')],
  jquery: [src('https://code.jquery.com/jquery-3.7.1.min.js'), '3.7.1', src('https://example.com/js/jquery-ui-1.13.2.min.js')],
  gsap: [live({ 'gsap.version': '3.13.0' }), '3.13.0', link('https://example.com/gsapling.png')],
  // WordPress plugins
  elementor: [gen('Elementor 4.2.3; features: e_font_icon_svg'), '4.2.3', gen('Elementorish 1.0.0')],
  'elementor-pro': [plugin('elementor-pro', 'assets/css/popup.min.css', '4.2.2'), '4.2.2', plugin('elementor-pro-addons', 'x.css', '1.2.3')],
  wpbakery: [body('wpb-js-composer js-comp-ver-5.4.7 vc_responsive'), '5.4.7', body('js-comp')],
  divi: [gen('Divi v.4.27.4'), '4.27.4', gen('Divide 2.0')],
  'beaver-builder': [body('fl-builder'), null, body('fl-builder-lite')],
  bricks: [body('brx-body'), null, body('bricks')],
  yoast: [comment('This site is optimized with the Yoast SEO plugin v27.2 - https://yoast.com/'), '27.2', comment('Yoast SEO is great')],
  'rank-math': [comment('Search Engine Optimization by Rank Math PRO - https://rankmath.com/'), null, comment('rank math')],
  aioseo: [comment('All in One SEO 4.8.1 - aioseo.com'), '4.8.1', comment('All in one place')],
  wpml: [gen('WPML ver:4.6.5 stt:1,4;'), '4.6.5', gen('WPMLish')],
  polylang: [plugin('polylang', 'js/build/front.min.js', '3.7.3'), '3.7.3', plugin('polylang-addon', 'x.js', '1.0.1')],
  cf7: [plugin('contact-form-7', 'includes/css/styles.css', '5.9.5'), '5.9.5', plugin('contact-form-7-honeypot', 'x.js', '2.1.1')],
  gravityforms: [plugin('gravityforms', 'js/gravityforms.min.js', '2.9.1'), '2.9.1', plugin('gravityformsrecaptcha', 'js/frontend.min.js', '2.2.2')],
  wpforms: [plugin('wpforms-lite', 'assets/js/wpforms.min.js', '1.9.2.1'), '1.9.2.1', plugin('wpforms-addon', 'x.js', '1.0.1')],
  'ninja-forms': [plugin('ninja-forms', 'assets/js/front-end.js', '3.8.4'), '3.8.4', plugin('ninja-forms-uploads', 'x.js', '3.3.1')],
  revslider: [gen('Powered by Slider Revolution 6.6.5 - responsive, Mobile-Friendly Slider Plugin'), '6.6.5', gen('Slider Revolution fan')],
  'wp-rocket': [comment('This website is like a Rocket, isn\'t it? Performance optimized by WP Rocket.'), null, comment('rocket science')],
  'litespeed-cache': [comment('Page optimized by LiteSpeed Cache @2026-10-13 10:00:00'), null, comment('LiteSpeed')],
  w3tc: [comment('Performance optimized by W3 Total Cache. Learn more: https://www.boldgrid.com/w3-total-cache/'), null, comment('Total Cache')],
  wordfence: [plugin('wordfence', 'js/x.js', '8.0.3'), '8.0.3', plugin('wordfence-login-security', 'x.js', '1.1.1')],
  jetpack: [plugin('jetpack', '_inc/build/x.js', '14.1'), '14.1', plugin('jetpack-boost', 'x.js', '3.1.1')],
  akismet: [plugin('akismet', '_inc/akismet-frontend.js', '5.5'), '5.5', plugin('akismet-addon', 'x.js', '1.0.1')],
  ai1wm: [plugin('all-in-one-wp-migration', 'lib/view/assets/x.js', '7.89'), '7.89', plugin('all-in-one-wp-migration-unlimited', 'x.js', '2.1.1')],
  smush: [plugin('wp-smushit', 'app/assets/js/x.js', '3.17.1'), '3.17.1', plugin('wp-smushit-addon', 'x.js', '1.0.1')],
  redirection: [plugin('redirection', 'x.js', '5.5.1'), '5.5.1', plugin('redirection-addon', 'x.js', '1.0.1')],
  // hosting and CDN
  cloudflare: [hdr({ 'cf-ray': 'a4a324bc6c2f7aa8-YYZ' }), null, hdr({ server: 'not-cloudflare' })],
  vercel: [hdr({ 'x-vercel-id': 'iad1::ht82n' }), null, hdr({ server: 'Vercelli' })],
  netlify: [hdr({ 'x-nf-request-id': '01J' }), null, hdr({ server: 'Netlifyish' })],
  'wp-engine': [hdr({ 'x-powered-by': 'WP Engine' }), null, hdr({ 'x-powered-by': 'WP Engineers' })],
  kinsta: [hdr({ 'x-kinsta-cache': 'HIT' }), null, hdr({ server: 'kinsta' })],
  'wordpress-vip': [hdr({ 'x-powered-by': 'WordPress VIP <https://wpvip.com>' }), null, hdr({ 'x-powered-by': 'WordPress' })],
  pantheon: [hdr({ 'x-pantheon-styx-hostname': 'styx' }), null, hdr({ server: 'pantheon' })],
  'elementor-cloud': [hdr({ 'x-powered-by': 'Elementor Cloud' }), null, hdr({ 'x-powered-by': 'Elementor' })],
  fly: [hdr({ 'fly-request-id': '01J' }), null, hdr({ server: 'Flywheel' })],
  cloudfront: [hdr({ via: '1.1 5b66dea.cloudfront.net (CloudFront)' }), null, hdr({ via: '1.1 varnish' })],
  fastly: [hdr({ 'x-served-by': 'cache-yul1970023-YUL' }), null, hdr({ 'x-served-by': 'web-01' })],
  akamai: [hdr({ server: 'AkamaiGHost' }), null, hdr({ server: 'Akamaized' })],
  'github-pages': [hdr({ server: 'GitHub.com' }), null, hdr({ server: 'GitHub.com proxy' })],
  // server and language
  nginx: [hdr({ server: 'nginx/1.27.4' }), '1.27.4', hdr({ server: 'nginxish' })],
  apache: [hdr({ server: 'Apache/2.4.68 (Debian)' }), '2.4.68', hdr({ server: 'Apache-Coyote/1.1' })],
  litespeed: [hdr({ server: 'LiteSpeed' }), null, hdr({ server: 'LiteSpeedy' })],
  iis: [hdr({ server: 'Microsoft-IIS/10.0' }), '10.0', hdr({ server: 'Microsoft-HTTPAPI/2.0' })],
  openresty: [hdr({ server: 'openresty/1.25.3.1' }), '1.25.3.1', hdr({ server: 'openrestyle' })],
  caddy: [hdr({ server: 'Caddy' }), null, hdr({ server: 'Caddyshack' })],
  php: [hdr({ 'x-powered-by': 'PHP/8.4.26' }), '8.4.26', hdr({ 'x-powered-by': 'PHPUnit' })],
  aspnet: [hdr({ 'x-powered-by': 'ASP.NET' }), null, hdr({ 'x-powered-by': 'ASP.NETCore' })],
  express: [hdr({ 'x-powered-by': 'Express' }), null, hdr({ 'x-powered-by': 'ExpressionEngine' })],
};

test('the catalog: unique ids, known groups, valid patterns, and everything LOUPE-10 lists', () => {
  const ids = TECH.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  const groups = new Set([...GROUPS.map((g) => g.id), 'plugin']);
  for (const t of TECH) {
    assert.ok(groups.has(t.group), `${t.id} group ${t.group}`);
    assert.ok(t.name, t.id);
    for (const source of ['generator', 'url', 'inline', 'comment', 'header', 'body']) for (const p of t[source] ?? []) assert.ok(p.re instanceof RegExp, `${t.id} ${source}`);
    for (const id of t.implies ?? []) assert.ok(ids.includes(id), `${t.id} implies ${id}`);
  }
  const names = new Set(TECH.map((t) => t.name));
  const listed = [
    'WordPress', 'WooCommerce', 'Shopify', 'Drupal', 'Joomla', 'Wix', 'Squarespace', 'Webflow', 'Framer', 'Ghost', 'HubSpot CMS',
    'Next.js', 'Nuxt', 'Astro', 'SvelteKit', 'Svelte', 'Gatsby', 'Remix / React Router', 'Angular', 'Vue', 'React', 'Preact', 'Alpine.js', 'htmx', 'jQuery', 'GSAP',
    'Elementor', 'WPBakery', 'Divi', 'Beaver Builder', 'Bricks', 'Yoast SEO', 'Rank Math', 'All in One SEO', 'WPML', 'Polylang', 'Contact Form 7', 'Gravity Forms', 'WPForms', 'Ninja Forms', 'Slider Revolution', 'WP Rocket', 'LiteSpeed Cache', 'W3 Total Cache', 'Wordfence', 'Jetpack', 'Akismet',
    'Cloudflare', 'Vercel', 'Netlify', 'WP Engine', 'Kinsta', 'WordPress VIP', 'Pantheon', 'Elementor Cloud', 'Fly.io', 'CloudFront', 'Fastly', 'Akamai', 'GitHub Pages',
    'nginx', 'Apache', 'LiteSpeed', 'IIS', 'OpenResty', 'Caddy', 'PHP', 'ASP.NET', 'Express',
  ];
  for (const n of listed) assert.ok(names.has(n), n);
  assert.deepEqual(GROUPS.map((g) => g.name), ['Platform', 'Frameworks and libraries', 'WordPress theme and plugins', 'Hosting and CDN', 'Server and language']);
});

test('every catalog entry has a sample here', () => {
  assert.deepEqual(TECH.map((t) => t.id).filter((id) => !SAMPLES[id]), []);
});

for (const [id, [positive, version, lookalike]] of Object.entries(SAMPLES)) {
  test(`${id}: found by its sample${version ? ` with version ${version}` : ''}, not by a look-alike`, () => {
    const r = run(positive);
    assert.ok(has(r, id), `${id} found in ${JSON.stringify(r.tech.map((x) => x.id))} ${JSON.stringify(r.wordpress?.plugins.map((p) => p.id) ?? [])}`);
    assert.equal(rowOf(r, id).version, version, `${id} version`);
    assert.equal(has(run(lookalike), id), false, `${id} look-alike`);
  });
}

// ---- WordPress: version sources and look-alikes -------------------------------

const core = (r) => r.tech.find((x) => x.id === 'wordpress');
const wpPage = (o = {}) => ({ ...link('https://example.com/wp-content/themes/flores/style.css?ver=1.0'), ...o });

test('WordPress core version: generator, then core stylesheet, then feed, then wp-links-opml.php, then a theme asset (Likely)', () => {
  const both = run(wpPage({ ...gen('WordPress 7.0.7'), ...link('https://example.com/wp-includes/css/dist/block-library/style.min.css?ver=6.9.4') }));
  assert.equal(core(both).version, '7.0.7', 'the generator wins');
  const feed = { url: 'https://example.com/feed/', text: '<rss><channel><generator>https://wordpress.org/?v=7.1.3</generator></channel></rss>' };
  const opml = { url: 'https://example.com/wp-links-opml.php', text: '<?xml version="1.0"?><!-- generator="WordPress/6.7.10" --><opml>' };
  const css = wpPage(link('https://example.com/wp-includes/css/dist/block-library/common.min.css?ver=7.1.2', 'https://example.com/wp-content/themes/flores/style.css?ver=1.0'));
  assert.equal(core(run(css, { feed })).version, '7.1.2', 'a core stylesheet beats the feed');
  assert.equal(core(run(wpPage(), { feed, opml })).version, '7.1.3', 'the feed beats wp-links-opml.php');
  assert.equal(core(run(wpPage(), { opml })).version, '6.7.10');
  assert.equal(core(run(wpPage(), { opml })).confidence, 'confirmed');
  const emoji = run(wpPage(inline('window._wpemojiSettings = {"source":{"concatemoji":"https:\\/\\/example.com\\/wp-includes\\/js\\/wp-emoji-release.min.js?ver=7.0.7"}};')));
  assert.equal(core(emoji).version, '7.0.7', 'emoji settings');
  // Likely: a theme asset carrying the core version while the theme's style.css says 1.0 (dieuduciel.com).
  const likelyPage = wpPage({ ...link('https://example.com/wp-content/themes/flores/build/index.css?ver=7.1.3'), ...body('home wp-theme-flores') });
  const themes = [{ slug: 'flores', url: 'https://example.com/wp-content/themes/flores/style.css', text: '/*\nTheme Name: Flores\nVersion: 1.0\n*/' }];
  const likely = core(run(likelyPage, { themes }));
  assert.equal(likely.version, '7.1.3');
  assert.equal(likely.confidence, 'likely');
  assert.equal(core(run(likelyPage, { themes, feed })).confidence, 'confirmed', 'never Likely when a real source gives it');
  assert.equal(core(run(likelyPage)).version, null, 'no Likely before the theme’s own version is known');
});

test('WordPress look-alikes: jQuery’s version, js/dist hashes, a timestamp or a date ?ver=, a bundled library', () => {
  const r = run(
    wpPage({
      ...src(
        'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1',
        'https://example.com/wp-includes/js/dist/hooks.min.js?ver=66',
        'https://example.com/wp-includes/js/jquery/ui/core.min.js?ver=1.14.2',
        'https://example.com/wp-content/plugins/stamped/js/app.js?ver=1791211150',
        'https://example.com/wp-content/plugins/dated/js/app.js?ver=2024.05.18.001',
      ),
    }),
  );
  assert.equal(core(r).version, null, 'no core version from wp-includes/js/');
  assert.equal(r.tech.find((x) => x.id === 'jquery').version, '3.7.1', 'it is jQuery’s');
  assert.equal(rowOf(r, 'slug:stamped').version, null, 'a timestamp is not a version');
  assert.equal(rowOf(r, 'slug:dated').version, null, 'a date is not a version');
  for (const v of ['1791211150', '2024.05.18.001', '2026.1', '20261007172512', 'abc', '1']) assert.equal(isAssetVersion(v), false, v);
  for (const v of ['5.9.5', '7.89', '1.9.2.1', '3.0.0-beta1']) assert.equal(isAssetVersion(v), true, v);
  // A theme’s bundled Font Awesome 4.4.0 is not the core version (fairmountbagel.com, Zephyr).
  const fa = run(
    { ...link('https://example.com/wp-content/themes/Zephyr/framework/css/font-awesome.css?ver=4.4.0', 'https://example.com/wp-content/themes/Zephyr/framework/css/us-base.css?ver=2.2'), ...body('wp-theme-Zephyr') },
    { themes: [{ slug: 'Zephyr', url: 'https://example.com/wp-content/themes/Zephyr/style.css', text: '/*\nTheme Name: Zephyr\nVersion: 2.2\n*/' }] },
  );
  assert.equal(core(fa).version, null);
  // A plugin asset stamped with the core version is not the plugin’s version.
  const stamped = run({ ...gen('WordPress 7.1.3'), ...plugin('my-blocks', 'style.css', '7.1.3') });
  assert.equal(rowOf(stamped, 'slug:my-blocks').version, null);
});

test('WordPress theme and plugins: names, parent and child, unknown plugins by folder, version hidden', () => {
  const r = run(
    {
      ...link('https://example.com/blog/wp-content/themes/flores-child/style.css?ver=1.0', 'https://example.com/blog/wp-content/themes/flores/assets/main.css?ver=3.1.0'),
      ...plugin('acme-widgets', 'x.js', '1.4.2'),
      ...body('home wp-theme-flores wp-child-theme-flores-child'),
    },
    {
      themes: [
        { slug: 'flores-child', text: '/*\nTheme Name: Flores Child\nTemplate: flores\nVersion: 1.0.1\n*/' },
        { slug: 'flores', text: '/*\r\nTheme Name: Flores\r\nVersion: 3.1.0\r\n*/' },
      ],
      rest: { text: '{"namespaces":["wp/v2","oembed/1.0","yoast/v1","wc/v3","custom/v1"]}' },
    },
  );
  const [child, parent] = r.wordpress.themes;
  assert.deepEqual([child.name, child.version, child.parent, child.child], ['Flores Child', '1.0.1', 'flores', true]);
  assert.deepEqual([parent.name, parent.version, parent.parentOf], ['Flores', '3.1.0', 'flores-child']);
  const acme = rowOf(r, 'slug:acme-widgets');
  assert.deepEqual([acme.name, acme.version, acme.named], ['acme-widgets', '1.4.2', false]);
  assert.equal(rowOf(r, 'yoast').version, null, 'Yoast from its namespace: version hidden');
  assert.ok(r.tech.some((x) => x.id === 'woocommerce'), 'wc/v3: WooCommerce, a Platform row');
  assert.deepEqual(r.wordpress.otherNamespaces, ['custom/v1']);
  assert.deepEqual(parseThemeHeader(' * Theme Name: Kinsta\n * Author: Kinsta\n */'), { name: 'Kinsta', version: null, template: null });
});

test('the namespace map', () => {
  const map = {
    'yoast/v1': 'yoast', 'wc/v3': 'woocommerce', wc: 'woocommerce', 'wc-admin': 'woocommerce', 'wc/store/v1': 'woocommerce', 'rankmath/v1': 'rank-math',
    'wordfence/v1': 'wordfence', 'gf/v2': 'gravityforms', 'pll/v1': 'polylang', 'wpml/v1': 'wpml', 'wpml/tm/v1': 'wpml', 'contact-form-7/v1': 'cf7',
    'jetpack/v4': 'jetpack', 'ai1wm/v1': 'ai1wm', 'wp-smush/v1': 'smush', 'akismet/v1': 'akismet', 'redirection/v1': 'redirection', 'aioseo/v1': 'aioseo', 'wpforms/v1': 'wpforms',
  };
  for (const [ns, id] of Object.entries(map)) assert.equal(namespacePlugin(ns)?.id, id, ns);
  for (const ns of ['wp/v2', 'oembed/1.0', 'wccom-site/v3', 'yoast-gdpr/v1', 'yoastcom/v1', 'gfx/v1', 'otgs/installer/v1']) assert.equal(namespacePlugin(ns), null, ns);
  assert.deepEqual(parseNamespaces('{"namespaces":["oembed\\/1.0","wpml\\/v1"]}'), ['oembed/1.0', 'wpml/v1']);
  // A site that ignores _fields: the whole index, cut at 1 MB, still gives its namespaces.
  assert.deepEqual(parseNamespaces('{"name":"Site","namespaces":["yoast\\/v1","wc\\/v3"],"routes":{"\\/":{"namespace":"","meth'), ['yoast/v1', 'wc/v3']);
  assert.deepEqual(parseNamespaces('not json'), []);
});

test('feed and wp-links-opml.php readers', () => {
  assert.equal(wpVersionFromFeed(X['yoast.com'].feed), '7.1.3');
  assert.equal(wpVersionFromFeed(X['kinsta.com'].feed), '6.7.10');
  assert.equal(wpVersionFromOpml(X['kinsta.com'].opml), '6.7.10');
  assert.equal(wpVersionFromFeed('<generator>https://wordpress.com/</generator>'), null);
  assert.equal(wpVersionFromFeed('<generator>Feedburner</generator>'), null);
});

// ---- real sites (excerpts) -------------------------------------------------------

function site(name, { withProbes = true } = {}) {
  const f = X[name];
  const s = signalsFromHtml(f.html.join('\n'), f.url);
  const first = detectTech(s, f.headers);
  if (!withProbes) return first;
  const targets = probeTargets(s, f.headers, first);
  const probes = targets && {
    feed: f.feed && targets.feed ? { url: targets.feed, text: `<rss><channel>${f.feed}</channel></rss>` } : targets.feed ? { url: targets.feed, error: 'HTTP 404' } : undefined,
    rest: f.namespaces && targets.rest ? { url: targets.rest, text: f.namespaces } : undefined,
    opml: f.opml && targets.opml ? { url: targets.opml, text: f.opml } : undefined,
    themes: f.style && targets.themes[0] ? [{ ...targets.themes[0], text: f.style }] : [],
  };
  return detectTech(s, f.headers, probes);
}
const names = (r, group) => r.tech.filter((x) => x.group === group && !x.implied).map((x) => (x.version ? `${x.name} ${x.version}` : x.name));
const pluginNames = (r) => r.wordpress.plugins.map((p) => (p.version ? `${p.name} ${p.version}` : p.name));

test('fairmountbagel.com: WordPress 7.0.7, Zephyr 2.2, its plugins with versions, jQuery, Cloudflare', () => {
  const r = site('fairmountbagel.com');
  assert.deepEqual(names(r, 'platform'), ['WordPress 7.0.7']);
  assert.deepEqual(names(r, 'framework'), ['jQuery 3.7.1']);
  assert.deepEqual(names(r, 'hosting'), ['Cloudflare']);
  assert.deepEqual(
    r.wordpress.themes.map((t) => `${t.name} ${t.version}`),
    ['Zephyr 2.2'],
  );
  assert.deepEqual(pluginNames(r).sort(), ['Akismet', 'All-in-One WP Migration', 'Contact Form 7 5.9.5', 'Slider Revolution 6.6.5', 'Smush', 'WPBakery 5.4.7', 'WPML 4.6.5', 'Yoast SEO 27.2'].sort());
  const status = withLatest(r, { 'wp-core': { offers: OFFERS } }).tech[0].update;
  assert.equal(status.status, 'patched', 'Older branch, patched');
});

test('bixi.com: WordPress 6.9.4 (Update available, 6.9.10), bixi2023 1.3, WPML 4.9.4, Yoast SEO 27.6, Apache', () => {
  const r = site('bixi.com');
  assert.deepEqual(names(r, 'platform'), ['WordPress 6.9.4']);
  assert.deepEqual(names(r, 'server'), ['Apache']);
  assert.deepEqual(r.wordpress.themes.map((t) => `${t.name} ${t.version}`), ['bixi2023 1.3']);
  assert.deepEqual(pluginNames(r), ['WPML 4.9.4', 'Yoast SEO 27.6']);
  assert.deepEqual(withLatest(r, { 'wp-core': { offers: OFFERS } }).tech[0].update, { status: 'update', latest: '7.1.3', branch: '6.9.10' });
});

test('uqam.ca: WordPress 7.1.2 from a core stylesheet with no generator, UQAM 2019 2.0.2, Apache 2.4.68, PHP 8.4.26', () => {
  const r = site('uqam.ca');
  const wp = core(r);
  assert.deepEqual([wp.version, wp.confidence], ['7.1.2', 'confirmed']);
  assert.match(wp.evidence[0], /block-library\/common\.min\.css\?ver=7\.1\.2/);
  assert.deepEqual(r.wordpress.themes.map((t) => `${t.name} ${t.version}`), ['UQAM 2019 2.0.2']);
  assert.deepEqual(pluginNames(r), ['Yoast SEO 28.4', 'WPML 4.9.7']);
  assert.deepEqual(names(r, 'server'), ['Apache 2.4.68', 'PHP 8.4.26']);
  assert.deepEqual(names(r, 'hosting'), ['CloudFront']);
  assert.equal(withLatest(r, { 'wp-core': { offers: OFFERS } }).tech[0].update.status, 'update');
});

test('yoast.com: no generator, WordPress 7.1.3 from the feed, WooCommerce, a Bedrock child theme, Cloudflare', () => {
  const plain = site('yoast.com', { withProbes: false });
  assert.equal(core(plain).version, null, 'nothing in the page itself');
  const r = site('yoast.com');
  assert.deepEqual([core(r).version, core(r).confidence], ['7.1.3', 'confirmed']);
  assert.equal(withLatest(r, { 'wp-core': { offers: OFFERS } }).tech[0].update.status, 'latest');
  assert.ok(names(r, 'platform').includes('WooCommerce 10.0.5'), names(r, 'platform').join());
  assert.deepEqual(r.wordpress.themes.map((t) => [t.slug, t.child, t.parent]), [['yoast-com', true, 'yoast-theme'], ['yoast-theme', false, null]]);
  assert.ok(pluginNames(r).includes('Yoast SEO'));
});

test('kinsta.com: WordPress 6.7.10 from the feed (Older branch, patched), theme kinsta without a version, Kinsta host', () => {
  const r = site('kinsta.com');
  assert.equal(core(r).version, '6.7.10');
  assert.equal(withLatest(r, { 'wp-core': { offers: OFFERS } }).tech[0].update.status, 'patched');
  assert.deepEqual(r.wordpress.themes.map((t) => [t.slug, t.version]), [['kinsta', null]]);
  assert.ok(names(r, 'hosting').includes('Kinsta'));
});

test('dieuduciel.com: WordPress 7.1.3 Likely from a theme asset, WP Engine', () => {
  const r = site('dieuduciel.com');
  assert.deepEqual([core(r).version, core(r).confidence], ['7.1.3', 'likely']);
  assert.ok(names(r, 'hosting').includes('WP Engine'));
});

test('elementor.com: WordPress 7.0.7, Elementor 4.2.3, Elementor Pro 4.2.2, Elementor Cloud', () => {
  const r = site('elementor.com');
  assert.deepEqual(names(r, 'platform'), ['WordPress 7.0.7']);
  assert.deepEqual(pluginNames(r), ['Elementor 4.2.3', 'Elementor Pro 4.2.2']);
  assert.ok(names(r, 'hosting').includes('Elementor Cloud'));
});

test('frameworks: Next.js and React on Vercel, Astro 7.3.5 and 5.16.0, Angular 22.2.2 on Fastly, Shopify with its theme', () => {
  const next = site('nextjs.org');
  assert.deepEqual(names(next, 'framework'), ['Next.js']);
  assert.ok(next.tech.some((x) => x.id === 'react' && x.implied), 'React, implied by Next.js');
  assert.deepEqual(names(next, 'hosting'), ['Vercel']);
  assert.equal(next.wordpress, null);
  assert.deepEqual(names(site('astro.build'), 'framework'), ['Astro 7.3.5']);
  assert.deepEqual(names(site('floresagency.ca'), 'framework'), ['Astro 5.16.0']);
  const ng = site('angular.dev');
  assert.deepEqual(names(ng, 'framework'), ['Angular 22.2.2']);
  assert.deepEqual(names(ng, 'hosting'), ['Fastly']);
  const shop = site('allbirds.com');
  assert.deepEqual(names(shop, 'platform'), ['Shopify']);
  assert.equal(shop.tech[0].detail, 'Theme allbirds-theme 1.231.12');
  assert.deepEqual(names(shop, 'hosting'), ['Cloudflare']);
});

test('live state: Next.js, Nuxt with Vue, Svelte major only, Shopify theme from the global', () => {
  const r = run(live({ 'next.version': '16.5.0-canary.9' }));
  assert.equal(rowOf(r, 'nextjs').version, '16.5.0-canary.9');
  const nuxt = run({ ...live({ 'nuxt.version': '4.6.1', 'nuxt.vue': '3.5.43' }), ...dom({ nuxtRoot: true }) });
  assert.deepEqual(names(nuxt, 'framework'), ['Nuxt 4.6.1', 'Vue 3.5.43']);
  const svelte = run(live({ 'svelte.version': '5' }, ['sveltekit']));
  assert.deepEqual(names(svelte, 'framework'), ['SvelteKit', 'Svelte 5']);
  const shop = run(live({ 'shopify.theme.schema_name': 'allbirds-theme', 'shopify.theme.schema_version': '1.231.12' }, ['shopify.theme']));
  assert.equal(shop.tech[0].detail, 'Theme allbirds-theme 1.231.12');
  assert.equal(run(live({ 'next.version': { toString: () => '1.0.0' } })).tech.length, 0, 'not a string: ignored');
});

test('nothing recognized: an empty result says what was checked', () => {
  const r = detectTech(S({ scripts: [{ src: 'https://example.com/app.js' }], inline: ['var a = 1'] }), { 'content-type': 'text/html' });
  assert.deepEqual(r.tech, []);
  assert.equal(r.wordpress, null);
  assert.deepEqual(r.checked, { generators: 0, urls: 1, inline: 1, comments: 0, headers: true, live: false });
});

test('copyList and the Overview chips', () => {
  const r = withLatest(site('bixi.com'), { 'wp-core': { offers: OFFERS } });
  assert.equal(copyList(r), 'WordPress 6.9.4\nbixi2023 1.3 (theme)\nWPML 4.9.4\nYoast SEO 27.6\nApache');
  assert.deepEqual(
    overviewChips(r).map((c) => [c.label, c.kind]),
    [
      ['WordPress 6.9.4', 'neutral'],
      ['Update available (6.9.10)', 'warn'],
    ],
  );
  const next = overviewChips(site('nextjs.org')).map((c) => c.label);
  assert.deepEqual(next, ['Next.js', 'Vercel'], 'the framework, then the host; React (implied) is not the framework');
  assert.deepEqual(overviewChips(withLatest(site('yoast.com'), { 'wp-core': { offers: OFFERS } })).map((c) => c.label), ['WordPress 7.1.3', 'WooCommerce 10.0.5', 'Cloudflare'], 'Latest is not repeated on Overview');
  assert.deepEqual(overviewChips(site('fairmountbagel.com')).map((c) => c.label), ['WordPress 7.0.7', 'Cloudflare'], 'jQuery is a library, not the framework');
  const chipsOf = (sample) => overviewChips(run(sample)).map((c) => c.label);
  // kinsta.com in the real run: Preact found on DOM nodes (a widget), Kinsta behind Cloudflare.
  assert.deepEqual(chipsOf({ ...gen('WordPress 6.7.10'), ...live({}, ['preact']), ...hdr({ 'cf-ray': 'x-YUL', 'x-kinsta-cache': 'HIT' }) }), ['WordPress 6.7.10', 'Kinsta'], 'the host before its CDN; a widget’s Preact is not the site’s framework');
  // allbirds.com: Vue gives its version, it is the storefront’s.
  assert.deepEqual(chipsOf({ ...live({ 'vue.version': '3.5.31', 'shopify.theme.schema_name': 'allbirds-theme' }, ['react', 'shopify.theme']) }), ['Shopify', 'Vue 3.5.31']);
  // mtl.org: SvelteKit before a Preact widget; a React app with no platform shows React.
  assert.deepEqual(chipsOf(live({ 'svelte.version': '5' }, ['sveltekit', 'preact'])), ['SvelteKit']);
  assert.deepEqual(chipsOf(live({}, ['react'])), ['React']);
  // notion.com: Vercel behind Cloudflare.
  assert.deepEqual(chipsOf({ ...live({ 'next.version': '16.3.6' }), ...hdr({ 'cf-ray': 'x-YUL', 'x-vercel-id': 'iad1::x' }) }), ['Next.js 16.3.6', 'Vercel']);
});

test('evidence: what gave the version first, whole class names', () => {
  const r = run({ ...gen('WordPress 6.9.4'), ...dom({ restLink: true }), ...body('home wp-theme-twentytwentyfive') });
  assert.equal(core(r).evidence[0], 'generator "WordPress 6.9.4"');
  assert.ok(core(r).evidence.includes('body class "wp-theme-twentytwentyfive"'), core(r).evidence.join(' | '));
});

// ---- WordPress probe targets --------------------------------------------------------

test('probeTargets: only on WordPress pages, from the page’s own links, same origin, never a forbidden path', () => {
  const page = S({
    url: 'https://example.com/wp/blog/',
    feeds: [{ href: 'https://example.com/wp/comments/feed/' }, { href: 'https://example.com/wp/feed/' }],
    restLinks: ['https://example.com/wp/wp-json/'],
    scripts: [{ src: 'https://example.com/wp/wp-includes/js/jquery/jquery.min.js?ver=3.7.1' }],
    links: ['https://example.com/wp/wp-content/themes/flores-child/style.css?ver=1.0', 'https://example.com/wp/wp-content/themes/flores/main.css', 'https://example.com/wp/wp-content/themes/third/x.css'],
    bodyClass: 'wp-theme-flores wp-child-theme-flores-child',
  });
  const r = detectTech(page);
  assert.deepEqual(probeTargets(page, null, r), {
    feed: 'https://example.com/wp/feed/',
    rest: 'https://example.com/wp/wp-json/?_fields=namespaces',
    opml: 'https://example.com/wp/wp-links-opml.php',
    themes: [
      { slug: 'flores-child', url: 'https://example.com/wp/wp-content/themes/flores-child/style.css' },
      { slug: 'flores', url: 'https://example.com/wp/wp-content/themes/flores/style.css' },
    ],
  });
  // Not WordPress: nothing to probe.
  const plain = S({ url: 'https://example.com/', feeds: [{ href: 'https://example.com/feed/' }], restLinks: [] });
  assert.equal(probeTargets(plain, null, detectTech(plain)), null);
  // Another origin, or a path Loupe never asks for.
  const hostile = S({
    url: 'https://example.com/',
    generators: ['WordPress 6.9.4'],
    feeds: [{ href: 'https://feeds.feedburner.com/example' }, { href: 'https://example.com/wp-login.php' }, { href: 'https://example.com/readme.txt' }],
    restLinks: ['https://cdn.example.net/wp-json/', 'https://example.com/wp-admin/admin-ajax.php'],
    scripts: [{ src: 'https://cdn.example.net/wp-includes/js/x.js' }],
    links: ['https://cdn.example.net/wp-content/themes/flores/style.css'],
  });
  assert.deepEqual(probeTargets(hostile, null, detectTech(hostile)), { feed: null, rest: null, opml: null, themes: [] });
  // The REST index from the Link header, else beside the feed (Bedrock: yoast.com).
  const header = S({ url: 'https://example.com/', generators: ['WordPress 6.9.4'] });
  assert.equal(probeTargets(header, { link: '<https://example.com/wp-json/>; rel="https://api.w.org/"' }, detectTech(header)).rest, 'https://example.com/wp-json/?_fields=namespaces');
  const bedrock = signalsFromHtml(X['yoast.com'].html.join('\n'), X['yoast.com'].url);
  const t = probeTargets(bedrock, X['yoast.com'].headers, detectTech(bedrock, X['yoast.com'].headers));
  assert.deepEqual([t.feed, t.rest, t.opml], ['https://yoast.com/feed/', 'https://yoast.com/wp-json/?_fields=namespaces', 'https://yoast.com/wp/wp-links-opml.php']);
});

// ---- WordPress probes (net.js) -----------------------------------------------------------

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  try {
    await fn(seen);
  } finally {
    globalThis.fetch = real;
  }
}

const targets = {
  feed: 'https://example.com/wp/feed/',
  rest: 'https://example.com/wp/wp-json/?_fields=namespaces',
  opml: 'https://example.com/wp/wp-links-opml.php',
  themes: [
    { slug: 'flores-child', url: 'https://example.com/wp/wp-content/themes/flores-child/style.css' },
    { slug: 'flores', url: 'https://example.com/wp/wp-content/themes/flores/style.css' },
  ],
};

test('fetchWordPressProbes: five at most, no cookies, redirects not followed, one failure keeps the rest', async () => {
  await withFetch(
    (url) => {
      if (url.endsWith('/feed/')) return new Response('Not found', { status: 404 });
      if (url.includes('wp-json')) return new Response('{"namespaces":["yoast/v1"]}');
      if (url.endsWith('wp-links-opml.php')) return new Response('<!-- generator="WordPress/7.1.3" -->');
      return new Response('/*\nTheme Name: X\nVersion: 1.0\n*/');
    },
    async (seen) => {
      const out = await fetchWordPressProbes('https://example.com/wp/blog/', targets);
      assert.equal(MAX_PROBES, 5);
      assert.equal(seen.length, 5);
      assert.equal(out.count, 5);
      for (const s of seen) {
        assert.equal(s.opts.credentials, 'omit');
        assert.equal(s.opts.redirect, 'manual');
      }
      assert.equal(out.feed.error, 'HTTP 404');
      assert.match(out.rest.text, /yoast/);
      assert.equal(out.themes.length, 2);
      assert.match(out.opml.text, /7\.1\.3/, 'the feed failed, so wp-links-opml.php is asked');
    },
  );
});

test('fetchWordPressProbes: wp-links-opml.php only while the core version is unknown', async () => {
  const answer = (url) => new Response(url.endsWith('/feed/') ? '<generator>https://wordpress.org/?v=7.1.3</generator>' : '{}');
  await withFetch(answer, async (seen) => {
    const out = await fetchWordPressProbes('https://example.com/wp/', targets);
    assert.equal(out.opml, undefined, 'the feed gave it');
    assert.ok(!seen.some((s) => s.url.includes('opml')));
  });
  await withFetch(() => new Response('{}'), async (seen) => {
    await fetchWordPressProbes('https://example.com/wp/', targets, { coreKnown: true });
    assert.ok(!seen.some((s) => s.url.includes('opml')), 'the page gave it');
  });
});

test('fetchWordPressProbes refuses another origin, readme.txt, wp-login.php, wp-admin and odd shapes', async () => {
  await withFetch(() => new Response('{}'), async (seen) => {
    const out = await fetchWordPressProbes('https://example.com/', {
      feed: 'https://evil.example/feed/',
      rest: 'https://example.com/wp-admin/admin-ajax.php?_fields=namespaces',
      opml: 'https://example.com/readme.txt',
      themes: [
        { slug: 'a', url: 'https://example.com/wp-login.php' },
        { slug: 'b', url: 'https://example.com/wp-content/plugins/x/readme.txt' },
        { slug: 'c', url: 'https://example.com/wp-content/themes/c/functions.php' },
        { slug: 'd', url: 'javascript:alert(1)' },
      ],
    });
    assert.equal(seen.length, 0);
    assert.equal(out.count, 0);
    assert.equal((await fetchWordPressProbes('not a url', targets)).error, 'Invalid URL');
  });
});

test('fetchWordPressProbes never throws, and reads at most 1 MB of an answer', async () => {
  await withFetch(
    () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      const out = await fetchWordPressProbes('https://example.com/wp/', targets);
      assert.equal(out.feed.error, 'Failed to fetch');
    },
  );
  await withFetch(
    () => new Response(null, { status: 301, headers: { location: 'https://example.com/wp-login.php' } }),
    async () => {
      const out = await fetchWordPressProbes('https://example.com/wp/', targets);
      assert.equal(out.rest.error, 'Redirected, not followed');
    },
  );
  assert.equal(PROBE_BYTES, 1024 * 1024);
  let pulled = 0;
  const chunk = new Uint8Array(256 * 1024).fill(97);
  const stream = new ReadableStream({
    pull(c) {
      pulled++;
      c.enqueue(chunk);
    },
  });
  const read = await readCapped(new Response(stream), PROBE_BYTES);
  assert.equal(read.text.length, PROBE_BYTES);
  assert.equal(read.capped, true);
  assert.ok(pulled <= 6, `stopped reading (${pulled} chunks)`);
});

// ---- the page-world reader ----------------------------------------------------------

function fakeDocument(byId = {}, bySelector = {}) {
  return {
    getElementById: (id) => byId[id] ?? null,
    querySelector: (sel) => bySelector[sel] ?? null,
    querySelectorAll: () => [],
    documentElement: {},
    body: {},
  };
}

test('readTechState only reads: no page function is called, versions come back as plain strings', () => {
  const called = [];
  const fn = (name) => () => called.push(name);
  const poisoned = new Set(['5']);
  poisoned[Symbol.iterator] = () => {
    called.push('Set iterator');
    return [][Symbol.iterator]();
  };
  poisoned.forEach = fn('Set.forEach');
  globalThis.window = {
    next: { version: '16.5.0-canary.9', router: { push: fn('next.router.push') } },
    jQuery: Object.assign(fn('jQuery'), { fn: { jquery: '3.7.1' } }),
    gsap: { version: '3.13.0', to: fn('gsap.to') },
    Alpine: { version: '3.14.1', start: fn('Alpine.start') },
    htmx: { version: '2.0.4', ajax: fn('htmx.ajax') },
    Shopify: { theme: { name: '[DNAM Theme]', schema_name: 'allbirds-theme', schema_version: '1.231.12' } },
    elementorFrontendConfig: { version: '4.2.3' },
    __svelte: { v: poisoned },
    __sveltekit_1x2y3z: { base: '' },
    Drupal: { behaviors: {} },
    __NUXT__: {},
  };
  globalThis.document = fakeDocument({ __nuxt: { __vue_app__: { version: '3.5.43', $nuxt: { versions: { nuxt: '4.6.1', vue: '3.5.43' } }, mount: fn('mount') } } });
  let out;
  try {
    out = readTechState();
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
  assert.deepEqual(called, [], 'no page function was called, the Set was not iterated');
  assert.deepEqual(out.values, {
    'next.version': '16.5.0-canary.9',
    'nuxt.version': '4.6.1',
    'nuxt.vue': '3.5.43',
    'vue.version': '3.5.43',
    'jquery.version': '3.7.1',
    'gsap.version': '3.13.0',
    'alpine.version': '3.14.1',
    'htmx.version': '2.0.4',
    'elementor.version': '4.2.3',
    'shopify.theme.name': '[DNAM Theme]',
    'shopify.theme.schema_name': 'allbirds-theme',
    'shopify.theme.schema_version': '1.231.12',
    'svelte.version': '5',
  });
  assert.deepEqual(out.flags.sort(), ['drupal', 'nuxt', 'shopify.theme', 'sveltekit'].sort());
  for (const v of Object.values(out.values)) assert.equal(typeof v, 'string');
});

test('readTechState survives a page whose globals throw on every read, and ignores non-strings', () => {
  globalThis.window = new Proxy(
    {},
    {
      get() {
        throw new Error('nope');
      },
      ownKeys() {
        throw new Error('nope');
      },
    },
  );
  let out;
  try {
    assert.doesNotThrow(() => (out = readTechState()));
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(out, { values: {}, flags: [] });
  globalThis.window = { next: { version: { toString: () => '1.0.0' } }, gsap: { version: 3 } };
  try {
    out = readTechState();
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(out.values, { 'gsap.version': '3' }, 'objects are dropped, numbers become strings');
});
