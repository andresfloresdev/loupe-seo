import { h, chip, section, metric, segmented, copyButton, emptyState, stagger, flash, icon, openUrl, button, saveCsv, clear, fmt } from '../ui.js';
import { imageFlags, imageStats } from '../../lib/analysis.js';
import { toCSV, csvFilename } from '../../lib/csv.js';

const PAGE_SIZE = 150;

export function imagesCsv(page) {
  const rows = page.images.map((img) => {
    const f = imageFlags(img);
    return {
      ...img,
      altText: img.alt ?? '',
      altStatus: f.missingAlt ? 'missing' : f.emptyAlt ? 'empty' : 'present',
      natural: img.width ? `${img.width}x${img.height}` : '',
      displayed: img.shownWidth ? `${img.shownWidth}x${img.shownHeight}` : '',
      visible: img.shown ? 'yes' : 'no',
    };
  });
  return toCSV(rows, [
    { key: 'src', label: 'Image URL' },
    { key: 'raw', label: 'src as written' },
    { key: 'altText', label: 'Alt text' },
    { key: 'altStatus', label: 'Alt status' },
    { key: 'title', label: 'Title' },
    { key: 'natural', label: 'Natural size' },
    { key: 'displayed', label: 'Displayed size' },
    { key: 'loading', label: 'Loading' },
    { key: 'visible', label: 'Visible' },
  ]);
}

function fileName(src) {
  if (!src) return '(no src)';
  if (src.startsWith('data:')) return 'Inline data URI';
  try {
    const u = new URL(src);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return src;
  }
}

const FILTERS = {
  all: () => true,
  missing: (f) => f.missingAlt,
  empty: (f) => f.emptyAlt,
  oversized: (f) => f.oversized,
};

export function render(ctx, el) {
  const { page } = ctx;
  if (!page.images.length) {
    el.append(emptyState('No images', 'This page has no <img> elements.', 'file'));
    return;
  }
  const stats = imageStats(page.images);
  const items = page.images.map((img) => ({ img, f: imageFlags(img) }));
  let filter = 'all';
  let limit = PAGE_SIZE;
  let painted = false;

  el.append(
    section(
      null,
      h(
        'div',
        { class: 'metrics' },
        metric('Images', stats.total),
        metric('Missing alt', stats.missingAlt, { kind: stats.missingAlt ? 'bad' : 'zero' }),
        metric('Empty alt', stats.emptyAlt, { kind: stats.emptyAlt ? 'warn' : 'zero', title: 'alt="" marks an image as decorative' }),
        metric('No title', stats.missingTitle, { kind: 'zero' }),
        metric('Lazy loaded', stats.lazy),
        metric('Oversized', stats.oversized, { kind: stats.oversized ? 'warn' : 'zero', title: 'Served at more than twice its displayed width' }),
      ),
    ),
  );

  const list = h('div', { class: 'card list' });
  const visible = () => items.filter(({ f }) => FILTERS[filter](f));

  function paint() {
    const rows = visible();
    clear(list);
    if (!rows.length) {
      list.append(emptyState('Nothing here', 'No images match this filter.', 'check'));
      return;
    }
    rows.slice(0, limit).forEach(({ img, f }, i) => {
      const thumbImg = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      thumbImg.addEventListener('load', () => thumbImg.classList.add('loaded'));
      if (/^(https?:|data:image\/)/i.test(img.src)) thumbImg.src = img.src;
      const altLine = f.missingAlt
        ? h('div', { class: 'item-title' }, chip('Missing alt', 'bad', { dot: true }))
        : f.emptyAlt
          ? h('div', { class: 'item-title none' }, 'alt="" (decorative)')
          : h('div', { class: 'item-title' }, img.alt);
      const dims = img.width ? `${img.width}×${img.height}` : 'not loaded';
      const shown = img.shownWidth ? ` · shown ${img.shownWidth}×${img.shownHeight}` : '';
      const item = h(
        'div',
        { class: 'item clickable', title: 'Show on page', onClick: () => flash(ctx, 'img', img.index) },
        h('div', { class: 'thumb' }, thumbImg),
        h(
          'div',
          { class: 'item-main' },
          altLine,
          h('div', { class: 'item-url', title: img.src }, fileName(img.src)),
          h(
            'div',
            { class: 'item-meta' },
            chip(dims + shown, 'neutral'),
            f.oversized ? chip('oversized', 'warn') : null,
            img.loading ? chip(`loading=${img.loading}`, 'neutral') : null,
            img.title ? chip('title', 'neutral', { title: img.title }) : null,
            img.shown ? null : chip('hidden', 'neutral'),
          ),
        ),
        /^https?:/i.test(img.src)
          ? h(
              'div',
              { class: 'item-side' },
              h('button', { class: 'mini-btn', type: 'button', title: 'Open image', onClick: (e) => (e.stopPropagation(), openUrl(img.src, { active: false })) }, icon('external', 13)),
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

  const seg = segmented(
    [
      { value: 'all', label: 'All', count: stats.total },
      { value: 'missing', label: 'Missing alt', count: stats.missingAlt },
      { value: 'empty', label: 'Empty alt', count: stats.emptyAlt },
      { value: 'oversized', label: 'Oversized', count: stats.oversized },
    ],
    filter,
    (v) => {
      filter = v;
      limit = PAGE_SIZE;
      paint();
    },
    { small: true },
  );

  el.append(
    section(
      null,
      h('div', { class: 'toolbar' }, seg),
      h(
        'div',
        { class: 'toolbar' },
        h('span', { class: 'muted grow' }, 'Click an image to find it on the page'),
        copyButton(() => visible().map(({ img }) => img.src).join('\n'), { label: 'URLs', title: 'Copy the filtered image URLs', toastText: 'Image URLs copied' }),
        button('CSV', () => saveCsv(ctx, imagesCsv(page), csvFilename('images', page.url)), { iconName: 'download', title: 'Export every image as CSV' }),
      ),
      list,
      page.imageTotal > page.images.length ? h('p', { class: 'note' }, `First ${fmt(page.images.length)} of ${fmt(page.imageTotal)} images.`) : null,
    ),
  );
  paint();
}
