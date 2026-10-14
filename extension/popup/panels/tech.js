import { h, chip, section, copyButton, emptyState, spinner, icon, clear, stagger, reducedMotion } from '../ui.js';
import { GROUPS, updateLabel, copyList } from '../../lib/tech.js';

// Tech tab. Page results paint first (ctx.techPageReady), then what the
// site's own WordPress URLs say (ctx.techProbesReady), then the latest
// versions (ctx.techReady). Every page string reaches the DOM through h()
// (textContent), never innerHTML.

const count = (n, word) => `${n ?? 0} ${word}${n === 1 ? '' : 's'}`;

function updateChip(update) {
  const u = updateLabel(update);
  return u ? chip(u.label, u.kind, { dot: u.kind !== 'neutral', title: u.hint ?? undefined }) : null;
}

function evidenceList(evidence) {
  if (!evidence?.length) return null;
  return h(
    'details',
    { class: 'tr-ev' },
    h('summary', {}, icon('chevron', 11), h('span', {}, evidence.length === 1 ? '1 signal' : `${evidence.length} signals`)),
    h('ul', {}, evidence.map((e) => h('li', {}, e))),
  );
}

// One row: name, version (or none: never a guess), "Likely" when inferred,
// the update status on the right, then a detail line and the evidence.
function techRow({ key, name, version, likely, hidden, update, sub, evidence }, isNew) {
  return h(
    'div',
    { class: `tr-row te-row${isNew ? ' tr-new' : ''}`, dataset: { key } },
    h(
      'div',
      { class: 'tr-head' },
      h(
        'div',
        { class: 'tr-name' },
        h('b', {}, name),
        version ? h('span', { class: 'mono te-version' }, version) : hidden ? h('span', { class: 'te-hidden' }, 'version hidden') : null,
        likely ? chip('Likely', 'outline', { title: 'Inferred, not stated by the site. Open the signals to see from what.' }) : null,
      ),
      updateChip(update),
    ),
    sub ? h('div', { class: 'te-sub muted' }, sub) : null,
    evidenceList(evidence),
  );
}

function rowsFor(result, groupId) {
  if (groupId === 'wordpress') {
    const wp = result.wordpress;
    if (!wp) return [];
    const themes = wp.themes.map((t) => ({
      key: t.key,
      name: t.name,
      version: t.version,
      update: t.update,
      sub: [
        t.child ? (t.parent ? `Child theme of ${t.parent}` : 'Child theme') : t.parentOf ? `Parent theme of ${t.parentOf}` : 'Theme',
        t.name !== t.slug ? `folder ${t.slug}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      evidence: t.evidence,
    }));
    const plugins = wp.plugins.map((pl) => ({
      key: pl.key,
      name: pl.name,
      version: pl.version,
      hidden: !pl.version,
      update: pl.update,
      sub: pl.named ? null : 'Plugin folder name',
      evidence: pl.evidence,
    }));
    return [...themes, ...plugins];
  }
  return result.tech
    .filter((r) => r.group === groupId)
    .map((r) => ({
      key: r.key,
      name: r.name,
      version: r.version,
      likely: r.confidence === 'likely',
      update: r.update,
      sub: r.detail,
      evidence: r.evidence,
    }));
}

function namespacesBlock(wp) {
  if (!wp?.namespaces?.length) return null;
  return h(
    'details',
    { class: 'tr-ev te-ns' },
    h('summary', {}, icon('chevron', 11), h('span', {}, `${count(wp.namespaces.length, 'REST namespace')}${wp.otherNamespaces.length ? `, ${wp.otherNamespaces.length} not matched to a plugin` : ''}`)),
    h('ul', { class: 'mono' }, wp.namespaces.map((n) => h('li', {}, n))),
  );
}

// What Loupe read from the site itself, on WordPress pages.
function probesBlock(ctx, stage) {
  const wp = ctx.tech?.wordpress;
  if (!wp) return null;
  if (stage === 'page') {
    return ctx.techProbeTargets ? h('p', { class: 'note tr-reading' }, spinner(), ' Reading the site’s feed, REST index and theme…') : null;
  }
  if (!wp.probes.length) return null;
  return h(
    'div',
    { class: 'card tr-containers te-probes' },
    wp.probes.map((pr) =>
      h(
        'div',
        { class: 'tr-container', dataset: { state: pr.ok ? 'ok' : 'failed' } },
        icon(pr.ok ? 'check' : 'alert', 12),
        h('span', {}, pr.label),
        h('span', { class: 'muted' }, pr.ok ? (pr.capped ? 'Read (first 1 MB)' : 'Read') : `Couldn’t read${pr.error ? ` (${pr.error})` : ''}`),
      ),
    ),
  );
}

function emptyText(r) {
  const c = r.checked ?? {};
  const parts = [count(c.generators, 'generator tag'), count(c.urls, 'asset URL'), count(c.inline, 'inline script'), count(c.comments, 'HTML comment')];
  if (c.headers) parts.push('the response headers');
  if (c.live) parts.push('the page’s live state');
  return `Checked ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}

function paint(ctx, body, stage, state) {
  const r = ctx.tech;
  const open = new Set([...body.querySelectorAll('.tr-ev[open]')].map((d) => d.closest('.tr-row')?.dataset.key ?? d.className));
  clear(body);

  if (!r || r.error) {
    body.append(emptyState('Couldn’t read the page’s tech', r?.error ?? 'The page returned no data.', 'alert'));
    return;
  }

  const groups = GROUPS.map((g) => ({ ...g, rows: rowsFor(r, g.id) })).filter((g) => g.rows.length);
  if (!groups.length) {
    body.append(h('div', { class: 'card tr-empty te-empty' }, emptyState('Nothing recognized', emptyText(r), 'search')));
    return;
  }

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  body.append(
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'chips grow' },
        chip(total === 1 ? '1 technology' : `${total} technologies`, 'neutral'),
        stage !== 'done' ? h('span', { class: 'te-checking muted' }, spinner(), stage === 'page' && ctx.techProbeTargets ? ' Reading the site…' : ' Checking latest versions…') : null,
      ),
      copyButton(() => copyList(ctx.tech), { label: 'Copy list', title: 'Copy every technology and its version', toastText: 'Tech list copied' }),
    ),
  );

  let i = 0;
  for (const g of groups) {
    const card = h('div', { class: 'card list tr-list' });
    for (const row of g.rows) {
      const isNew = state.painted && !state.keys.has(row.key);
      const el = techRow(row, isNew && !reducedMotion);
      if (open.has(row.key)) el.querySelector('.tr-ev')?.setAttribute('open', '');
      card.append(state.painted ? el : stagger(el, i++));
    }
    const extra = g.id === 'wordpress' ? namespacesBlock(r.wordpress) : null;
    if (extra) {
      if (open.has(extra.className)) extra.setAttribute('open', '');
      card.append(h('div', { class: 'tr-row te-ns-row' }, extra));
    }
    body.append(section(null, h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, `${g.name} (${g.rows.length})`)), card));
  }
  const probes = probesBlock(ctx, stage);
  if (probes) body.append(section(stage === 'page' ? null : 'Read from the site', probes));
  body.append(
    h(
      'p',
      { class: 'note' },
      r.wordpress
        ? 'Read from this page’s code, its response headers and live state, and the site’s own feed, REST index and theme stylesheet. Latest versions from wordpress.org and npm: only a plugin, theme or package name is sent.'
        : 'Read from this page’s code, its response headers and live state. Latest versions from npm: only a package name is sent. No version shown means the site doesn’t give it away.',
    ),
  );
  state.painted = true;
  state.keys = new Set(groups.flatMap((g) => g.rows.map((x) => x.key)));
}

export function render(ctx, el) {
  const body = h('div', { class: 'tr-body te-body' }, h('div', { class: 'row-value muted tr-loading' }, spinner(), ' Reading the page’s tech…'));
  el.append(body);
  const state = { painted: false, keys: new Set() };
  let stage = 'page';
  const at = (s) => () => {
    const order = ['page', 'probes', 'done'];
    if (order.indexOf(s) < order.indexOf(stage)) return;
    stage = s;
    paint(ctx, body, s, state);
  };
  ctx.techPageReady.then(at('page'));
  ctx.techProbesReady.then(at('probes'));
  ctx.techReady.then(at('done'));
}
