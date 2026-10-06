import { h, chip, section, metric, segmented, copyButton, emptyState, stagger, flash, icon, openUrl, button, saveCsv, clear, fmt } from '../ui.js';
import { classifyLink, linkStats } from '../../lib/analysis.js';
import { toCSV, csvFilename } from '../../lib/csv.js';

const SELECTOR = 'a[href], area[href]';
const PAGE_SIZE = 250;

export function linksCsv(page) {
  const rows = page.links.map((l) => {
    const c = classifyLink(l, page.url);
    return { ...l, kind: c.kind, visible: l.shown ? 'yes' : 'no' };
  });
  return toCSV(rows, [
    { key: 'href', label: 'URL' },
    { key: 'raw', label: 'Href as written' },
    { key: 'text', label: 'Anchor text' },
    { key: 'textSource', label: 'Anchor source' },
    { key: 'kind', label: 'Type' },
    { key: 'rel', label: 'Rel' },
    { key: 'target', label: 'Target' },
    { key: 'visible', label: 'Visible' },
  ]);
}

const FILTERS = {
  all: () => true,
  internal: (c) => c.kind === 'internal',
  external: (c) => c.kind === 'external',
  nofollow: (c) => c.qualified,
  other: (c) => c.kind !== 'internal' && c.kind !== 'external',
};

export function render(ctx, el) {
  const { page } = ctx;
  if (!page.links.length) {
    el.append(emptyState('No links', 'This page has no <a href> links.', 'globe'));
    return;
  }
  const classified = page.links.map((l) => ({ link: l, c: classifyLink(l, page.url) }));
  const stats = linkStats(page.links, page.url);
  let filter = 'all';
  let query = '';
  let limit = PAGE_SIZE;
  let painted = false;

  el.append(
    section(
      null,
      h(
        'div',
        { class: 'metrics' },
        metric('Total', stats.total),
        metric('Unique', stats.unique),
        metric('Internal', stats.internal),
        metric('External', stats.external),
        metric('Nofollow', stats.nofollow, { kind: stats.nofollow ? 'warn' : 'zero', title: 'rel="nofollow", "ugc" or "sponsored"' }),
        metric('No anchor text', stats.noText, { kind: stats.noText ? 'warn' : 'zero' }),
      ),
    ),
  );

  const seg = segmented(
    [
      { value: 'all', label: 'All', count: stats.total },
      { value: 'internal', label: 'Internal', count: stats.internal },
      { value: 'external', label: 'External', count: stats.external },
      { value: 'nofollow', label: 'Nofollow', count: stats.nofollow },
      { value: 'other', label: 'Other', count: stats.other },
    ],
    filter,
    (v) => {
      filter = v;
      limit = PAGE_SIZE;
      paint();
    },
    { small: true },
  );

  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Filter by URL or anchor text', 'aria-label': 'Filter links' });
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    limit = PAGE_SIZE;
    paint();
  });

  const list = h('div', { class: 'card list' });
  const count = h('span', { class: 'muted' });

  const visible = () =>
    classified.filter(({ link, c }) => FILTERS[filter](c) && (!query || link.href.toLowerCase().includes(query) || link.text.toLowerCase().includes(query)));

  function paint() {
    const rows = visible();
    count.textContent = `${fmt(rows.length)} shown`;
    clear(list);
    if (!rows.length) {
      list.append(emptyState('Nothing here', 'No links match this filter.', 'search'));
      return;
    }
    rows.slice(0, limit).forEach(({ link, c }, i) => {
      const badges = [
        c.nofollow ? chip('nofollow', 'bad') : null,
        c.ugc ? chip('ugc', 'bad') : null,
        c.sponsored ? chip('sponsored', 'bad') : null,
        c.kind === 'external' ? chip('external', 'accent') : null,
        !['internal', 'external'].includes(c.kind) ? chip(c.kind, 'neutral') : null,
        link.textSource === 'image alt' ? chip('image link', 'neutral') : null,
        link.textSource === 'label' ? chip('aria-label', 'neutral') : null,
        link.target === '_blank' ? chip('new tab', 'neutral') : null,
        link.shown ? null : chip('hidden', 'neutral'),
      ].filter(Boolean);
      const item = h(
        'div',
        { class: 'item clickable', title: 'Show on page', onClick: () => flash(ctx, SELECTOR, link.index) },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: `item-title${link.text ? '' : ' none'}` }, link.text || 'No anchor text'),
          h('div', { class: 'item-url', title: link.href }, link.href || link.raw),
          badges.length ? h('div', { class: 'item-meta' }, badges) : null,
        ),
        /^https?:/i.test(link.href)
          ? h(
              'div',
              { class: 'item-side' },
              h('button', { class: 'mini-btn', type: 'button', title: 'Open in a new tab', onClick: (e) => (e.stopPropagation(), openUrl(link.href, { active: false })) }, icon('external', 13)),
            )
          : null,
      );
      list.append(painted ? item : stagger(item, i));
    });
    if (rows.length > limit) {
      list.append(
        h(
          'div',
          { class: 'more' },
          button(`Show ${fmt(Math.min(PAGE_SIZE, rows.length - limit))} more`, () => {
            limit += PAGE_SIZE;
            paint();
          }),
        ),
      );
    }
    painted = true;
  }

  el.append(
    section(
      null,
      h('div', { class: 'toolbar' }, seg),
      h(
        'div',
        { class: 'toolbar' },
        h('div', { class: 'search-wrap' }, icon('search', 13), search),
        copyButton(() => visible().map(({ link }) => link.href).join('\n'), { label: 'URLs', title: 'Copy the filtered URLs', toastText: 'URLs copied' }),
        button('CSV', () => saveCsv(ctx, linksCsv(page), csvFilename('links', page.url)), { iconName: 'download', title: 'Export every link as CSV' }),
      ),
      list,
      h('p', { class: 'note' }, count, page.linkTotal > page.links.length ? ` · first ${fmt(page.links.length)} of ${fmt(page.linkTotal)} collected` : '', ' · click a link to find it on the page'),
    ),
  );
  paint();
}
