import {
  h,
  chip,
  metric,
  section,
  copyButton,
  spinner,
  icon,
  fmt,
  chars,
  segmented,
  openUrl,
  saveCsv,
  clear,
  append,
} from '../ui.js';
import {
  LIMITS,
  lengthStatus,
  canonicalStatus,
  indexability,
  headingCounts,
  linkStats,
  imageStats,
  directivesFor,
  hasNoindex,
  hasNofollow,
  parseJsonLdBlocks,
} from '../../lib/analysis.js';
import { TOOLS, toolUrl } from '../../lib/tools.js';
import { statusText } from '../../lib/net.js';
import { linksCsv } from './links.js';
import { csvFilename } from '../../lib/csv.js';

const LEN_KIND = { good: 'good', short: 'warn', long: 'warn', missing: 'bad' };
const LEN_HINT = {
  title: 'Aim for 30–60 characters',
  description: 'Aim for 70–160 characters',
};

function row(label, content, copy) {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-label' }, label),
    h('div', { class: 'row-main' }, content),
    copy ? copyButton(copy, { label: null, title: `Copy ${label.toLowerCase()}` }) : null,
  );
}

function value(text, cls = '') {
  return h('div', { class: `row-value ${cls}` }, text);
}

function meta(...chips) {
  return h('div', { class: 'row-meta' }, ...chips);
}

function lengthRow(label, text, limits, count, hint) {
  const status = lengthStatus(text, limits);
  return row(
    label,
    [
      text ? value(text) : value(text === '' ? 'Empty' : 'Missing', 'missing'),
      text
        ? meta(
            chip(`${chars(text)} characters${status === 'short' ? ' · short' : status === 'long' ? ' · may be truncated' : ''}`, LEN_KIND[status], { dot: true, title: hint }),
            count > 1 ? chip(`${count} tags on the page`, 'bad') : null,
          )
        : null,
    ],
    text,
  );
}

// A row whose content arrives later (network checks).
function asyncRow(label, ready, renderContent) {
  const main = h('div', { class: 'row-main' }, h('div', { class: 'row-value muted' }, spinner(), ' Checking…'));
  const el = h('div', { class: 'row' }, h('div', { class: 'row-label' }, label), main);
  ready.then(() => {
    const { content, copy } = renderContent();
    clear(main);
    append(main, content);
    main.classList.add('fade-in');
    if (copy) el.append(copyButton(copy, { label: null, title: `Copy ${label.toLowerCase()}` }));
  });
  return el;
}

function verdictBanner(ctx) {
  const mark = h('div', { class: 'verdict-mark' }, spinner());
  const title = h('div', { class: 'verdict-title' }, 'Checking indexability…');
  const sub = h('div', { class: 'verdict-sub' }, 'Meta robots, headers, robots.txt and canonical');
  const el = h('div', { class: 'verdict' }, mark, h('div', {}, title, sub));
  Promise.all([ctx.httpReady, ctx.robotsReady]).then(() => {
    const http = ctx.http && !ctx.http.failed ? ctx.http : null;
    const robotsTxt = ctx.robots && !ctx.robots.failed ? ctx.robots : null;
    const v = indexability({ head: ctx.page.head, pageUrl: ctx.page.url, http, robotsTxt });
    el.classList.add(v.indexable ? 'good' : 'bad');
    clear(mark).append(icon(v.indexable ? 'check' : 'x', 13));
    title.textContent = v.indexable ? 'Indexable' : 'Not indexable';
    const parts = v.indexable ? ['No blocking signals found'] : v.reasons.map((r) => r[0].toUpperCase() + r.slice(1));
    if (v.unknown.length) parts.push(`couldn’t check ${v.unknown.join(' and ')}`);
    sub.textContent = parts.join(' · ');
  });
  return el;
}

function robotsChips(directives) {
  if (hasNoindex(directives)) return chip('noindex', 'bad', { dot: true });
  if (hasNofollow(directives)) return chip('nofollow', 'warn', { dot: true });
  return chip('index, follow', 'good', { dot: true });
}

export function render(ctx, el) {
  const { page } = ctx;
  const { head } = page;
  const hc = headingCounts(page.headings);
  const ls = linkStats(page.links, page.url);
  const is = imageStats(page.images);
  const schemaCount = parseJsonLdBlocks(page.jsonld).reduce((n, b) => n + (b.ok ? b.types.length || 1 : 0), 0) + page.microdata.length;

  // ---- verdict
  el.append(verdictBanner(ctx));

  // ---- core rows
  const canonical = canonicalStatus(head.canonicals, page.url);
  const canonicalChip = {
    self: chip('Self-referencing', 'good', { dot: true }),
    other: chip('Points to another URL', 'warn', { dot: true }),
    missing: chip('Missing', 'warn', { dot: true }),
    empty: chip('Empty href', 'bad', { dot: true }),
    conflict: chip(`${canonical.count} conflicting tags`, 'bad', { dot: true }),
  }[canonical.kind];

  const metaRobots = directivesFor(head.robots);
  const botRobots = directivesFor(head.googlebot);

  const rows = h(
    'div',
    { class: 'card rows' },
    lengthRow('Title', head.title, LIMITS.title, head.titleCount, LEN_HINT.title),
    lengthRow('Description', head.description, LIMITS.description, head.descriptionCount, LEN_HINT.description),
    asyncRow('URL', ctx.httpReady, () => {
      const http = ctx.http;
      return {
        content: [
          value(page.url, 'mono'),
          meta(
            chip(`${chars(page.url)} characters`, chars(page.url) > 115 ? 'warn' : 'neutral'),
            http?.redirected ? chip('Fetch was redirected', 'warn', { dot: true }) : null,
          ),
          http?.redirected ? h('div', { class: 'sub-line mono' }, `→ ${http.finalUrl}`) : null,
        ],
        copy: page.url,
      };
    }),
    row(
      'Canonical',
      [canonical.href ? value(canonical.href, 'mono') : null, meta(canonicalChip)],
      canonical.href,
    ),
    row(
      'Robots meta',
      [
        head.robots != null ? value(head.robots, 'mono') : value('Not set', 'muted'),
        meta(robotsChips([...metaRobots, ...botRobots])),
        head.googlebot != null ? h('div', { class: 'sub-line mono' }, `googlebot: ${head.googlebot}`) : null,
      ],
      head.robots,
    ),
    asyncRow('X-Robots-Tag', ctx.httpReady, () => {
      const http = ctx.http;
      if (!http || http.failed) return { content: value(`Couldn’t read headers (${http?.error ?? 'no access'})`, 'muted') };
      if (!http.xRobotsTag) return { content: [value('Not set', 'muted')] };
      return {
        content: [value(http.xRobotsTag, 'mono'), meta(robotsChips(directivesFor(http.xRobotsTag)))],
        copy: http.xRobotsTag,
      };
    }),
    asyncRow('HTTP status', ctx.httpReady, () => {
      const http = ctx.http;
      if (!http || http.failed) return { content: value(`Couldn’t fetch (${http?.error ?? 'no access'})`, 'muted') };
      const kind = http.status < 300 ? 'good' : http.status < 400 ? 'warn' : 'bad';
      return {
        content: [
          h('div', { class: 'row-head' }, chip(`${http.status} ${http.statusText || statusText(http.status)}`, kind, { dot: true })),
          http.contentType ? h('div', { class: 'sub-line mono' }, http.contentType) : null,
        ],
      };
    }),
    asyncRow('robots.txt', ctx.robotsReady, () => {
      const r = ctx.robots;
      if (!r || r.failed) return { content: value(`Couldn’t fetch (${r?.error ?? 'no access'})`, 'muted') };
      if (r.serverError) return { content: [h('div', { class: 'row-head' }, chip(`Server error ${r.status}`, 'bad', { dot: true })), h('div', { class: 'sub-line' }, 'Google pauses crawling while robots.txt errors.')] };
      if (!r.exists) return { content: [h('div', { class: 'row-head' }, chip(`No robots.txt (${r.status})`, 'neutral')), h('div', { class: 'sub-line' }, 'Everything is crawlable.')] };
      const c = r.check;
      return {
        content: [
          h('div', { class: 'row-head' }, c.allowed ? chip('Allowed for Googlebot', 'good', { dot: true }) : chip('Blocked for Googlebot', 'bad', { dot: true })),
          c.rule ? h('div', { class: 'sub-line mono' }, `${c.rule.line}${c.group ? `  (User-agent: ${c.group})` : ''}`) : null,
        ],
      };
    }),
    row('Language', head.lang ? value(head.lang, 'mono') : [value('Missing', 'missing'), meta(chip('Add a lang attribute on <html>', 'warn'))], head.lang),
    row('Word count', value(fmt(page.wordCount))),
    head.keywords ? row('Keywords', value(head.keywords), head.keywords) : null,
    head.author ? row('Author', value(head.author), head.author) : null,
    head.generator ? row('Generator', value(head.generator), head.generator) : null,
    !head.viewport ? row('Viewport', [value('Missing', 'missing'), meta(chip('Not mobile friendly', 'warn'))]) : null,
    head.metaRefresh ? row('Meta refresh', [value(head.metaRefresh, 'mono'), meta(chip('Redirects with meta refresh', 'warn'))], head.metaRefresh) : null,
    head.amphtml ? row('AMP', value(head.amphtml, 'mono'), head.amphtml) : null,
    head.prev ? row('rel=prev', value(head.prev, 'mono'), head.prev) : null,
    head.next ? row('rel=next', value(head.next, 'mono'), head.next) : null,
  );
  el.append(section(null, rows));

  // ---- headings
  const headingTiles = h('div', { class: 'hd-counts' });
  for (let level = 1; level <= 6; level++) {
    const n = hc[level];
    const kind = level === 1 ? (n === 0 ? 'bad' : n > 1 ? 'warn' : 'good') : n === 0 ? 'zero' : null;
    headingTiles.append(metric(`H${level}`, n, { kind, onClick: () => ctx.show('headings'), title: `${n} H${level} tag${n === 1 ? '' : 's'}` }));
  }
  el.append(section('Headings', headingTiles));

  // ---- counts
  el.append(
    section(
      'Content',
      h(
        'div',
        { class: 'metrics' },
        metric('Links', ls.total, { onClick: () => ctx.show('links') }),
        metric('Internal', ls.internal, { onClick: () => ctx.show('links') }),
        metric('External', ls.external, { onClick: () => ctx.show('links') }),
        metric('Images', is.total, { onClick: () => ctx.show('images') }),
        metric('Missing alt', is.missingAlt, { kind: is.missingAlt ? 'warn' : 'zero', onClick: () => ctx.show('images') }),
        metric('Schema items', schemaCount, { kind: schemaCount ? null : 'zero', onClick: () => ctx.show('schema') }),
      ),
    ),
  );

  // ---- files & exports
  const files = h('div', { class: 'tool-grid' });
  const origin = new URL(page.url).origin;
  const fileButton = (label, url) =>
    h('button', { class: 'tool', type: 'button', title: url, onClick: () => openUrl(url) }, h('span', {}, label), icon('external', 12));
  files.append(fileButton('robots.txt', `${origin}/robots.txt`));
  const sitemapSlot = h('div', { style: { display: 'contents' } }, fileButton('sitemap.xml', `${origin}/sitemap.xml`));
  files.append(sitemapSlot);
  files.append(
    h(
      'button',
      {
        class: 'tool',
        type: 'button',
        title: 'Every link on the page, with resolved and raw URLs',
        onClick: () => saveCsv(ctx, linksCsv(page), csvFilename('links', page.url)),
      },
      h('span', {}, 'Export links'),
      icon('download', 12),
    ),
  );
  ctx.robotsReady.then(() => {
    const maps = ctx.robots?.sitemaps ?? [];
    if (!maps.length) return;
    clear(sitemapSlot);
    for (const url of maps.slice(0, 5)) {
      let name = 'sitemap';
      try {
        name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'sitemap';
      } catch {}
      sitemapSlot.append(fileButton(name, url));
    }
  });
  el.append(section('Files', files));

  // ---- open in
  let mode = 'page';
  const grid = h('div', { class: 'tool-grid' });
  const paintTools = () => {
    clear(grid);
    for (const tool of TOOLS) {
      const url = toolUrl(tool.id, mode, page.url);
      grid.append(
        h(
          'button',
          { class: 'tool', type: 'button', disabled: !url, title: url ? `${tool.name} (${mode})` : `${tool.name} has no ${mode} report`, onClick: () => openUrl(url) },
          h('span', {}, tool.short ?? tool.name),
          icon('external', 12),
        ),
      );
    }
  };
  paintTools();
  const seg = segmented(
    [
      { value: 'page', label: 'This page' },
      { value: 'domain', label: 'Domain' },
    ],
    mode,
    (v) => {
      mode = v;
      paintTools();
    },
    { small: true },
  );
  el.append(section(null, h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, 'Open in'), seg), grid));
}
