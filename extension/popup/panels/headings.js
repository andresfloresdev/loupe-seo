import { h, chip, section, copyButton, emptyState, stagger, flash, metric, toast } from '../ui.js';
import { headingIssues, headingCounts } from '../../lib/analysis.js';

const SELECTOR = 'h1, h2, h3, h4, h5, h6';

export function outlineText(headings) {
  return headings.map((hd) => `${'  '.repeat(hd.level - 1)}H${hd.level}  ${hd.text}`).join('\n');
}

export function render(ctx, el) {
  const { headings, headingTotal } = ctx.page;
  if (!headings.length) {
    el.append(emptyState('No headings', 'This page has no H1–H6 tags.', 'file'));
    return;
  }

  const counts = headingCounts(headings);
  const tiles = h('div', { class: 'hd-counts' });
  for (let level = 1; level <= 6; level++) {
    const n = counts[level];
    const kind = level === 1 ? (n === 0 ? 'bad' : n > 1 ? 'warn' : 'good') : n === 0 ? 'zero' : null;
    tiles.append(metric(`H${level}`, n, { kind }));
  }
  el.append(section(null, tiles));

  const issues = headingIssues(headings);
  const hidden = headings.filter((x) => !x.shown).length;
  const chips = h(
    'div',
    { class: 'chips' },
    issues.length ? issues.map((i) => chip(i.text, i.level === 'error' ? 'bad' : 'warn', { dot: true })) : chip('Structure looks good', 'good', { dot: true }),
    hidden ? chip(`${hidden} hidden`, 'neutral', { title: 'Present in the HTML but not visible' }) : null,
  );

  const list = h('div', { class: 'card list' });
  headings.forEach((hd, i) => {
    const row = h(
      'div',
      {
        class: `hd${hd.shown ? '' : ' hidden-el'}`,
        dataset: { level: String(hd.level) },
        style: { '--indent': `${(hd.level - 1) * 14}px` },
        title: 'Show on page',
        onClick: () => flash(ctx, SELECTOR, hd.index),
      },
      h('span', { class: 'hd-tag' }, `H${hd.level}`),
      h('span', { class: 'hd-text' }, hd.text || h('em', { class: 'muted' }, '(empty)')),
      hd.shown ? null : h('span', { class: 'hd-flag' }, chip('hidden', 'neutral')),
    );
    list.append(stagger(row, i));
  });

  el.append(
    section(
      null,
      h('div', { class: 'toolbar' }, chips, h('span', { class: 'grow' }), copyButton(() => outlineText(headings), { label: 'Copy outline', toastText: 'Outline copied' })),
      list,
      headingTotal > headings.length ? h('p', { class: 'note' }, `Showing the first ${headings.length} of ${headingTotal}.`) : null,
      h('p', { class: 'note' }, 'Click a heading to scroll to it on the page.'),
    ),
  );
}
