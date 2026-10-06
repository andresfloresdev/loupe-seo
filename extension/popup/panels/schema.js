import { h, chip, section, segmented, copyButton, emptyState, button, openUrl, extLink, spinner, clear, append, saveCsv, stagger } from '../ui.js';
import { parseJsonLdBlocks, microdataTypeName, hreflangIssues, validHreflang, stripHash } from '../../lib/analysis.js';
import { toolUrl } from '../../lib/tools.js';
import { checkAlternate, mapLimit } from '../../lib/net.js';
import { toCSV, csvFilename } from '../../lib/csv.js';

// ---- JSON tree -------------------------------------------------------------

function leafValue(v) {
  if (v === null) return h('span', { class: 'j-null' }, 'null');
  if (typeof v === 'number') return h('span', { class: 'j-num' }, String(v));
  if (typeof v === 'boolean') return h('span', { class: 'j-bool' }, String(v));
  const s = String(v);
  if (/^https?:\/\//i.test(s)) return h('span', { class: 'j-str' }, '"', extLink(s, s), '"');
  return h('span', { class: 'j-str' }, JSON.stringify(s));
}

export function jsonTree(value, key = null, depth = 0) {
  if (value !== null && typeof value === 'object' && depth < 40) {
    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    const type = !isArray && value['@type'] ? [].concat(value['@type']).join(', ') : null;
    const summary = h(
      'summary',
      {},
      key !== null ? h('span', { class: 'j-key' }, String(key)) : null,
      key !== null ? ': ' : null,
      type ? h('span', { class: 'j-type' }, type) : null,
      h('span', { class: 'j-meta' }, isArray ? ` [${entries.length}]` : type ? '' : ` {${entries.length}}`),
    );
    const body = h('div');
    const details = h('details', { open: depth < 3 ? true : null }, summary, body);
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      for (const [k, v] of entries) body.append(jsonTree(v, isArray ? k : k, depth + 1));
    };
    if (details.open) fill();
    else details.addEventListener('toggle', fill, { once: true });
    return details;
  }
  return h('div', { class: 'leaf' }, key !== null ? [h('span', { class: 'j-key' }, String(key)), ': '] : null, leafValue(value));
}

// Microdata items as plain objects so they reuse the JSON tree.
export function microdataToObject(item) {
  const out = { '@type': microdataTypeName(item.type) };
  if (item.id) out['@id'] = item.id;
  for (const { name, value } of item.props) {
    const v = value && typeof value === 'object' ? microdataToObject(value) : value;
    if (name in out) out[name] = [].concat(out[name], v);
    else out[name] = v;
  }
  return out;
}

// ---- structured data view ------------------------------------------------

function structuredView(ctx) {
  const { page } = ctx;
  const wrap = h('div');
  const blocks = parseJsonLdBlocks(page.jsonld);
  const types = new Set();
  blocks.forEach((b) => b.ok && b.types.forEach((t) => types.add(t)));
  page.microdata.forEach((m) => types.add(microdataTypeName(m.type)));

  const actions = h(
    'div',
    { class: 'toolbar' },
    button('Rich Results', () => openUrl(toolUrl('richresults', 'page', page.url)), { iconName: 'external' }),
    button('Schema Validator', () => openUrl(toolUrl('schemaorg', 'page', page.url)), { iconName: 'external' }),
    h('span', { class: 'grow' }),
    blocks.length ? copyButton(() => page.jsonld.join('\n\n'), { label: 'All JSON-LD', toastText: 'JSON-LD copied' }) : null,
  );
  wrap.append(actions);

  if (!blocks.length && !page.microdata.length) {
    wrap.append(
      h('div', { class: 'card' }, emptyState('No structured data', page.rdfaTypes.length ? `Only RDFa found: ${page.rdfaTypes.join(', ')}` : 'No JSON-LD or microdata on this page.', 'file')),
    );
    return wrap;
  }

  if (types.size) {
    wrap.append(h('div', { class: 'chips', style: { 'margin-bottom': '10px' } }, [...types].map((t) => chip(t, 'accent'))));
  }

  blocks.forEach((b, i) => {
    if (!b.ok) {
      wrap.append(
        stagger(
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'card-head' }, h('span', { class: 'card-title grow' }, `JSON-LD #${i + 1}`), chip('Invalid JSON', 'bad', { dot: true })),
            h('div', { class: 'note', style: { margin: '8px 10px 0' } }, b.error),
            h('pre', { class: 'raw' }, b.text),
          ),
          i,
        ),
      );
      return;
    }
    wrap.append(
      stagger(
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'card-head' },
            h('span', { class: 'card-title' }, `JSON-LD #${i + 1}`),
            h('span', { class: 'grow muted', style: { overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } }, b.types.join(', ')),
            copyButton(() => JSON.stringify(b.data, null, 2), { label: null, title: 'Copy this block', toastText: 'Block copied' }),
          ),
          h('div', { class: 'json' }, jsonTree(b.data)),
        ),
        i,
      ),
    );
  });

  page.microdata.forEach((item, i) => {
    const obj = microdataToObject(item);
    wrap.append(
      stagger(
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'card-head' },
            h('span', { class: 'card-title' }, 'Microdata'),
            h('span', { class: 'grow muted' }, microdataTypeName(item.type)),
            copyButton(() => JSON.stringify(obj, null, 2), { label: null, title: 'Copy as JSON', toastText: 'Item copied' }),
          ),
          h('div', { class: 'json' }, jsonTree(obj)),
        ),
        blocks.length + i,
      ),
    );
  });

  if (page.rdfaTypes.length) wrap.append(h('p', { class: 'note' }, `RDFa types: ${page.rdfaTypes.join(', ')}`));
  return wrap;
}

// ---- hreflang view -------------------------------------------------------

function hreflangEntries(ctx) {
  const entries = ctx.page.hreflang.map((e) => ({ ...e, source: 'html' }));
  for (const l of ctx.http?.linkHeader ?? []) {
    if (!l.hreflang) continue;
    let href = l.url;
    try {
      href = new URL(l.url, ctx.page.url).href;
    } catch {}
    entries.push({ lang: l.hreflang, href, raw: l.url, source: 'header' });
  }
  return entries;
}

function statusChips(entry, result, pageUrl) {
  const out = [];
  if (!result) return [spinner()];
  if (result.error) return [chip('Failed', 'bad', { title: result.error })];
  const kind = result.status < 300 ? 'good' : result.status < 400 ? 'warn' : 'bad';
  if (result.redirected) out.push(chip(`3xx → ${result.status}`, 'warn', { title: `Redirects to ${result.finalUrl}` }));
  else out.push(chip(String(result.status), kind, { title: result.statusText }));
  const self = stripHash(entry.href) === stripHash(pageUrl);
  if (self) out.push(chip('This page', 'accent'));
  else if (result.returnLink === true) out.push(chip('Links back', 'good', { title: 'This alternate lists the current page in its hreflang set' }));
  else if (result.returnLink === false) out.push(chip('No return link', 'warn', { title: 'Hreflang must be reciprocal' }));
  return out;
}

function hreflangView(ctx) {
  const wrap = h('div');
  const pageUrl = ctx.page.url;
  const entries = hreflangEntries(ctx);
  if (!entries.length) {
    wrap.append(h('div', { class: 'card' }, emptyState('No hreflang', 'No alternate language versions are declared (HTML or Link header).', 'globe')));
    return wrap;
  }
  ctx.hreflangChecks ??= new Map();
  const issues = hreflangIssues(entries, pageUrl);
  wrap.append(
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'chips' }, issues.length ? issues.map((i) => chip(i.text, i.level === 'error' ? 'bad' : 'warn', { dot: true })) : chip('No issues found', 'good', { dot: true })),
      h('span', { class: 'grow' }),
      button('CSV', () => {
        const rows = entries.map((e) => {
          const r = ctx.hreflangChecks.get(e.href) ?? {};
          return { ...e, status: r.status ?? '', finalUrl: r.finalUrl ?? '', returnLink: r.returnLink == null ? '' : r.returnLink ? 'yes' : 'no' };
        });
        saveCsv(
          ctx,
          toCSV(rows, [
            { key: 'lang', label: 'hreflang' },
            { key: 'href', label: 'URL' },
            { key: 'source', label: 'Declared in' },
            { key: 'status', label: 'Status' },
            { key: 'finalUrl', label: 'Final URL' },
            { key: 'returnLink', label: 'Links back' },
          ]),
          csvFilename('hreflang', pageUrl),
        );
      }, { iconName: 'download' }),
    ),
  );

  const list = h('div', { class: 'card' });
  const slots = new Map();
  entries.forEach((e, i) => {
    const status = h('div', { class: 'hl-status' });
    slots.set(i, status);
    list.append(
      stagger(
        h(
          'div',
          { class: 'hl-row' },
          h('span', { class: 'hl-lang' }, validHreflang(e.lang) ? e.lang : chip(e.lang, 'bad')),
          h('div', { class: 'hl-url' }, h('div', { class: 'item-url', title: e.href }, extLink(e.href, e.href)), e.source === 'header' ? h('div', { class: 'item-meta' }, chip('Link header', 'neutral')) : null),
          status,
        ),
        i,
      ),
    );
  });
  wrap.append(list);
  wrap.append(h('p', { class: 'note' }, 'Each alternate is fetched to read its status and check that it links back to this page.'));

  const paint = (i, e) => {
    clear(slots.get(i));
    append(slots.get(i), statusChips(e, ctx.hreflangChecks.get(e.href), pageUrl));
  };
  entries.forEach((e, i) => paint(i, e));
  mapLimit(entries, 4, async (e, i) => {
    if (!ctx.hreflangChecks.has(e.href)) ctx.hreflangChecks.set(e.href, await checkAlternate(e, pageUrl));
    paint(i, e);
  });
  return wrap;
}

// ---- panel -----------------------------------------------------------------

export function render(ctx, el) {
  const blocks = ctx.page.jsonld.length + ctx.page.microdata.length;
  const body = h('div');
  let view = 'structured';
  const show = async () => {
    clear(body);
    if (view === 'structured') body.append(structuredView(ctx));
    else {
      body.append(h('div', { class: 'muted' }, spinner(), ' Reading headers…'));
      await ctx.httpReady;
      clear(body);
      body.append(hreflangView(ctx));
    }
    body.classList.remove('fade-in');
    void body.offsetWidth;
    body.classList.add('fade-in');
  };
  const seg = segmented(
    [
      { value: 'structured', label: 'Structured data', count: blocks },
      { value: 'hreflang', label: 'Hreflang', count: ctx.page.hreflang.length },
    ],
    view,
    (v) => {
      view = v;
      show();
    },
  );
  el.append(h('div', { class: 'toolbar' }, seg), body);
  show();
  // Link-header alternates are only known once the headers arrive.
  ctx.httpReady.then(() => {
    const count = seg.querySelector('[data-value="hreflang"] .seg-count');
    if (count) count.textContent = String(hreflangEntries(ctx).length);
  });
}
