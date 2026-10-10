import { api } from './api.js';
import { IS_CHROME } from './platform.js';

// The switch rewrites the User-Agent request header with declarativeNetRequest.
// - Safari (16.4+) has no per-tab rule conditions, so one dynamic rule applies
//   to every tab until it is reset, and the toolbar badge shows "UA" while it
//   is on.
// - Chrome scopes it to one tab: a session rule with condition.tabIds, the
//   badge on that tab only, both gone when the tab closes. Loupe's own popup
//   requests (headers, robots.txt, hreflang) are in no tab (tabId -1), so a
//   second session rule gives them the user agent of the tab the popup is
//   inspecting, as the global rule does in Safari.

const CHROME = '141.0.7390.122';

export const UA_PRESETS = [
  { id: 'default', name: 'Browser default', ua: null },
  {
    id: 'googlebot-smartphone',
    name: 'Googlebot Smartphone',
    ua: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
  },
  {
    id: 'googlebot-desktop',
    name: 'Googlebot Desktop',
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: 'bingbot',
    name: 'Bingbot',
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: 'gptbot',
    name: 'GPTBot (OpenAI)',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  },
  {
    id: 'claudebot',
    name: 'ClaudeBot (Anthropic)',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  },
  {
    id: 'perplexitybot',
    name: 'PerplexityBot',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  },
  {
    id: 'iphone',
    name: 'iPhone Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android-chrome',
    name: 'Android Chrome',
    ua: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36`,
  },
  {
    id: 'windows-chrome',
    name: 'Windows Chrome',
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`,
  },
  { id: 'custom', name: 'Custom…', ua: null },
];

// Safari: the one dynamic rule, for every tab.
export const UA_RULE_ID = 1;

// Chrome: one session rule per switched tab, found by its tabIds condition
// (tab ids are too large to derive rule ids from), plus one rule for the
// popup's own requests. Session rules last until the browser quits.
export const POPUP_RULE_ID = 2;
const FIRST_TAB_RULE_ID = 3;
// tabs.TAB_ID_NONE: requests from the toolbar popup belong to no tab.
const TAB_ID_NONE = -1;
// storage.session key: the tab whose user agent the popup rule carries.
const POPUP_TAB_KEY = 'uaPopupTab';

const BADGE_COLOR = '#0B8F64';

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

export function uaRule(ua) {
  return {
    id: UA_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }],
    },
    // Without resourceTypes, main_frame requests would not match.
    condition: { resourceTypes: RESOURCE_TYPES },
  };
}

// Chrome: the tab's own requests (the page, its frames and subresources).
export function tabRule(ua, tabId, id) {
  if (!IS_CHROME) throw new Error('Per-tab rules need Chrome');
  const rule = uaRule(ua);
  return { ...rule, id, condition: { ...rule.condition, tabIds: [tabId] } };
}

// Chrome: Loupe's own requests while its popup inspects a switched tab. They
// come from no tab, or from the popup's own tab when it is opened as a page
// (the e2e suite does that). initiatorDomains keeps out every request Loupe
// did not start itself, such as a site's own service worker; tabIds keeps out
// pages Loupe opens or reloads.
export function popupRule(ua, extensionId, ownTabId) {
  if (!IS_CHROME) throw new Error('Per-tab rules need Chrome');
  const rule = uaRule(ua);
  const tabIds = ownTabId == null ? [TAB_ID_NONE] : [TAB_ID_NONE, ownTabId];
  return { ...rule, id: POPUP_RULE_ID, condition: { ...rule.condition, tabIds, initiatorDomains: [extensionId] } };
}

const ruleUA = (rule) => rule?.action?.requestHeaders?.[0]?.value ?? null;
const isTabRule = (rule) => rule.id !== POPUP_RULE_ID && rule.condition?.tabIds?.length === 1;
const tabRuleFor = (rules, tabId) => rules.find((r) => isTabRule(r) && r.condition.tabIds[0] === tabId);

function freeRuleId(rules) {
  const taken = new Set(rules.map((r) => r.id));
  let id = FIRST_TAB_RULE_ID;
  while (taken.has(id)) id++;
  return id;
}

export function resolveUA(presetId, custom) {
  if (presetId === 'custom') return (custom ?? '').trim() || null;
  return UA_PRESETS.find((p) => p.id === presetId)?.ua ?? null;
}

// The user agent requests from this tab get, or null. Safari ignores tabId:
// its one rule covers every tab.
export async function activeUA(tabId) {
  if (IS_CHROME) {
    if (tabId == null) return null;
    return ruleUA(tabRuleFor(await api.declarativeNetRequest.getSessionRules(), tabId));
  }
  const rules = await api.declarativeNetRequest.getDynamicRules();
  return ruleUA(rules.find((r) => r.id === UA_RULE_ID));
}

// Switch the user agent (null resets it). Chrome switches tabId only; Safari
// switches every tab.
export async function applyUA(ua, tabId) {
  if (IS_CHROME) return applyTabUA(ua, tabId);
  const update = { removeRuleIds: [UA_RULE_ID] };
  if (ua) update.addRules = [uaRule(ua)];
  await api.declarativeNetRequest.updateDynamicRules(update);
  await setGlobalBadge(ua);
}

async function applyTabUA(ua, tabId) {
  if (!IS_CHROME) throw new Error('Per-tab rules need Chrome');
  if (tabId == null) throw new Error('No tab to switch');
  const rules = await api.declarativeNetRequest.getSessionRules();
  const old = tabRuleFor(rules, tabId);
  const update = { removeRuleIds: old ? [old.id] : [] };
  if (ua) update.addRules = [tabRule(ua, tabId, old?.id ?? freeRuleId(rules))];
  await api.declarativeNetRequest.updateSessionRules(update);
  await syncPopupUA(tabId);
  await setTabBadge(tabId, ua);
}

// Chrome: give the popup's own requests the user agent of the tab it inspects,
// or none. The popup calls this before any request it makes, so a rule left by
// an earlier popup never reaches a later one. No-op in Safari.
export async function syncPopupUA(tabId) {
  if (!IS_CHROME) return;
  const ua = tabId == null ? null : await activeUA(tabId);
  const update = { removeRuleIds: [POPUP_RULE_ID] };
  if (ua) {
    const own = await Promise.resolve(api.tabs.getCurrent?.()).catch(() => undefined);
    update.addRules = [popupRule(ua, api.runtime.id, own?.id)];
  }
  await api.declarativeNetRequest.updateSessionRules(update);
  await api.storage.session.set({ [POPUP_TAB_KEY]: ua ? tabId : null });
}

// Chrome: a closed tab takes its rules with it, including the popup rule when
// it carries that tab's user agent. No-op in Safari.
export async function forgetTab(tabId) {
  if (!IS_CHROME) return;
  const rules = await api.declarativeNetRequest.getSessionRules();
  const removeRuleIds = rules.filter((r) => isTabRule(r) && r.condition.tabIds[0] === tabId).map((r) => r.id);
  const { [POPUP_TAB_KEY]: popupTab } = await api.storage.session.get(POPUP_TAB_KEY);
  if (popupTab === tabId) removeRuleIds.push(POPUP_RULE_ID);
  if (!removeRuleIds.length) return;
  await api.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  if (popupTab === tabId) await api.storage.session.set({ [POPUP_TAB_KEY]: null });
}

// Chrome drops a tab's badge whenever the tab navigates: put it back while the
// tab is switched. No-op in Safari, whose badge is global.
export async function restoreTabBadge(tabId) {
  if (!IS_CHROME) return;
  const ua = await activeUA(tabId);
  if (ua) await setTabBadge(tabId, ua);
}

// Re-sync the badge with the rules (on install and browser start).
export async function syncBadge() {
  if (IS_CHROME) {
    for (const rule of (await api.declarativeNetRequest.getSessionRules()).filter(isTabRule)) {
      await setTabBadge(rule.condition.tabIds[0], ruleUA(rule)).catch(() => {});
    }
    return;
  }
  await setGlobalBadge(await activeUA());
}

async function setGlobalBadge(ua) {
  await api.action.setBadgeText({ text: ua ? 'UA' : '' });
  if (ua && api.action.setBadgeBackgroundColor) {
    try {
      await api.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    } catch {}
  }
}

async function setTabBadge(tabId, ua) {
  await api.action.setBadgeText({ tabId, text: ua ? 'UA' : '' });
  if (ua && api.action.setBadgeBackgroundColor) {
    try {
      await api.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    } catch {}
  }
}
