import { api, runInTab } from '../lib/api.js';
import { collectPage, collectTrackerSignals, readTrackerState } from '../lib/inject.js';
import { fetchPageHeaders, fetchRobotsTxt, fetchGtmContainer } from '../lib/net.js';
import { detectTrackers, containerTargets, LIVE_GLOBALS } from '../lib/trackers.js';
import { getSettings } from '../lib/settings.js';
import { IS_CHROME } from '../lib/platform.js';
import { syncPopupUA } from '../lib/ua.js';
import { h, icon, clear, emptyState, reducedMotion } from './ui.js';
import * as overview from './panels/overview.js';
import * as headings from './panels/headings.js';
import * as links from './panels/links.js';
import * as images from './panels/images.js';
import * as schema from './panels/schema.js';
import * as social from './panels/social.js';
import * as trackers from './panels/trackers.js';
import * as tools from './panels/tools.js';
import * as settings from './panels/settings.js';

const PANELS = { overview, headings, links, images, schema, social, trackers, tools, settings };
// Panels that work without page data (no host access, or a non-web page).
const STANDALONE = new Set(['tools', 'settings']);
const ORDER = Object.keys(PANELS);

const ctx = {
  tab: null,
  page: null,
  pageError: null,
  settings: null,
  http: null,
  robots: null,
  httpReady: null,
  robotsReady: null,
  // Trackers: page results first, then with the GTM containers the page loads.
  trackers: null,
  trackerContainers: null,
  trackersPageReady: null,
  trackersReady: null,
  rendered: new Set(),
  show: (name) => showTab(name),
};

let current = 'overview';
let loadId = 0;

// ---- tabs ------------------------------------------------------------------

function placeInk(instant) {
  const active = document.querySelector(`.tabs [data-tab="${current}"]`);
  const ink = document.getElementById('tabInk');
  if (!active || !ink) return;
  if (instant) ink.style.transition = 'none';
  const inset = active.classList.contains('tab-icon') ? 2 : 3; // the tabs' side padding (popup.css), less 2 px on the gear
  ink.style.width = `${active.offsetWidth - inset * 2}px`;
  ink.style.transform = `translateX(${active.offsetLeft + inset}px)`;
  if (instant) requestAnimationFrame(() => ink.style.removeProperty('transition'));
}

function renderPanel(name) {
  const el = document.getElementById(`panel-${name}`);
  if (ctx.rendered.has(name)) return el;
  clear(el);
  if (!ctx.page && !STANDALONE.has(name)) {
    el.append(ctx.pageError ? errorState() : loadingState());
    if (!ctx.pageError) return el; // retried once data arrives
  } else {
    try {
      PANELS[name].render(ctx, el);
    } catch (e) {
      console.error(e);
      el.append(emptyState('Something went wrong', String(e?.message || e), 'alert'));
    }
  }
  ctx.rendered.add(name);
  return el;
}

function showTab(name) {
  if (!PANELS[name]) return;
  const prev = current;
  current = name;
  for (const b of document.querySelectorAll('.tabs [data-tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  }
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
  const el = renderPanel(name);
  if (!reducedMotion && prev !== name) {
    el.classList.remove('entering', 'from-left');
    void el.offsetWidth;
    el.classList.add('entering');
    if (ORDER.indexOf(name) < ORDER.indexOf(prev)) el.classList.add('from-left');
  }
  placeInk(false);
}

function setupTabs() {
  document.querySelector('.tabs [data-tab="settings"]').append(icon('gear', 14));
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= ORDER.length) showTab(ORDER[n - 1]);
  });
  new ResizeObserver(() => placeInk(true)).observe(document.getElementById('tabs'));
}

// ---- states ----------------------------------------------------------------

function loadingState() {
  return h(
    'div',
    { class: 'skeleton' },
    h('div', { class: 'sk lg' }),
    h('div', { class: 'sk', style: { width: '40%' } }),
    h('div', { class: 'sk' }),
    h('div', { class: 'sk', style: { width: '85%' } }),
    h('div', { class: 'sk', style: { width: '30%' } }),
    h('div', { class: 'sk' }),
    h('div', { class: 'sk', style: { width: '70%' } }),
  );
}

function errorState() {
  const e = ctx.pageError;
  if (e.kind === 'unsupported') {
    return emptyState('Open a web page to inspect it', 'Loupe works on http and https pages. Tools and Settings still work here.', 'globe');
  }
  const box = emptyState(
    'Loupe can’t read this page',
    IS_CHROME
      ? 'Loupe reads web pages once your browser allows it. Open the extensions page, click Details on Loupe SEO and set Site access to “On all sites”. Browser pages like the New Tab page and the Web Store can’t be inspected.'
      : 'Loupe reads web pages once Safari allows it. On a website, click the Loupe icon and choose “Always Allow on This Website”, or turn it on in Safari Settings › Extensions › Loupe SEO › Edit Websites. Browser pages like Start Page can’t be inspected.',
    'lock',
  );
  box.append(h('p', { class: 'note mono' }, e.message));
  return box;
}

// ---- data ------------------------------------------------------------------

// Read-only: the page's code and requests (isolated world), the trackers' live
// state (the page's own world), then the GTM containers it loads, fetched from
// here. A later load() wins over an earlier one still running.
function loadTrackers(tabId, id) {
  const mine = () => id === loadId;
  let signals = null;
  const page = (async () => {
    signals = await runInTab(tabId, collectTrackerSignals);
    if (!signals) throw new Error('The page returned no data.');
    signals.live = await runInTab(tabId, readTrackerState, [LIVE_GLOBALS], { world: 'MAIN' }).catch((e) => {
      console.warn('[loupe] page-world read', e);
      return null;
    });
    const result = detectTrackers(signals);
    if (mine()) {
      ctx.trackerContainers = containerTargets(signals, result);
      ctx.trackers = result;
    }
    return result;
  })().catch((e) => {
    const result = { error: String(e?.message || e) };
    if (mine()) ctx.trackers = result;
    return result;
  });
  const all = page
    .then(async (result) => {
      if (result.error) return result;
      const targets = containerTargets(signals, result);
      if (!targets.length) return result;
      const containers = await Promise.all(targets.map(async (t) => ({ ...t, ...(await fetchGtmContainer(t.url)) })));
      const full = detectTrackers(signals, containers);
      if (mine()) ctx.trackers = full;
      return full;
    })
    .catch((e) => {
      // Keep the page results; the containers just stay unread.
      console.warn('[loupe] GTM containers', e);
      return ctx.trackers;
    });
  return { page, all };
}

async function resolveTab() {
  // ?tabId= lets the popup page inspect a specific tab (used by the test suite).
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return api.tabs.get(Number(forced));
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function setHeader() {
  const title = ctx.page?.head?.title || ctx.tab?.title || 'Loupe SEO';
  const url = ctx.page?.url || ctx.tab?.url || '';
  document.getElementById('pageTitle').textContent = title;
  let host = 'No web page';
  try {
    const u = new URL(url);
    if (/^https?:$/.test(u.protocol)) host = u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {}
  document.getElementById('pageHost').textContent = host;
  const fav = document.getElementById('favicon');
  const src = ctx.tab?.favIconUrl || ctx.page?.head?.favicon;
  if (src && /^(https?:|data:image\/)/.test(src)) {
    fav.removeAttribute('data-missing');
    fav.src = src;
    fav.onerror = () => fav.setAttribute('data-missing', '');
  } else {
    fav.setAttribute('data-missing', '');
  }
}

async function load() {
  ctx.page = null;
  ctx.pageError = null;
  ctx.http = null;
  ctx.robots = null;
  ctx.trackers = null;
  ctx.trackerContainers = null;
  const id = ++loadId;
  ctx.rendered.clear();
  document.getElementById('app').dataset.state = 'loading';
  clear(document.getElementById(`panel-${current}`)).append(loadingState());

  ctx.settings = await getSettings();
  ctx.tab = await resolveTab();
  const url = ctx.tab?.url ?? '';
  // Chrome: before any request of ours, give them this tab's user agent.
  await syncPopupUA(ctx.tab?.id).catch((e) => console.warn('[loupe] popup user agent', e));

  if (!ctx.tab || (url && !/^https?:/i.test(url))) {
    ctx.pageError = { kind: 'unsupported' };
  } else {
    try {
      ctx.page = await runInTab(ctx.tab.id, collectPage);
      if (!ctx.page) throw new Error('The page returned no data.');
    } catch (e) {
      ctx.pageError = { kind: 'access', message: String(e?.message || e) };
    }
  }

  const pageUrl = ctx.page?.url || url;
  if (ctx.page) {
    ctx.httpReady = fetchPageHeaders(pageUrl).then((r) => (ctx.http = r.error ? { ...r, failed: true } : r));
    ctx.robotsReady = fetchRobotsTxt(pageUrl).then((r) => (ctx.robots = r.error ? { ...r, failed: true } : r));
    const t = loadTrackers(ctx.tab.id, id);
    ctx.trackersPageReady = t.page;
    ctx.trackersReady = t.all;
  } else {
    ctx.httpReady = Promise.resolve(null);
    ctx.robotsReady = Promise.resolve(null);
    ctx.trackersPageReady = Promise.resolve(null);
    ctx.trackersReady = Promise.resolve(null);
  }

  setHeader();
  document.getElementById('app').dataset.state = ctx.page ? 'ready' : 'error';
  ctx.rendered.clear();
  showTab(current);
}

// ---- boot ------------------------------------------------------------------

function setupRefresh() {
  const btn = document.getElementById('refresh');
  btn.append(icon('refresh', 15));
  btn.addEventListener('click', () => {
    btn.classList.remove('spin');
    void btn.offsetWidth;
    btn.classList.add('spin');
    load();
  });
}

setupTabs();
setupRefresh();
placeInk(true);
load();

// Exposed for the e2e suite.
globalThis.__loupeCtx = ctx;
