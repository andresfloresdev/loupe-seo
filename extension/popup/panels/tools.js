import { api, runInTab } from '../../lib/api.js';
import { extractPAA, expandPAA } from '../../lib/inject.js';
import { UA_PRESETS, resolveUA, applyUA, activeUA } from '../../lib/ua.js';
import { IS_CHROME } from '../../lib/platform.js';
import { setSetting } from '../../lib/settings.js';
import { googleSearchUrl, bingSearchUrl, domainOf, isGoogleSerp, exactPhrase } from '../../lib/tools.js';
import { toCSV, csvFilename } from '../../lib/csv.js';
import { h, chip, section, button, copyButton, openUrl, icon, clear, toast, saveCsv, stagger, spinner, emptyState, extLink } from '../ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- user agent ------------------------------------------------------------

function uaSection(ctx) {
  const select = h('select', { class: 'select', 'aria-label': 'User agent' }, UA_PRESETS.map((p) => h('option', { value: p.id }, p.name)));
  select.value = ctx.settings.uaPreset || 'default';
  const custom = h('textarea', { class: 'input wide', rows: '2', placeholder: 'Paste a user-agent string', spellcheck: 'false' });
  custom.value = ctx.settings.uaCustom || '';
  const customWrap = h('div', { style: { 'margin-top': '8px' } }, custom);
  const status = h('div', { class: 'note', style: { margin: '10px 0 0' } }, spinner());
  const syncCustom = () => (customWrap.hidden = select.value !== 'custom');
  select.addEventListener('change', syncCustom);
  syncCustom();

  // Chrome switches this tab only (a per-tab rule); Safari can't scope a rule
  // to a tab, so there it switches every tab until reset.
  const tabId = ctx.tab?.id;
  const noTab = IS_CHROME && tabId == null;
  const paintStatus = (ua) => {
    clear(status);
    if (!ua) {
      status.append(chip('Off', 'neutral', { dot: true }), IS_CHROME ? ' This tab uses your browser’s own user agent.' : ' Requests use your browser’s own user agent.');
      return;
    }
    const preset = UA_PRESETS.find((p) => p.ua === ua);
    status.append(
      chip(`On · ${preset?.name ?? 'Custom'}`, 'good', { dot: true }),
      IS_CHROME ? ' Applies to this tab only, until you reset it or close the tab. The toolbar icon shows “UA” on it.' : ' Applies to every tab until you reset it. The toolbar icon shows “UA”.',
    );
  };
  activeUA(tabId).then(paintStatus, () => paintStatus(null));

  const apply = button(
    'Apply',
    async () => {
      const ua = resolveUA(select.value, custom.value);
      if (select.value === 'custom' && !ua) return toast('Paste a user-agent string first', 'error');
      try {
        await applyUA(ua, tabId);
        await setSetting('uaPreset', select.value);
        await setSetting('uaCustom', custom.value);
        paintStatus(ua);
        toast(ua ? (IS_CHROME ? 'Switched for this tab. Reload it to see it.' : 'Switched. Reload the page to see it.') : 'Back to the browser default');
      } catch (e) {
        toast(`Couldn’t switch: ${e?.message || e}`, 'error');
      }
    },
    { kind: 'primary', size: 'md', disabled: noTab },
  );
  const reset = button(
    'Reset',
    async () => {
      try {
        await applyUA(null, tabId);
      } catch (e) {
        return toast(`Couldn’t reset: ${e?.message || e}`, 'error');
      }
      await setSetting('uaPreset', 'default');
      select.value = 'default';
      syncCustom();
      paintStatus(null);
      toast('Back to the browser default');
    },
    { size: 'md', disabled: noTab },
  );
  const reload = button(
    'Reload tab',
    async () => {
      if (!ctx.tab) return;
      await api.tabs.reload(ctx.tab.id);
      toast('Tab reloaded');
    },
    { iconName: 'refresh', size: 'md', disabled: !ctx.tab },
  );

  return section(
    'User agent',
    h(
      'div',
      { class: 'card', style: { padding: '12px' } },
      h('div', { style: { display: 'flex' } }, select),
      customWrap,
      h('div', { class: 'toolbar', style: { margin: '8px 0 0' } }, apply, reset, h('span', { class: 'grow' }), reload),
      status,
      h(
        'p',
        { class: 'note', style: { 'margin-top': '6px' } },
        IS_CHROME
          ? 'Rewrites the User-Agent HTTP header for this tab only, so servers see the crawler. Scripts on the page still read the real one.'
          : 'Rewrites the User-Agent HTTP header for every tab until you reset it, so servers see the crawler. Scripts on the page still read the real one.',
      ),
    ),
  );
}

// ---- People Also Ask -----------------------------------------------------

function paaSection(ctx) {
  const onSerp = Boolean(ctx.tab?.url && isGoogleSerp(ctx.tab.url));
  const results = h('div');
  let questions = [];

  const paint = () => {
    clear(results);
    if (!questions.length) {
      results.append(h('div', { class: 'card' }, emptyState('No questions found', 'Scroll to the “People also ask” box so Google renders it, then try again.', 'search')));
      return;
    }
    const list = h('div', { class: 'card list' });
    questions.forEach((q, i) => {
      list.append(
        stagger(
          h(
            'div',
            { class: 'item' },
            h('span', { class: 'chip neutral', style: { 'margin-top': '1px' } }, String(i + 1)),
            h(
              'div',
              { class: 'item-main' },
              h('div', { class: 'item-title' }, q.question),
              q.answer ? h('div', { class: 'sub-line' }, q.answer.length > 220 ? `${q.answer.slice(0, 220)}…` : q.answer) : null,
              q.source ? h('div', { class: 'item-url' }, extLink(q.source, q.sourceTitle || q.source)) : null,
            ),
          ),
          i,
        ),
      );
    });
    results.append(
      h(
        'div',
        { class: 'toolbar' },
        chip(`${questions.length} questions`, 'accent'),
        h('span', { class: 'grow' }),
        copyButton(() => questions.map((q) => q.question).join('\n'), { label: 'Questions', toastText: 'Questions copied' }),
        button(
          'CSV',
          () =>
            saveCsv(
              ctx,
              toCSV(questions, [
                { key: 'question', label: 'Question' },
                { key: 'answer', label: 'Answer snippet' },
                { key: 'sourceTitle', label: 'Source title' },
                { key: 'source', label: 'Source URL' },
              ]),
              csvFilename('people-also-ask', ctx.tab.url),
            ),
          { iconName: 'download' },
        ),
      ),
      list,
    );
  };

  const run = async (expand) => {
    extract.disabled = more.disabled = true;
    clear(results).append(h('div', { class: 'muted' }, spinner(), expand ? ' Opening questions so Google loads more…' : ' Reading the results page…'));
    try {
      if (expand) {
        for (let round = 0; round < 3; round++) {
          const clicks = await runInTab(ctx.tab.id, expandPAA, [8]);
          if (!clicks) break;
          await sleep(1300);
        }
      }
      const res = await runInTab(ctx.tab.id, extractPAA);
      questions = res?.questions ?? [];
      paint();
    } catch (e) {
      clear(results).append(h('div', { class: 'card' }, emptyState('Couldn’t read the page', String(e?.message || e), 'alert')));
    } finally {
      extract.disabled = more.disabled = false;
    }
  };

  const extract = button('Extract questions', () => run(false), { kind: 'primary', size: 'md', disabled: !onSerp });
  const more = button('Load more, then extract', () => run(true), { size: 'md', disabled: !onSerp, title: 'Opens up to 24 questions so Google adds more to the box' });

  return section(
    'People also ask',
    h(
      'div',
      { class: 'card', style: { padding: '12px' } },
      h('div', { class: 'toolbar', style: { margin: 0 } }, extract, more),
      h('p', { class: 'note', style: { 'margin-top': '8px' } }, onSerp ? 'Pulls every question from the “People also ask” box on this results page.' : 'Open a Google search results page to extract its “People also ask” questions.'),
    ),
    h('div', { style: { 'margin-top': '8px' } }, results),
  );
}

// ---- searches ------------------------------------------------------------

function searchSection(ctx) {
  const url = ctx.page?.url ?? ctx.tab?.url ?? '';
  const web = /^https?:/i.test(url);
  const host = ctx.settings.googleDomain;
  const domain = web ? domainOf(url) : '';
  const head = ctx.page?.head ?? {};
  let bare = '';
  try {
    const u = new URL(url);
    bare = (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '');
  } catch {}

  const searches = [
    { label: `site:${domain || 'domain'}`, sub: 'Google', url: web && googleSearchUrl(`site:${domain}`, host) },
    { label: `site:${domain || 'domain'}`, sub: 'Bing', url: web && bingSearchUrl(`site:${domain}`) },
    { label: 'Is this URL indexed?', sub: 'site: + URL', url: web && googleSearchUrl(`site:${bare}`, host) },
    { label: 'Mentions of the domain', sub: 'Excluding the site', url: web && googleSearchUrl(`"${domain}" -site:${domain}`, host) },
    { label: 'Copies of the title', sub: 'Exact match', url: head.title && googleSearchUrl(`"${exactPhrase(head.title)}"`, host) },
    { label: 'Copies of the description', sub: 'Exact match', url: head.description && googleSearchUrl(`"${exactPhrase(head.description)}"`, host) },
  ];

  const grid = h('div', { class: 'tool-grid', style: { 'grid-template-columns': 'repeat(2, 1fr)', 'margin-top': 0 } });
  for (const s of searches) {
    grid.append(
      h(
        'button',
        { class: 'tool', type: 'button', disabled: !s.url, title: s.url || 'Needs a web page', onClick: () => openUrl(s.url), style: { height: '40px' } },
        h('span', { style: { display: 'grid', 'line-height': '1.25' } }, h('span', { style: { overflow: 'hidden', 'text-overflow': 'ellipsis' } }, s.label), h('span', { class: 'muted', style: { 'font-size': '10.5px', 'font-weight': '500' } }, s.sub)),
        icon('external', 12),
      ),
    );
  }
  return section(
    'Search',
    grid,
    h('p', { class: 'note' }, 'Select text on any page and right-click › Loupe SEO › Find copies of the selected text to check for duplicate content.'),
  );
}

export function render(ctx, el) {
  el.append(uaSection(ctx), paaSection(ctx), searchSection(ctx));
}
