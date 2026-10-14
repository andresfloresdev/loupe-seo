// Tech catalog and detection. Pure: no DOM, no browser APIs, unit-tested in
// Node (tests/unit/tech.test.js).
//
// The catalog is data, like lib/trackers.js: the quarterly upkeep (LOUPE-03)
// updates fingerprints here, never in the UI. Written from scratch for Loupe
// (MIT); no third-party fingerprint data.
//
// Each entry says how to find one technology, and its version when the site
// gives it away, from read-only sources:
// - generator: every <meta name="generator">;
// - url: script src, stylesheet and preload hrefs, the requests the page made;
// - inline: inline script text; comment: HTML comments; body: <body> classes;
// - dom: attributes and elements (lib/inject.js collectTechSignals);
// - live: globals read in the page's own world (lib/inject.js readTechState);
// - header: the page's response headers (lib/net.js fetchPageHeaders);
// - ns: WordPress REST namespaces (the site's /wp-json/?_fields=namespaces).
// A version is "confirmed" when the site states it, "likely" when inferred.
// No version found: none is shown, never a guess.

import { parseVersion, cleanVersion, isExact, wpCoreStatus, latestStatus } from './versions.js';

// One pattern; capture group 1, when there is one and it matched, is the version.
// `rank` orders version sources (lower wins), `likely` marks an inferred version.
function p(source, label, { rank, likely, flags = 'i' } = {}) {
  return { re: new RegExp(source, flags), label, rank, likely };
}
// A response header pattern.
const hd = (name, source, label, opts) => ({ ...p(source, label ?? `${name} header`, opts), name });
// A DOM or live key. `version`: its value is the version.
const k = (key, label, opts = {}) => ({ key, label, ...opts });

const RANK = { generator: 1, live: 2, dom: 2, header: 3, body: 4, comment: 4, url: 5, inline: 6, ns: 7 };
const V3 = String.raw`(\d+\.\d+(?:\.\d+)?)`;
const VER = String.raw`(\d+(?:\.\d+){1,3})`;
// `ver=` in a query string, after `?` or another parameter.
const VERQ = String.raw`\?(?:[^#\s"'<>]*?&(?:amp;)?)?ver=`;

export const GROUPS = [
  { id: 'platform', name: 'Platform' },
  { id: 'framework', name: 'Frameworks and libraries' },
  { id: 'wordpress', name: 'WordPress theme and plugins' },
  { id: 'hosting', name: 'Hosting and CDN' },
  { id: 'server', name: 'Server and language' },
];

// group 'plugin' entries are WordPress plugins: `wp` lists their folder names
// under wp-content/plugins/, `wporg` their wordpress.org slug (false: not on
// wordpress.org, so no lookup), `ns` their REST namespace prefixes.
export const TECH = [
  // ---------------------------------------------------------------- platform
  {
    id: 'wordpress',
    name: 'WordPress',
    group: 'platform',
    generator: [p(String.raw`^WordPress(?:\s+${V3}(?![\w.]))?(?![\w-])`, 'generator')],
    url: [
      // WordPress stamps its own version on core stylesheets. Never its bundled
      // scripts: wp-includes/js/jquery/ carries jQuery's, js/dist/ hashes.
      p(String.raw`/wp-includes/(?:css|blocks)/[^?#\s]*${VERQ}${V3}(?![\w.])`, 'core stylesheet', { rank: 2 }),
      p(String.raw`/wp-includes/js/wp-emoji-release\.min\.js${VERQ}${V3}(?![\w.])`, 'wp-emoji-release.min.js', { rank: 2 }),
      p(String.raw`/wp-includes/`, 'wp-includes/ asset'),
      p(String.raw`/wp-content/(?:themes|plugins)/`, 'wp-content/ asset'),
    ],
    inline: [p(String.raw`wp-emoji-release\.min\.js\?ver=${V3}(?![\w.])`, 'emoji settings (wp-emoji-release.min.js)', { rank: 2 })],
    header: [hd('link', String.raw`rel="?https://api\.w\.org/`, 'REST API link header'), hd('x-pingback', String.raw`/xmlrpc\.php`)],
    dom: [k('restLink', 'REST API link (api.w.org)')],
    body: [p(String.raw`(?:^|\s)wp-(?:child-)?theme-[\w-]+`, 'body class')],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    group: 'platform',
    implies: ['wordpress'],
    wp: ['woocommerce'],
    wporg: 'woocommerce',
    generator: [p(String.raw`^WooCommerce\s+${VER}`, 'generator')],
    body: [p(String.raw`(?:^|\s)woocommerce(?:-[\w-]+)?(?=\s|$)`, 'body class')],
    ns: ['wc/', 'wc-'],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    group: 'platform',
    live: [k('shopify.theme', 'live Shopify.theme')],
    inline: [p(String.raw`\bShopify\.theme\s*=\s*\{`, 'Shopify.theme in an inline script')],
    url: [p(String.raw`^https?://cdn\.shopify\.com/shopifycloud/`, 'cdn.shopify.com/shopifycloud/ script'), p(String.raw`/cdn/shop/t/\d+/assets/`, 'theme asset (/cdn/shop/t/)')],
    header: [hd('powered-by', String.raw`^Shopify\b`), hd('x-shopid', '.'), hd('x-shopify-stage', '.')],
  },
  {
    id: 'drupal',
    name: 'Drupal',
    group: 'platform',
    generator: [p(String.raw`^Drupal(?:\s+(\d+(?:\.\d+)*))?(?![\w.])`, 'generator')],
    header: [hd('x-generator', String.raw`^Drupal(?:\s+(\d+(?:\.\d+)*))?(?![\w.])`), hd('x-drupal-cache', '.'), hd('x-drupal-dynamic-cache', '.')],
    url: [p(String.raw`/core/misc/drupal(?:\.init)?\.js`, 'core/misc/drupal.js'), p(String.raw`/sites/(?:default|all)/(?:files|themes|modules)/[^?#\s]+\.(?:css|js)(?:[?#]|$)`, 'sites/default/ asset')],
    live: [k('drupal', 'live Drupal global')],
  },
  {
    id: 'joomla',
    name: 'Joomla',
    group: 'platform',
    generator: [p(String.raw`^Joomla!?(?:\s+(\d+(?:\.\d+)*))?(?![\w.])`, 'generator')],
    url: [p(String.raw`/media/(?:jui|system)/js/`, 'media/system/js/ script'), p(String.raw`/media/templates/site/`, 'media/templates/site/ asset')],
    live: [k('joomla', 'live Joomla global')],
  },
  {
    id: 'wix',
    name: 'Wix',
    group: 'platform',
    generator: [p(String.raw`^Wix\.com Website Builder`, 'generator')],
    header: [hd('x-wix-request-id', '.'), hd('server', String.raw`^Pepyaka\b`, 'server header (Pepyaka)')],
    url: [p(String.raw`^https?://static\.parastorage\.com/`, 'static.parastorage.com asset')],
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    group: 'platform',
    header: [hd('server', String.raw`^Squarespace\b`)],
    url: [p(String.raw`^https?://(?:static1|assets)\.squarespace\.com/[^?#\s]*\.(?:js|css)(?:[?#]|$)`, 'squarespace.com script')],
    inline: [p(String.raw`\bSQUARESPACE_CONTEXT\b`, 'Static.SQUARESPACE_CONTEXT')],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    group: 'platform',
    generator: [p(String.raw`^Webflow\b`, 'generator')],
    dom: [k('wfSite', 'data-wf-site attribute')],
    url: [p(String.raw`website-files\.com/[^?#\s]*\.(?:js|css)(?:[?#]|$)`, 'website-files.com asset')],
    live: [k('webflow', 'live Webflow global')],
  },
  {
    id: 'framer',
    name: 'Framer',
    group: 'platform',
    generator: [p(String.raw`^Framer\b`, 'generator')],
    header: [hd('server', String.raw`^Framer\b`)],
    url: [p(String.raw`^https?://framerusercontent\.com/[^?#\s]*\.m?js(?:[?#]|$)`, 'framerusercontent.com script')],
  },
  {
    id: 'ghost',
    name: 'Ghost',
    group: 'platform',
    generator: [p(String.raw`^Ghost(?:\s+${VER})?(?![\w.])`, 'generator')],
    url: [p(String.raw`/ghost/(?:portal|sodo-search)@`, 'Ghost Portal script'), p(String.raw`/public/cards\.min\.(?:js|css)`, 'Ghost cards asset')],
  },
  {
    id: 'hubspot-cms',
    name: 'HubSpot CMS',
    group: 'platform',
    generator: [p(String.raw`^HubSpot\b`, 'generator')],
    url: [p(String.raw`^https?://[^/]+/_hcms/`, '/_hcms/ request'), p(String.raw`^https?://[^/]+/hs/hsstatic/`, '/hs/hsstatic/ asset')],
  },

  // ---------------------------------------------------------------- frameworks
  {
    id: 'nextjs',
    name: 'Next.js',
    group: 'framework',
    npm: 'next',
    implies: ['react'],
    live: [k('next.version', 'window.next.version', { version: true })],
    header: [hd('x-powered-by', String.raw`^Next\.js(?:\s+${VER})?`), hd('x-nextjs-cache', '.'), hd('x-nextjs-prerender', '.')],
    dom: [k('nextData', '#__NEXT_DATA__ script (pages router)')],
    inline: [p(String.raw`\bself\.__next_f\b`, 'self.__next_f payload (app router)')],
    url: [p(String.raw`/_next/static/`, '/_next/static/ asset')],
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    group: 'framework',
    npm: 'nuxt',
    implies: ['vue'],
    live: [k('nuxt.version', '#__nuxt app, $nuxt.versions.nuxt', { version: true }), k('nuxt', 'live __NUXT__ or $nuxt global')],
    dom: [k('nuxtRoot', '#__nuxt element'), k('nuxtData', '#__NUXT_DATA__ script')],
    header: [hd('x-powered-by', String.raw`^Nuxt\b`)],
    inline: [p(String.raw`\bwindow\.__NUXT__\s*=`, 'window.__NUXT__ payload')],
    url: [p(String.raw`/_nuxt/`, '/_nuxt/ asset')],
  },
  {
    id: 'astro',
    name: 'Astro',
    group: 'framework',
    npm: 'astro',
    generator: [p(String.raw`^Astro\s+v(\d+\.\d+\.\d+(?:-[\w.]+)?)`, 'generator')],
    dom: [k('astroIsland', '<astro-island> elements'), k('astroCid', 'data-astro-cid-* attributes')],
    url: [p(String.raw`^https?://[^/]+/_astro/`, '/_astro/ asset')],
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    group: 'framework',
    implies: ['svelte'],
    live: [k('sveltekit', 'live __sveltekit_* global')],
    dom: [k('svelteKitAttr', 'data-sveltekit-* attributes')],
    inline: [p(String.raw`\b__sveltekit_[a-z0-9]+\b`, '__sveltekit_ bootstrap script')],
    url: [p(String.raw`/_app/immutable/`, '/_app/immutable/ asset')],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    group: 'framework',
    live: [k('svelte.version', 'window.__svelte.v (major version only)', { version: true })],
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    group: 'framework',
    npm: 'gatsby',
    implies: ['react'],
    generator: [p(String.raw`^Gatsby\s+(\d+\.\d+\.\d+)`, 'generator')],
    dom: [k('gatsbyRoot', '#___gatsby element')],
    live: [k('gatsby', 'live ___loader global')],
    url: [p(String.raw`/page-data/[^?#\s]*\.json`, 'page-data request')],
  },
  {
    id: 'remix',
    name: 'Remix / React Router',
    group: 'framework',
    implies: ['react'],
    live: [k('reactrouter.version', 'window.__reactRouterVersion (major version only)', { version: true }), k('remix', 'live __remixContext global'), k('reactrouter', 'live __reactRouterContext global')],
    inline: [p(String.raw`\bwindow\.__(?:remix|reactRouter)Context\s*=`, 'router context script')],
  },
  {
    id: 'angular',
    name: 'Angular',
    group: 'framework',
    npm: '@angular/core',
    dom: [k('ngVersion', 'ng-version attribute', { version: true })],
  },
  {
    id: 'vue',
    name: 'Vue',
    group: 'framework',
    npm: 'vue',
    live: [k('vue.version', 'live __vue_app__.version', { version: true }), k('nuxt.vue', '#__nuxt app, $nuxt.versions.vue', { version: true }), k('vue2.version', 'live Vue.version', { version: true })],
    dom: [k('vueApp', 'data-v-app attribute')],
  },
  {
    id: 'react',
    name: 'React',
    group: 'framework',
    live: [k('react.version', 'live React.version', { version: true }), k('react', 'React fiber on DOM nodes')],
    dom: [k('reactRoot', 'data-reactroot attribute')],
  },
  {
    id: 'preact',
    name: 'Preact',
    group: 'framework',
    live: [k('preact', 'Preact vnode on DOM nodes'), k('preact.global', 'live preact global')],
  },
  {
    id: 'alpine',
    name: 'Alpine.js',
    group: 'framework',
    live: [k('alpine.version', 'window.Alpine.version', { version: true })],
    url: [p(String.raw`/alpinejs@(\d+\.\d+\.\d+)/`, 'alpinejs script'), p(String.raw`/alpine(?:js)?(?:\.min)?\.js(?:[?#]|$)`, 'alpine.js script')],
  },
  {
    id: 'htmx',
    name: 'htmx',
    group: 'framework',
    live: [k('htmx.version', 'window.htmx.version', { version: true })],
    dom: [k('htmxAttr', 'hx-* attributes')],
    url: [p(String.raw`/htmx\.org@(\d+\.\d+\.\d+)/`, 'htmx.org script'), p(String.raw`/htmx(?:\.min)?\.js(?:[?#]|$)`, 'htmx.js script')],
  },
  {
    id: 'jquery',
    name: 'jQuery',
    group: 'framework',
    npm: 'jquery',
    live: [k('jquery.version', 'jQuery.fn.jquery', { version: true })],
    url: [
      p(String.raw`/wp-includes/js/jquery/jquery(?:\.min)?\.js${VERQ}(\d+\.\d+\.\d+)(?![\w.])`, 'WordPress jquery.js'),
      p(String.raw`/jquery[.-](\d+\.\d+\.\d+)(?:\.slim)?(?:\.min)?\.js(?:[?#]|$)`, 'jquery-X.js'),
      p(String.raw`/ajax/libs/jquery/(\d+\.\d+\.\d+)/`, 'jQuery from a CDN'),
      p(String.raw`/jquery@(\d+\.\d+\.\d+)/`, 'jQuery from a CDN'),
    ],
  },
  {
    id: 'gsap',
    name: 'GSAP',
    group: 'framework',
    live: [k('gsap.version', 'window.gsap.version', { version: true })],
    url: [p(String.raw`/gsap@(\d+\.\d+\.\d+)/`, 'GSAP from a CDN'), p(String.raw`/ajax/libs/gsap/(\d+\.\d+\.\d+)/`, 'GSAP from a CDN'), p(String.raw`/gsap(?:\.min)?\.js(?:[?#]|$)`, 'gsap.js script')],
  },

  // ---------------------------------------------------------------- WordPress plugins
  {
    id: 'elementor',
    name: 'Elementor',
    group: 'plugin',
    wp: ['elementor'],
    wporg: 'elementor',
    generator: [p(String.raw`^Elementor\s+(\d+\.\d+\.\d+)`, 'generator')],
    live: [k('elementor.version', 'elementorFrontendConfig.version', { version: true })],
  },
  { id: 'elementor-pro', name: 'Elementor Pro', group: 'plugin', wp: ['elementor-pro'], wporg: false },
  {
    id: 'wpbakery',
    name: 'WPBakery',
    group: 'plugin',
    wp: ['js_composer'],
    wporg: false,
    generator: [p(String.raw`^Powered by WPBakery Page Builder`, 'generator')],
    body: [p(String.raw`(?:^|\s)js-comp-ver-${VER}`, 'body class')],
  },
  {
    id: 'divi',
    name: 'Divi',
    group: 'plugin',
    wp: ['divi-builder'],
    wporg: false,
    generator: [p(String.raw`^Divi\s+v\.?${VER}`, 'generator')],
    url: [p(String.raw`/themes/Divi/`, 'Divi theme asset')],
    body: [p(String.raw`(?:^|\s)et_divi_theme(?:\s|$)`, 'body class')],
  },
  {
    id: 'beaver-builder',
    name: 'Beaver Builder',
    group: 'plugin',
    wp: ['bb-plugin', 'beaver-builder-lite-version'],
    wporg: 'beaver-builder-lite-version',
    body: [p(String.raw`(?:^|\s)fl-builder(?:\s|$)`, 'body class')],
  },
  {
    id: 'bricks',
    name: 'Bricks',
    group: 'plugin',
    wporg: false,
    url: [p(String.raw`/themes/bricks/`, 'Bricks theme asset')],
    body: [p(String.raw`(?:^|\s)brx-body(?:\s|$)`, 'body class')],
  },
  {
    id: 'yoast',
    name: 'Yoast SEO',
    group: 'plugin',
    wp: ['wordpress-seo', 'wordpress-seo-premium'],
    wporg: 'wordpress-seo',
    comment: [p(String.raw`optimized with the Yoast SEO(?: Premium)? plugin v(\d+\.\d+(?:\.\d+)?(?:-RC\d+)?)`, 'comment')],
    ns: ['yoast/'],
  },
  {
    id: 'rank-math',
    name: 'Rank Math',
    group: 'plugin',
    wp: ['seo-by-rank-math', 'seo-by-rank-math-pro'],
    wporg: 'seo-by-rank-math',
    comment: [p(String.raw`Search Engine Optimization by Rank Math`, 'comment')],
    ns: ['rankmath/'],
  },
  {
    id: 'aioseo',
    name: 'All in One SEO',
    group: 'plugin',
    wp: ['all-in-one-seo-pack', 'all-in-one-seo-pack-pro'],
    wporg: 'all-in-one-seo-pack',
    generator: [p(String.raw`^All in One SEO(?: Pro)?(?: \(AIOSEOP?\))?\s+${VER}`, 'generator')],
    comment: [p(String.raw`All in One SEO(?: Pro)?\s+${VER}`, 'comment')],
    ns: ['aioseo/'],
  },
  {
    id: 'wpml',
    name: 'WPML',
    group: 'plugin',
    wp: ['sitepress-multilingual-cms'],
    wporg: false,
    generator: [p(String.raw`^WPML ver:${VER}`, 'generator')],
    ns: ['wpml/'],
  },
  { id: 'polylang', name: 'Polylang', group: 'plugin', wp: ['polylang', 'polylang-pro'], wporg: 'polylang', ns: ['pll/'] },
  { id: 'cf7', name: 'Contact Form 7', group: 'plugin', wp: ['contact-form-7'], wporg: 'contact-form-7', ns: ['contact-form-7/'] },
  { id: 'gravityforms', name: 'Gravity Forms', group: 'plugin', wp: ['gravityforms'], wporg: false, ns: ['gf/'] },
  { id: 'wpforms', name: 'WPForms', group: 'plugin', wp: ['wpforms-lite', 'wpforms'], wporg: 'wpforms-lite', ns: ['wpforms/'] },
  { id: 'ninja-forms', name: 'Ninja Forms', group: 'plugin', wp: ['ninja-forms'], wporg: 'ninja-forms', ns: ['ninja-forms'] },
  {
    id: 'revslider',
    name: 'Slider Revolution',
    group: 'plugin',
    wp: ['revslider'],
    wporg: false,
    generator: [p(String.raw`^Powered by Slider Revolution\s+${VER}`, 'generator')],
  },
  {
    id: 'wp-rocket',
    name: 'WP Rocket',
    group: 'plugin',
    wp: ['wp-rocket'],
    wporg: false,
    comment: [p(String.raw`optimized by WP Rocket|This website is like a Rocket`, 'comment')],
  },
  {
    id: 'litespeed-cache',
    name: 'LiteSpeed Cache',
    group: 'plugin',
    wp: ['litespeed-cache'],
    wporg: 'litespeed-cache',
    comment: [p(String.raw`Page (?:optimized|cached|generated) by LiteSpeed Cache(?:\s+${VER})?`, 'comment')],
  },
  {
    id: 'w3tc',
    name: 'W3 Total Cache',
    group: 'plugin',
    wp: ['w3-total-cache'],
    wporg: 'w3-total-cache',
    comment: [p(String.raw`optimized by W3 Total Cache`, 'comment')],
    header: [hd('x-powered-by', String.raw`W3 Total Cache(?:/${VER})?`)],
  },
  { id: 'wordfence', name: 'Wordfence', group: 'plugin', wp: ['wordfence'], wporg: 'wordfence', ns: ['wordfence/'] },
  { id: 'jetpack', name: 'Jetpack', group: 'plugin', wp: ['jetpack'], wporg: 'jetpack', ns: ['jetpack/'] },
  { id: 'akismet', name: 'Akismet', group: 'plugin', wp: ['akismet'], wporg: 'akismet', ns: ['akismet/'] },
  { id: 'ai1wm', name: 'All-in-One WP Migration', group: 'plugin', wp: ['all-in-one-wp-migration'], wporg: 'all-in-one-wp-migration', ns: ['ai1wm/'] },
  { id: 'smush', name: 'Smush', group: 'plugin', wp: ['wp-smushit', 'wp-smush-pro'], wporg: 'wp-smushit', ns: ['wp-smush/'] },
  { id: 'redirection', name: 'Redirection', group: 'plugin', wp: ['redirection'], wporg: 'redirection', ns: ['redirection/'] },

  // ---------------------------------------------------------------- hosting and CDN
  { id: 'cloudflare', name: 'Cloudflare', group: 'hosting', header: [hd('cf-ray', '.'), hd('server', String.raw`^cloudflare\b`), hd('cf-cache-status', '.')] },
  { id: 'vercel', name: 'Vercel', group: 'hosting', header: [hd('x-vercel-id', '.'), hd('x-vercel-cache', '.'), hd('server', String.raw`^Vercel\b`)] },
  { id: 'netlify', name: 'Netlify', group: 'hosting', header: [hd('x-nf-request-id', '.'), hd('server', String.raw`^Netlify\b`)] },
  { id: 'wp-engine', name: 'WP Engine', group: 'hosting', header: [hd('x-powered-by', String.raw`^WP Engine\b`), hd('wpe-backend', '.')] },
  { id: 'kinsta', name: 'Kinsta', group: 'hosting', header: [hd('x-kinsta-cache', '.')] },
  { id: 'wordpress-vip', name: 'WordPress VIP', group: 'hosting', header: [hd('x-powered-by', String.raw`^WordPress VIP\b`)] },
  { id: 'pantheon', name: 'Pantheon', group: 'hosting', header: [hd('x-pantheon-styx-hostname', '.'), hd('x-styx-req-id', '.')] },
  { id: 'elementor-cloud', name: 'Elementor Cloud', group: 'hosting', header: [hd('x-powered-by', String.raw`^Elementor Cloud\b`)] },
  { id: 'fly', name: 'Fly.io', group: 'hosting', header: [hd('fly-request-id', '.'), hd('server', String.raw`^Fly/`)] },
  { id: 'cloudfront', name: 'CloudFront', group: 'hosting', header: [hd('x-amz-cf-id', '.'), hd('via', String.raw`\(CloudFront\)`), hd('x-cache', String.raw`\bfrom cloudfront\b`)] },
  { id: 'fastly', name: 'Fastly', group: 'hosting', header: [hd('x-served-by', String.raw`^cache-[a-z0-9-]+$`), hd('x-fastly-request-id', '.')] },
  { id: 'akamai', name: 'Akamai', group: 'hosting', header: [hd('server', String.raw`^Akamai(?:GHost|NetStorage)\b`), hd('akamai-grn', '.'), hd('x-akamai-transformed', '.'), hd('akamai-cache-status', '.')] },
  { id: 'github-pages', name: 'GitHub Pages', group: 'hosting', header: [hd('server', String.raw`^GitHub\.com$`), hd('x-github-request-id', '.')] },

  // ---------------------------------------------------------------- server and language
  { id: 'nginx', name: 'nginx', group: 'server', header: [hd('server', String.raw`^nginx(?:/${VER})?(?![\w.])`)] },
  { id: 'apache', name: 'Apache', group: 'server', header: [hd('server', String.raw`^Apache(?:/${VER})?(?![\w.-])`)] },
  { id: 'litespeed', name: 'LiteSpeed', group: 'server', header: [hd('server', String.raw`^LiteSpeed\b`)] },
  { id: 'iis', name: 'IIS', group: 'server', header: [hd('server', String.raw`^Microsoft-IIS(?:/${VER})?(?![\w.])`)] },
  { id: 'openresty', name: 'OpenResty', group: 'server', header: [hd('server', String.raw`^openresty(?:/${VER})?(?![\w.])`)] },
  { id: 'caddy', name: 'Caddy', group: 'server', header: [hd('server', String.raw`^Caddy\b`), hd('via', String.raw`\bCaddy\b`)] },
  { id: 'php', name: 'PHP', group: 'server', header: [hd('x-powered-by', String.raw`^PHP(?:/${VER})?(?![\w.])`)] },
  { id: 'aspnet', name: 'ASP.NET', group: 'server', header: [hd('x-powered-by', String.raw`^ASP\.NET\b`), hd('x-aspnet-version', String.raw`^${VER}`)] },
  { id: 'express', name: 'Express', group: 'server', header: [hd('x-powered-by', String.raw`^Express\b`)] },
];

const BY_ID = new Map(TECH.map((t) => [t.id, t]));
export const techById = (id) => BY_ID.get(id);
const PLUGIN_BY_DIR = new Map(TECH.flatMap((t) => (t.wp ?? []).map((dir) => [dir.toLowerCase(), t])));

// ---- helpers ---------------------------------------------------------------

const clip = (s, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : []);
const validVersion = (v) => typeof v === 'string' && v.length <= 40 && !!parseVersion(v);

// A URL as evidence: its path and query, shortened from the left.
function shortUrl(url) {
  let s = String(url);
  try {
    const u = new URL(s);
    s = u.pathname + u.search;
  } catch {}
  return s.length > 80 ? `…${s.slice(-79)}` : s;
}

// A plugin asset's ?ver= is its version unless it is a timestamp, a date or a
// hash: dotted numbers only, and not starting with a year.
export function isAssetVersion(v) {
  if (!/^\d{1,4}(?:\.\d{1,4}){1,3}(?:-[0-9A-Za-z.]+)?$/.test(String(v ?? ''))) return false;
  const first = Number(String(v).split('.')[0]);
  return !(first >= 1990 && first <= 2100);
}

// ---- WordPress probes: what the site's own URLs answer -----------------------

// <generator>https://wordpress.org/?v=7.1.3</generator> in the RSS feed.
export function wpVersionFromFeed(text) {
  const m = /<generator>\s*https?:\/\/wordpress\.org\/\?v=(\d+\.\d+(?:\.\d+)?)\s*<\/generator>/i.exec(String(text ?? ''));
  return m ? m[1] : null;
}

// <!-- generator="WordPress/6.7.10" --> in /wp-links-opml.php.
export function wpVersionFromOpml(text) {
  const m = /generator="WordPress\/(\d+\.\d+(?:\.\d+)?)"/i.exec(String(text ?? ''));
  return m ? m[1] : null;
}

// The namespaces of /wp-json/?_fields=namespaces. A site that ignores _fields
// sends the whole index, cut at 1 MB: the list sits near the top, so it is
// read from the raw text when the JSON can't be parsed.
export function parseNamespaces(text) {
  const t = String(text ?? '');
  let list = null;
  try {
    const json = JSON.parse(t);
    if (Array.isArray(json?.namespaces)) list = json.namespaces;
  } catch {
    const m = /"namespaces"\s*:\s*\[([^\]]{0,20000})\]/.exec(t);
    if (m) list = [...m[1].matchAll(/"((?:[^"\\]|\\.){1,100})"/g)].map((x) => x[1].replace(/\\\//g, '/'));
  }
  return [...new Set(strings(list).map((s) => s.slice(0, 100)))].slice(0, 200);
}

// The header of a theme's style.css (WordPress reads the first 8 KB).
export function parseThemeHeader(text) {
  const head = String(text ?? '').slice(0, 8192);
  const field = (name) => {
    const m = new RegExp(String.raw`^[ \t/*#@]*${name}:(.*)$`, 'mi').exec(head);
    const v = m ? clip(m[1].replace(/\*\/.*$/, ''), 80) : '';
    return v || null;
  };
  return { name: field('Theme Name'), version: field('Version'), template: field('Template') };
}

// Which catalog plugin a REST namespace belongs to.
export function namespacePlugin(ns) {
  for (const t of TECH) for (const prefix of t.ns ?? []) if (ns === prefix.replace(/\/$/, '') || ns.startsWith(prefix)) return t;
  return null;
}
// Namespaces WordPress itself registers.
const CORE_NS = /^(?:wp\/v2|oembed\/1\.0|wp-site-health\/v1|wp-block-editor\/v1|wp-abilities\/v1|wp\/v\d)$/;

// ---- detection --------------------------------------------------------------

// signals: collectTrackerSignals() and collectTechSignals() merged, plus
// `live` from readTechState() (or null). headers: the page's response headers
// (or null). probes: fetchWordPressProbes()'s answer, on WordPress pages.
// Returns { tech, wordpress, checked }.
export function detectTech(signals, headers = null, probes = null) {
  const s = signals ?? {};
  const urls = [...new Set([...(s.scripts ?? []).map((x) => x?.src), ...strings(s.links), ...strings(s.resources)].filter((u) => typeof u === 'string' && u))];
  const gens = strings(s.generators);
  const inline = strings(s.inline);
  const comments = strings(s.comments);
  const body = typeof s.bodyClass === 'string' ? s.bodyClass : '';
  const dom = s.dom && typeof s.dom === 'object' ? s.dom : {};
  const live = s.live && typeof s.live === 'object' ? s.live : null;
  const hdrs = {};
  for (const [name, value] of Object.entries(headers ?? {})) if (typeof value === 'string') hdrs[name.toLowerCase()] = value;

  const evidence = new Map(); // id -> [{ text, version, rank, likely }]
  const add = (t, text, version, rank, likely = false) => {
    const list = evidence.get(t.id) ?? [];
    const v = version && validVersion(version) ? version : null;
    // Twelve lines at most, but never at the cost of a version.
    if (!list.some((e) => e.text === text) && (list.length < 12 || v)) list.push({ text, version: v, rank, likely });
    evidence.set(t.id, list);
  };
  const ver = (m) => (m && m[1] !== undefined ? m[1] : null);

  for (const t of TECH) {
    for (const pat of t.generator ?? []) {
      for (const g of gens) {
        const m = pat.re.exec(g);
        if (m) add(t, `generator "${clip(g, 80)}"`, ver(m), pat.rank ?? RANK.generator);
      }
    }
    for (const pat of t.url ?? []) {
      let n = 0;
      for (const url of urls) {
        const m = pat.re.exec(url);
        if (!m || n >= 3) continue;
        n++;
        add(t, `${pat.label}: ${shortUrl(url)}`, ver(m), pat.rank ?? RANK.url);
      }
    }
    for (const pat of t.inline ?? []) {
      for (const text of inline) {
        const m = pat.re.exec(text);
        if (m) add(t, pat.label + (ver(m) ? ` (${ver(m)})` : ''), ver(m), pat.rank ?? RANK.inline);
      }
    }
    for (const pat of t.comment ?? []) {
      for (const c of comments) {
        const m = pat.re.exec(c);
        if (m) add(t, `comment "${clip(c, 80)}"`, ver(m), pat.rank ?? RANK.comment);
      }
    }
    for (const pat of t.header ?? []) {
      const value = hdrs[pat.name];
      if (!value) continue;
      for (const part of value.split(/,\s*/)) {
        const m = pat.re.exec(part.trim());
        if (m) {
          add(t, `${pat.name}: ${clip(value, 70)}`, ver(m), pat.rank ?? RANK.header);
          break;
        }
      }
    }
    for (const pat of t.body ?? []) {
      const m = pat.re.exec(body);
      if (m) add(t, `body class "${clip(m[0].trim(), 60)}"`, ver(m), pat.rank ?? RANK.body);
    }
    for (const d of t.dom ?? []) {
      const v = dom[d.key];
      if (!v) continue;
      const version = d.version && typeof v === 'string' ? v : null;
      add(t, version ? `${d.label} "${clip(v, 40)}"` : d.label, version, RANK.dom);
    }
    if (live) {
      for (const l of t.live ?? []) {
        const v = live.values?.[l.key];
        const flagged = Array.isArray(live.flags) && live.flags.includes(l.key);
        if (l.version) {
          if (typeof v === 'string' && v) add(t, `${l.label} = ${clip(v, 40)}`, v, RANK.live);
        } else if (flagged || (typeof v === 'string' && v)) add(t, l.label, null, RANK.live);
      }
    }
  }

  const wordpress = wordpressDetails({ urls, inline, body, probes, evidence, add });

  // Implied tech: Next.js implies React, a WordPress plugin implies WordPress.
  for (const t of TECH) {
    if (!evidence.has(t.id)) continue;
    const implies = [...(t.implies ?? []), ...(t.group === 'plugin' ? ['wordpress'] : [])];
    for (const id of implies) {
      if (!evidence.has(id)) evidence.set(id, []);
      const list = evidence.get(id);
      if (!list.length) list.push({ text: `implied by ${t.name}`, version: null, rank: 99, implied: true });
    }
  }
  // A WordPress plugin folder implies WordPress too.
  if (wordpress && !evidence.has('wordpress')) evidence.set('wordpress', [{ text: 'implied by its plugins or theme', version: null, rank: 99, implied: true }]);

  const rows = [];
  for (const t of TECH) {
    const list = evidence.get(t.id);
    if (!list?.length || t.group === 'plugin') continue;
    const picked = pickVersion(list);
    rows.push({
      key: t.id,
      id: t.id,
      name: t.name,
      group: t.group,
      version: picked ? cleanVersion(picked.version) : null,
      confidence: picked ? (picked.likely ? 'likely' : 'confirmed') : null,
      implied: list.every((e) => e.implied),
      npm: t.npm ?? null,
      detail: t.id === 'shopify' ? shopifyTheme(live, inline) : null,
      evidence: orderEvidence(list, picked),
    });
  }
  const groupOrder = GROUPS.map((g) => g.id);
  rows.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));

  const isWp = rows.some((r) => r.id === 'wordpress');
  return {
    tech: rows,
    wordpress: isWp ? wordpress ?? emptyWordpress(probes) : null,
    checked: {
      generators: gens.length,
      urls: urls.length,
      inline: inline.length,
      comments: comments.length,
      headers: Object.keys(hdrs).length > 0,
      live: !!live,
    },
  };
}

// The best version: the strongest source that gives one, then the most
// frequent value from that source.
// Evidence in order: what gave the version first, then by strength.
function orderEvidence(list, picked) {
  const gave = (e) => (picked && e.version === picked.version ? 0 : 1);
  return [...list].sort((a, b) => gave(a) - gave(b) || a.rank - b.rank).map((e) => e.text);
}

function pickVersion(list) {
  const withVersion = list.filter((e) => e.version);
  if (!withVersion.length) return null;
  const best = Math.min(...withVersion.map((e) => e.rank));
  const top = withVersion.filter((e) => e.rank === best);
  const counts = new Map();
  for (const e of top) counts.set(e.version, (counts.get(e.version) ?? 0) + 1);
  const version = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  return { version, likely: top.find((e) => e.version === version).likely };
}

function shopifyTheme(live, inline) {
  const v = live?.values ?? {};
  let name = typeof v['shopify.theme.schema_name'] === 'string' ? v['shopify.theme.schema_name'] : null;
  let version = typeof v['shopify.theme.schema_version'] === 'string' ? v['shopify.theme.schema_version'] : null;
  if (!name) {
    for (const text of inline) {
      const m = /\bShopify\.theme\s*=\s*(\{[^;]{0,600}?\})\s*;/.exec(text);
      if (!m) continue;
      try {
        const json = JSON.parse(m[1]);
        if (typeof json.schema_name === 'string') name = json.schema_name;
        if (typeof json.schema_version === 'string') version = json.schema_version;
      } catch {}
      break;
    }
  }
  if (!name) return null;
  return `Theme ${clip(name, 60)}${version ? ` ${clip(version, 20)}` : ''}`;
}

function emptyWordpress(probes) {
  return { themes: [], plugins: [], namespaces: [], otherNamespaces: [], probes: probeStatus(probes) };
}

const SLUG = String.raw`([A-Za-z0-9._-]{1,80})`;
const LIB_PATH = /\/(?:vendor|vendors|node_modules|bower_components|third-party)\//i;
// Libraries themes bundle with their own version in ?ver=.
const LIB_FILE = /(?:^|\/)(?:[^/]*[^a-z/])?(?:font-?awesome|bootstrap|jquery|swiper|slick|owl|fancybox|magnific|lightbox|select2|animate|aos|isotope|masonry|flickity|splide|glide|lottie|gsap|photoswipe|modernizr|normalize)(?:[^a-z/][^/]*)?$/i;

// Theme and plugins, the REST namespaces, and the WordPress core version from
// the probes (feed, then wp-links-opml.php, then a theme asset: likely).
function wordpressDetails({ urls, inline, body, probes, evidence, add }) {
  const wpTech = BY_ID.get('wordpress');
  // Paths with JSON-escaped slashes read like plain ones.
  const texts = [...urls, ...inline.map((t) => (t.includes('\\/') ? t.replace(/\\\//g, '/') : t))];

  // Theme folders: wp-content/themes/<slug>/, and the folder the body class
  // names (wp-theme-<slug>, wp-child-theme-<slug>) wherever it lives (Bedrock: /app/themes/).
  const bodyParent = /(?:^|\s)wp-theme-([\w-]{1,80})(?=\s|$)/.exec(body)?.[1] ?? null;
  const bodyChild = /(?:^|\s)wp-child-theme-([\w-]{1,80})(?=\s|$)/.exec(body)?.[1] ?? null;
  const contentDirs = new Set(['wp-content']);
  for (const slug of [bodyParent, bodyChild].filter(Boolean)) {
    const re = new RegExp(String.raw`/([\w.-]+)/themes/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'i');
    for (const u of urls) {
      const m = re.exec(u);
      if (m) {
        contentDirs.add(m[1]);
        break;
      }
    }
  }
  const dirs = [...contentDirs].map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pathRe = (kind) => new RegExp(String.raw`(https?://[^\s"'<>()]*?)?/(?:${dirs})/${kind}/${SLUG}/([^\s"'<>()?#\\]*)(?:\?([^\s"'<>()#\\]*))?`, 'g');

  // Plugins: every folder under plugins/, with the ?ver= of its assets.
  const pluginAssets = new Map(); // dir -> { versions: Map, urls: [] }
  for (const text of texts) {
    for (const m of text.matchAll(pathRe('plugins'))) {
      const dir = m[2];
      if (/^\.+$/.test(dir)) continue;
      const entry = pluginAssets.get(dir) ?? { versions: new Map(), urls: [] };
      const v = /(?:^|&(?:amp;)?)ver=([^&#]+)/.exec(m[4] ?? '')?.[1];
      if (v && !LIB_PATH.test(`/${m[3]}`) && !LIB_FILE.test(m[3])) entry.versions.set(v, (entry.versions.get(v) ?? 0) + 1);
      if (entry.urls.length < 2) entry.urls.push(m[0].slice(0, 300));
      pluginAssets.set(dir, entry);
      if (pluginAssets.size >= 100) break;
    }
  }

  // Themes: folders under themes/, child first.
  const themeBase = new Map(); // slug -> base URL (…/themes/<slug>/)
  const themeAssets = new Map(); // slug -> Map(ver -> count)
  for (const text of texts) {
    for (const m of text.matchAll(pathRe('themes'))) {
      const slug = m[2];
      if (!themeBase.has(slug) || (!themeBase.get(slug) && m[1])) themeBase.set(slug, m[1] ? m[0].slice(0, m[0].indexOf(`/themes/${slug}/`) + `/themes/${slug}/`.length) : null);
      const v = /(?:^|&(?:amp;)?)ver=([^&#]+)/.exec(m[4] ?? '')?.[1];
      // Not a bundled library's version (font-awesome.css?ver=4.4.0).
      if (v && !LIB_PATH.test(`/${m[3]}`) && !LIB_FILE.test(m[3]) && !m[3].includes(v)) {
        const counts = themeAssets.get(slug) ?? new Map();
        counts.set(v, (counts.get(v) ?? 0) + 1);
        themeAssets.set(slug, counts);
      }
      if (themeBase.size >= 10) break;
    }
  }
  for (const slug of [bodyChild, bodyParent]) if (slug && !themeBase.has(slug)) themeBase.set(slug, null);

  const ns = parseNamespaces(probes?.rest?.text);
  const isWp = evidence.has('wordpress') || pluginAssets.size > 0 || themeBase.size > 0 || TECH.some((t) => t.group === 'plugin' && evidence.has(t.id)) || ns.length > 0;
  if (!isWp) return null;

  // REST namespaces: the plugins they belong to, one evidence line each.
  const otherNamespaces = [];
  const byPlugin = new Map();
  for (const n of ns) {
    const t = namespacePlugin(n);
    if (t) byPlugin.set(t, [...(byPlugin.get(t) ?? []), n]);
    else if (!CORE_NS.test(n)) otherNamespaces.push(n);
  }
  for (const [t, list] of byPlugin) {
    const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
    add(t, `REST namespace${list.length > 1 ? 's' : ''} ${shown}`, null, RANK.ns);
  }

  // Core version from the probes.
  const feedVersion = wpVersionFromFeed(probes?.feed?.text);
  if (feedVersion) add(wpTech, `feed generator wordpress.org/?v=${feedVersion}`, feedVersion, 3);
  const opmlVersion = wpVersionFromOpml(probes?.opml?.text);
  if (opmlVersion) add(wpTech, `wp-links-opml.php generator WordPress/${opmlVersion}`, opmlVersion, 4);

  // Themes, with their style.css header when it was read.
  const themeHeaders = new Map();
  for (const t of probes?.themes ?? []) if (typeof t?.text === 'string') themeHeaders.set(t.slug, parseThemeHeader(t.text));
  const themes = [];
  for (const [slug] of themeBase) {
    const header = themeHeaders.get(slug) ?? null;
    const ev = [];
    if (slug === bodyChild) ev.push(`body class "wp-child-theme-${slug}"`);
    else if (slug === bodyParent) ev.push(`body class "wp-theme-${slug}"`);
    if (themeBase.get(slug)) ev.push(`assets under ${shortUrl(themeBase.get(slug))}`);
    if (header) ev.push(`style.css: Theme Name ${header.name ?? '(none)'}${header.version ? `, Version ${header.version}` : ''}${header.template ? `, Template ${header.template}` : ''}`);
    themes.push({
      key: `theme|${slug}`,
      slug,
      name: header?.name ?? slug,
      headerName: header?.name ?? null,
      version: header?.version ?? null,
      parent: header?.template ?? (slug === bodyChild && bodyParent && bodyParent !== slug ? bodyParent : null),
      child: slug === bodyChild || !!header?.template,
      base: themeBase.get(slug),
      wporg: /^[a-z0-9-]{1,100}$/.test(slug) ? slug : false,
      evidence: ev,
    });
  }
  // The active theme first (child, then its parent), then the rest.
  const order = (t) => (t.child ? 0 : themes.some((c) => c.parent === t.slug) || t.slug === bodyParent ? 1 : 2);
  themes.sort((a, b) => order(a) - order(b));
  for (const t of themes) if (!t.child && themes.some((c) => c.parent === t.slug)) t.parentOf = themes.find((c) => c.parent === t.slug).slug;

  // Likely: a theme asset with no version of its own gets WordPress's.
  const coreKnown = (evidence.get('wordpress') ?? []).some((e) => e.version);
  if (!coreKnown) {
    for (const t of themes) {
      const own = t.version;
      if (!own || !themeAssets.has(t.slug)) continue;
      const candidates = [...themeAssets.get(t.slug)].filter(([v]) => v !== own && /^(?:[3-9]|1\d)\.\d(?:\.\d{1,2})?$/.test(v));
      if (!candidates.length) continue;
      const v = candidates.sort((a, b) => b[1] - a[1])[0][0];
      add(wpTech, `theme asset ?ver=${v} under themes/${t.slug}/ (its style.css says ${own}): WordPress stamps its own version on assets without one`, v, 9, true);
      break;
    }
  }
  const core = pickVersion(evidence.get('wordpress') ?? []);
  const coreVersion = core?.version ?? null;

  // Plugins: catalog ones with their own evidence, then any other folder.
  const plugins = [];
  const seen = new Set();
  for (const [dir, assets] of pluginAssets) {
    const t = PLUGIN_BY_DIR.get(dir.toLowerCase());
    if (t?.group === 'platform') {
      // WooCommerce: a Platform row, versioned by its assets.
      const v = [...assets.versions].filter(([x]) => isAssetVersion(x) && x !== coreVersion).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      for (const u of assets.urls) add(t, `plugin asset: ${shortUrl(u)}`, v, RANK.url + 1);
      continue;
    }
    const id = t ? t.id : `slug:${dir}`;
    if (t) {
      for (const u of assets.urls) add(t, `plugin asset: ${shortUrl(u)}`, null, RANK.url + 1);
    }
    if (seen.has(id)) {
      const row = plugins.find((r) => r.id === id);
      mergeVersions(row.assetVersions, assets.versions);
      continue;
    }
    seen.add(id);
    plugins.push({ id, dir, tech: t ?? null, assetVersions: new Map(assets.versions), urls: assets.urls });
  }
  for (const t of TECH) {
    if (t.group !== 'plugin' || !evidence.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    plugins.push({ id: t.id, dir: t.wp?.[0] ?? null, tech: t, assetVersions: new Map(), urls: [] });
  }
  const pluginRows = plugins.map((pl) => {
    const t = pl.tech;
    const ev = t ? evidence.get(t.id) ?? [] : pl.urls.map((u) => ({ text: `plugin asset: ${shortUrl(u)}`, rank: RANK.url }));
    const own = t ? pickVersion(ev) : null;
    // An asset version equal to WordPress's own is WordPress's, not the plugin's.
    const assetV = [...pl.assetVersions].filter(([v]) => isAssetVersion(v) && v !== coreVersion).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const version = own?.version ?? assetV;
    const evidenceText = orderEvidence(ev, own);
    if (!own && assetV) evidenceText.push(`?ver=${assetV} on its assets`);
    return {
      key: `plugin|${pl.id}`,
      id: pl.id,
      slug: pl.dir,
      name: t?.name ?? pl.dir,
      named: !!t,
      version: version ? cleanVersion(version) : null,
      wporg: t ? t.wporg ?? false : /^[a-z0-9-]{1,100}$/.test(pl.dir) ? pl.dir : false,
      evidence: evidenceText,
    };
  });
  pluginRows.sort((a, b) => Number(b.named) - Number(a.named) || (a.named ? 0 : a.name.localeCompare(b.name)));

  return { themes, plugins: pluginRows, namespaces: ns, otherNamespaces, probes: probeStatus(probes) };
}

function mergeVersions(into, from) {
  for (const [v, n] of from) into.set(v, (into.get(v) ?? 0) + n);
}

function probeStatus(probes) {
  if (!probes) return [];
  const out = [];
  const one = (kind, label, r) => r && out.push({ kind, label, url: r.url, ok: typeof r.text === 'string', error: r.error ?? null, capped: !!r.capped });
  one('feed', 'Feed', probes.feed);
  one('rest', 'REST namespaces', probes.rest);
  for (const t of probes.themes ?? []) one('theme', `Theme ${t.slug} style.css`, t);
  one('opml', 'wp-links-opml.php', probes.opml);
  return out;
}

// ---- WordPress probe targets -------------------------------------------------

// Never these, whatever a page links to.
export const FORBIDDEN_PATH = /(?:^|\/)(?:readme\.(?:txt|html)|license\.txt|wp-login\.php|xmlrpc\.php)$|\/wp-admin(?:\/|$)/i;
export const MAX_PROBES = 5;
export const MAX_THEME_PROBES = 2;

// The site's own URLs to read, on WordPress pages only: the feed it links to,
// its REST index (namespaces only), each theme's style.css (2 at most) and
// wp-links-opml.php (only fetched when the core version is still unknown).
// Same origin as the page, from the page's own links. Five at most.
export function probeTargets(signals, headers, result) {
  if (!result?.wordpress || !signals?.url) return null;
  let page;
  try {
    page = new URL(signals.url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(page.protocol)) return null;
  const abs = (href) => {
    try {
      const u = new URL(href, page.href);
      return u.origin === page.origin && !FORBIDDEN_PATH.test(u.pathname) ? u : null;
    } catch {
      return null;
    }
  };
  const feed = strings(arr(signals.feeds).map((f) => (typeof f === 'string' ? f : f?.href)))
    .map(abs)
    .find((u) => u && !/\/comments\/feed\/?$/i.test(u.pathname));
  // WordPress's own folder: where wp-includes/ is.
  let root = null;
  const urls = [...(signals.scripts ?? []).map((x) => x?.src), ...strings(signals.links), ...strings(signals.resources)];
  for (const u of strings(urls)) {
    const m = /^(https?:\/\/[^?#\s]*?\/)wp-includes\//.exec(u);
    if (m && abs(m[1])) {
      root = abs(m[1]);
      break;
    }
  }
  // The REST index: the page's api.w.org link (or Link header), else beside
  // the feed (both hang off the site's home), else beside wp-includes/.
  const besideFeed = feed && /\/feed\/?$/.test(feed.pathname) ? abs(feed.pathname.replace(/feed\/?$/, 'wp-json/')) : null;
  const restHref = [...strings(signals.restLinks), ...linkHeaderRest(headers?.link ?? headers?.Link)].map(abs).find(Boolean) ?? besideFeed ?? (root ? abs(new URL('wp-json/', root).href) : null);
  let rest = null;
  if (restHref) {
    rest = new URL(restHref.href);
    rest.searchParams.set('_fields', 'namespaces');
  }
  if (!root && restHref && /\/wp-json\/$/.test(restHref.pathname)) root = abs(restHref.pathname.replace(/wp-json\/$/, ''));
  const opml = root ? abs(new URL('wp-links-opml.php', root).href) : null;
  const themes = [];
  for (const t of result.wordpress.themes ?? []) {
    if (themes.length >= MAX_THEME_PROBES) break;
    const u = t.base ? abs(new URL('style.css', t.base).href) : null;
    if (u && /\/themes\/[^/]+\/style\.css$/.test(u.pathname)) themes.push({ slug: t.slug, url: u.href });
  }
  return { feed: feed?.href ?? null, rest: rest?.href ?? null, opml: opml?.href ?? null, themes };
}
const arr = (x) => (Array.isArray(x) ? x : []);

function linkHeaderRest(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/<([^>]+)>\s*;\s*rel="?https:\/\/api\.w\.org\/"?/gi)].map((m) => m[1]);
}

// ---- latest versions ---------------------------------------------------------

export const MAX_PLUGIN_LOOKUPS = 10;
const WPORG_SLUG = /^[a-z0-9-]{1,100}$/;

// What to look up: WordPress core, each plugin and theme on wordpress.org (10
// plugins and 2 themes at most), and each framework with an exact version.
// Only a slug or a package name ever leaves.
export function latestTargets(result) {
  const out = [];
  const keys = new Set();
  const push = (t) => {
    if (!keys.has(t.key)) {
      keys.add(t.key);
      out.push(t);
    }
  };
  for (const r of result?.tech ?? []) {
    if (r.id === 'wordpress' && r.version) push({ key: 'wp-core', kind: 'wp-core' });
    else if (r.npm && r.version && isExact(r.version)) push({ key: `npm:${r.npm}`, kind: 'npm', name: r.npm });
  }
  const wp = result?.wordpress;
  let plugins = 0;
  for (const pl of wp?.plugins ?? []) {
    if (plugins >= MAX_PLUGIN_LOOKUPS) break;
    if (typeof pl.wporg !== 'string' || !WPORG_SLUG.test(pl.wporg)) continue;
    plugins++;
    push({ key: `wp-plugin:${pl.wporg}`, kind: 'wp-plugin', name: pl.wporg });
  }
  for (const t of (wp?.themes ?? []).slice(0, MAX_THEME_PROBES)) {
    if (typeof t.wporg === 'string' && WPORG_SLUG.test(t.wporg)) push({ key: `wp-theme:${t.wporg}`, kind: 'wp-theme', name: t.wporg });
  }
  return out;
}

// The rows with their update status. answers: { [key]: { version } |
// { offers } | { unlisted: true } | { error } }.
export function withLatest(result, answers = {}) {
  if (!result || result.error) return result;
  const a = answers ?? {};
  const sameName = (x, y) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '') === String(y).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const forWp = (item, key) => {
    if (item.wporg === false) return { status: 'unlisted' };
    const ans = a[key];
    if (!ans) return null;
    if (ans.unlisted) return { status: 'unlisted' };
    if (!ans.version) return null;
    // A custom theme in a folder that shares a wordpress.org slug: not that theme.
    if (ans.name && item.headerName && !sameName(ans.name, item.headerName)) return { status: 'unlisted' };
    return item.version ? latestStatus(item.version, ans.version) : { status: 'unknown', latest: ans.version };
  };
  const tech = result.tech.map((r) => {
    let update = null;
    if (r.id === 'wordpress' && r.version && a['wp-core']?.offers) update = wpCoreStatus(r.version, a['wp-core'].offers);
    else if (r.npm && r.version && isExact(r.version) && a[`npm:${r.npm}`]?.version) update = latestStatus(r.version, a[`npm:${r.npm}`].version);
    return update ? { ...r, update } : r;
  });
  const wp = result.wordpress
    ? {
        ...result.wordpress,
        plugins: result.wordpress.plugins.map((pl) => ({ ...pl, update: forWp(pl, `wp-plugin:${pl.wporg}`) })),
        themes: result.wordpress.themes.map((t) => ({ ...t, update: forWp(t, `wp-theme:${t.wporg}`) })),
      }
    : null;
  return { ...result, tech, wordpress: wp };
}

// ---- text for the popup --------------------------------------------------------

export const UPDATE = {
  latest: { kind: 'good', label: () => 'Latest' },
  patched: { kind: 'neutral', label: () => 'Older branch, patched', hint: (u) => `Still patched by WordPress. The newest release is ${u.latest}.` },
  update: { kind: 'warn', label: (u) => `Update available (${u.branch})`, hint: (u) => `${u.branch} is out for this branch. The newest release is ${u.latest}.` },
  unsupported: { kind: 'bad', label: () => 'Unsupported', hint: (u) => `WordPress no longer patches this branch. The newest release is ${u.latest}.` },
  behind: { kind: 'warn', label: (u) => `Latest is ${u.latest}` },
  prerelease: { kind: 'accent', label: () => 'Prerelease', hint: (u) => `Newer than the latest stable release, ${u.latest}.` },
  unlisted: { kind: 'neutral', label: () => 'Not on wordpress.org', hint: () => 'A premium or custom plugin or theme: wordpress.org has no version to compare.' },
  unknown: { kind: 'neutral', label: (u) => `Latest is ${u.latest}`, hint: () => 'The site hides the version it runs.' },
};
export function updateLabel(update) {
  const u = update && UPDATE[update.status];
  return u ? { kind: u.kind, label: u.label(update), hint: u.hint?.(update) ?? null } : null;
}
const BEHIND = new Set(['update', 'unsupported', 'behind']);

// "Tech version", one per line, in the tab's order.
export function copyList(result) {
  const line = (name, version, suffix = '') => `${name}${version ? ` ${version}` : ''}${suffix}`;
  const rows = result?.tech ?? [];
  const lines = [];
  for (const g of GROUPS) {
    if (g.id === 'wordpress') {
      for (const t of result?.wordpress?.themes ?? []) lines.push(line(t.name, t.version, ' (theme)'));
      for (const pl of result?.wordpress?.plugins ?? []) lines.push(line(pl.name, pl.version));
      continue;
    }
    for (const r of rows.filter((x) => x.group === g.id)) lines.push(line(r.name, r.version));
  }
  return lines.join('\n');
}

// Overview "Built with" chips: the platform with its version (and its update
// status when behind), the framework, the host.
const LIBRARIES = new Set(['jquery', 'gsap', 'alpine', 'htmx']);
const APP_FRAMEWORKS = new Set(['nextjs', 'nuxt', 'astro', 'sveltekit', 'gatsby', 'remix', 'angular']);
const CDNS = new Set(['cloudflare', 'cloudfront', 'fastly', 'akamai']);

export function overviewChips(result) {
  const rows = result?.tech ?? [];
  const chips = [];
  for (const r of rows.filter((x) => x.group === 'platform')) {
    chips.push({ key: r.id, label: r.version ? `${r.name} ${r.version}` : r.name, kind: 'neutral' });
    const u = r.update && BEHIND.has(r.update.status) ? updateLabel(r.update) : null;
    if (u) chips.push({ key: `${r.id}:update`, label: u.label, kind: u.kind, hint: u.hint });
  }
  // The framework, not a library a theme loads (jQuery on most WordPress
  // sites): an app framework first, then a view library that gives its
  // version. On a platform's site, a view library found only by its DOM
  // properties is most often an embedded widget's, so it stays in the tab.
  const candidates = rows.filter((x) => x.group === 'framework' && !x.implied && !LIBRARIES.has(x.id));
  const platform = rows.some((x) => x.group === 'platform');
  const framework = candidates.find((x) => APP_FRAMEWORKS.has(x.id)) ?? candidates.find((x) => x.version) ?? (platform ? null : candidates[0]);
  if (framework) chips.push({ key: framework.id, label: framework.version ? `${framework.name} ${framework.version}` : framework.name, kind: 'neutral' });
  // The host before the CDN in front of it (Kinsta and Vercel sites behind Cloudflare).
  const hosts = rows.filter((x) => x.group === 'hosting');
  const host = hosts.find((x) => !CDNS.has(x.id)) ?? hosts[0];
  if (host) chips.push({ key: host.id, label: host.name, kind: 'neutral' });
  return chips;
}
