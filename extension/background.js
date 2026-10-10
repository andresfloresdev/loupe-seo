import { api } from './lib/api.js';
import { TOOLS, toolUrl, siteSearchUrl, duplicateSearchUrl } from './lib/tools.js';
import { getSettings, setSetting } from './lib/settings.js';
import { IS_CHROME, PLATFORM } from './lib/platform.js';
import { syncBadge, forgetTab, restoreTabBadge } from './lib/ua.js';

// ---- context menus ------------------------------------------------------

// contextMenus.create returns synchronously and items are created in call
// order, so nothing is awaited (some engines never invoke the callback). The
// callback only reads lastError so a duplicate id can't surface as an error.
function create(props) {
  try {
    api.contextMenus.create(props, () => void api.runtime.lastError);
  } catch (e) {
    console.warn('[loupe] menu', props.id, e);
  }
}

let building = Promise.resolve();

export function buildMenus() {
  building = building.catch(() => {}).then(async () => {
    await api.contextMenus.removeAll();
    const { highlightNofollow } = await getSettings();
    const PAGE = ['page'];
    // Safari does not inherit contexts from a parent item, so every item sets its own.
    create({ id: 'loupe', title: 'Loupe SEO', contexts: ['page', 'link', 'selection'] });

    create({ id: 'page', parentId: 'loupe', title: 'Open page in', contexts: PAGE });
    for (const t of TOOLS.filter((t) => t.page)) {
      create({ id: `page:${t.id}`, parentId: 'page', title: t.name, contexts: PAGE });
    }
    create({ id: 'domain', parentId: 'loupe', title: 'Open domain in', contexts: PAGE });
    for (const t of TOOLS.filter((t) => t.domain)) {
      create({ id: `domain:${t.id}`, parentId: 'domain', title: t.name, contexts: PAGE });
    }
    create({ id: 'link', parentId: 'loupe', title: 'Open link in', contexts: ['link'] });
    for (const t of TOOLS.filter((t) => t.page)) {
      create({ id: `link:${t.id}`, parentId: 'link', title: t.name, contexts: ['link'] });
    }
    create({ id: 'site-search', parentId: 'loupe', title: 'site: search on Google', contexts: ['page', 'link'] });
    create({ id: 'dupes', parentId: 'loupe', title: 'Find copies of the selected text', contexts: ['selection'] });
    create({ id: 'sep', parentId: 'loupe', type: 'separator', contexts: ['page', 'link'] });
    create({
      id: 'nofollow',
      parentId: 'loupe',
      type: 'checkbox',
      checked: highlightNofollow,
      title: 'Highlight nofollow links',
      contexts: ['page', 'link'],
    });
  });
  return building.catch((e) => console.error('[loupe] menus', e));
}

// Resolve a clicked menu item to the URL to open (or an action). Exported for tests.
export function menuTarget(info, tab, settings) {
  const id = String(info.menuItemId);
  const pageUrl = info.pageUrl || tab?.url || '';
  const [kind, toolId] = id.split(':');
  if (kind === 'page') return { url: toolUrl(toolId, 'page', pageUrl) };
  if (kind === 'domain') return { url: toolUrl(toolId, 'domain', pageUrl) };
  if (kind === 'link') return { url: toolUrl(toolId, 'page', info.linkUrl) };
  if (id === 'site-search') return { url: siteSearchUrl(info.linkUrl || pageUrl, settings.googleDomain) };
  if (id === 'dupes') return { url: duplicateSearchUrl(info.selectionText, settings.googleDomain) };
  if (id === 'nofollow') return { setting: ['highlightNofollow', Boolean(info.checked)] };
  return {};
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await getSettings();
  const target = menuTarget(info, tab, settings);
  if (target.setting) {
    await setSetting(...target.setting);
    return;
  }
  if (!target.url) return;
  const props = { url: target.url };
  if (tab && typeof tab.index === 'number') props.index = tab.index + 1;
  await api.tabs.create(props);
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.highlightNofollow) {
    api.contextMenus.update('nofollow', { checked: Boolean(changes.highlightNofollow.newValue) }, () => {
      void api.runtime.lastError;
    });
  }
});

// ---- lifecycle ----------------------------------------------------------

api.runtime.onInstalled.addListener(() => {
  buildMenus();
  syncBadge().catch(() => {});
});

api.runtime.onStartup.addListener(() => {
  buildMenus();
  syncBadge().catch(() => {});
});

// Chrome's user agent switch is per tab (lib/ua.js): a closed tab takes its
// rules with it, and Chrome clears a tab's badge on every navigation, so it is
// put back while the tab stays switched. Safari's switch is global: nothing to
// do per tab there.
if (IS_CHROME) {
  api.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId).catch((e) => console.warn('[loupe] forget tab', e));
  });
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status || changeInfo.url) restoreTabBadge(tabId).catch(() => {});
  });
}

// Safari can unload and relaunch the background worker without firing either
// event above. Rebuild once per browser session, tracked in session storage.
(async () => {
  try {
    if (!api.storage.session) return;
    const { menusBuilt } = await api.storage.session.get('menusBuilt');
    if (!menusBuilt) {
      await buildMenus();
      await api.storage.session.set({ menusBuilt: true });
    }
  } catch (e) {
    console.error('[loupe] session init', e);
  }
})();

// Test hook: lets the e2e suite reach the pure resolver from the worker, and
// read which browser path the worker took.
globalThis.__loupe = { menuTarget, buildMenus, platform: PLATFORM };
