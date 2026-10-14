import { h, chip, section, copyButton, emptyState, spinner, icon, clear, stagger, reducedMotion } from '../ui.js';
import { GROUPS, STATUS, statusLabel, copyList } from '../../lib/trackers.js';

// Trackers tab. Page results paint as soon as they arrive (ctx.trackersPageReady),
// then the GTM containers the page loads fill in (ctx.trackersReady).
// Every page string reaches the DOM through h() (textContent), never innerHTML.

const count = (n, word) => `${n ?? 0} ${word}${n === 1 ? '' : 's'}`;

function statusChip(row) {
  const s = STATUS[row.status];
  return chip(statusLabel(row), s?.kind ?? 'neutral', { dot: true, title: s?.hint });
}

function trackerRow(row, isNew) {
  const evidence = row.evidence ?? [];
  const el = h(
    'div',
    { class: `tr-row${isNew ? ' tr-new' : ''}`, dataset: { key: row.key, status: row.status } },
    h(
      'div',
      { class: 'tr-head' },
      h('div', { class: 'tr-name' }, h('b', {}, row.name), row.retired ? chip('Retired', 'warn', { title: 'Google stopped processing Universal Analytics data in 2024.' }) : null),
      statusChip(row),
    ),
    row.id
      ? h(
          'div',
          { class: 'tr-id' },
          h('span', { class: 'mono tr-id-value' }, row.id),
          copyButton(row.id, { label: null, title: `Copy the ${row.name} ID`, toastText: `${row.name} ID copied` }),
        )
      : row.idNote
        ? h('div', { class: 'tr-id muted' }, row.idNote)
        : null,
    evidence.length
      ? h(
          'details',
          { class: 'tr-ev' },
          h('summary', {}, icon('chevron', 11), h('span', {}, evidence.length === 1 ? '1 signal' : `${evidence.length} signals`)),
          h('ul', {}, evidence.map((e) => h('li', {}, e))),
        )
      : null,
  );
  return el;
}

function containersBlock(ctx, done) {
  const list = done ? (ctx.trackers?.containers ?? []) : (ctx.trackerContainers ?? []).map((c) => ({ ...c, pending: true }));
  if (!list.length) return null;
  return section(
    'GTM containers',
    h(
      'div',
      { class: 'card tr-containers' },
      list.map((c) =>
        h(
          'div',
          { class: 'tr-container', dataset: { state: c.pending ? 'pending' : c.ok ? 'ok' : 'failed' } },
          c.pending ? spinner() : icon(c.ok ? 'check' : 'alert', 12),
          h('span', { class: 'mono' }, c.id),
          h('span', { class: 'muted' }, c.pending ? 'Reading…' : c.ok ? 'Read' : `Couldn’t read ${c.id}${c.error ? ` (${c.error})` : ''}`),
        ),
      ),
    ),
  );
}

function summaryChips(rows) {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const words = { sending: 'sending', loaded: 'loaded', 'in-page': 'not loaded', 'gtm-only': 'in GTM only' };
  return Object.keys(STATUS)
    .filter((s) => counts[s])
    .map((s) => chip(`${counts[s]} ${words[s]}`, STATUS[s].kind, { dot: true, title: STATUS[s].hint }));
}

function paint(ctx, body, done, state) {
  const r = ctx.trackers;
  const open = new Set([...body.querySelectorAll('.tr-ev[open]')].map((d) => d.closest('.tr-row')?.dataset.key));
  clear(body);

  if (!r || r.error) {
    body.append(emptyState('Couldn’t read the page’s trackers', r?.error ?? 'The page returned no data.', 'alert'));
    return;
  }

  const rows = r.trackers ?? [];
  if (!rows.length) {
    const c = r.checked ?? {};
    const parts = [count(c.scripts, 'script tag'), count(c.inline, 'inline script'), count(c.resources, 'request')];
    if (c.live) parts.push('the page’s live state');
    const containers = done ? (r.containers ?? []).length : (ctx.trackerContainers ?? []).length;
    if (containers) parts.push(count(containers, 'GTM container'));
    body.append(
      h(
        'div',
        { class: 'card tr-empty' },
        emptyState('No trackers found', `Checked ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`, 'search'),
      ),
    );
    if (!done) body.append(h('p', { class: 'note tr-reading' }, spinner(), ' Reading GTM containers…'));
    body.append(containersBlock(ctx, done) ?? '');
    return;
  }

  body.append(
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'chips grow' }, summaryChips(rows)),
      copyButton(() => copyList(rows), { label: 'Copy list', title: 'Copy every tracker and its ID', toastText: 'Tracker list copied' }),
    ),
  );

  let i = 0;
  for (const g of GROUPS) {
    const inGroup = rows.filter((x) => x.group === g.id);
    if (!inGroup.length) continue;
    const card = h('div', { class: 'card list tr-list' });
    for (const row of inGroup) {
      const isNew = state.painted && !state.keys.has(row.key);
      const el = trackerRow(row, isNew && !reducedMotion);
      if (open.has(row.key)) el.querySelector('.tr-ev')?.setAttribute('open', '');
      card.append(state.painted ? el : stagger(el, i++));
    }
    body.append(section(null, h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, `${g.name} (${inGroup.length})`)), card));
  }
  body.append(containersBlock(ctx, done) ?? '');
  if (r.checked?.capped) body.append(h('p', { class: 'note' }, 'Very long inline scripts were cut at 200 KB each and 2 MB in all.'));
  body.append(
    h(
      'p',
      { class: 'note' },
      'Read from this page’s code, the requests it made, its live state and the GTM containers it loads. Top frame only. Loupe never sends anything to these trackers.',
    ),
  );
  state.painted = true;
  state.keys = new Set(rows.map((x) => x.key));
}

export function render(ctx, el) {
  const body = h('div', { class: 'tr-body' }, h('div', { class: 'row-value muted tr-loading' }, spinner(), ' Looking for trackers…'));
  el.append(body);
  const state = { painted: false, keys: new Set() };
  let done = false;
  ctx.trackersPageReady.then(() => {
    if (!done) paint(ctx, body, false, state);
  });
  ctx.trackersReady.then(() => {
    done = true;
    paint(ctx, body, true, state);
  });
}
