// An in-memory stand-in for the extension APIs lib/ua.js uses, so its Chrome
// and Safari paths run in Node. Install it on globalThis before importing
// anything from extension/ (api.js reads globalThis.browser ?? globalThis.chrome
// once, at import).
export function fakeBrowser({ scheme, downloads = false, id = 'loupetestid' }) {
  const state = { dynamic: [], session: [], badges: new Map(), downloads: [], store: {} };
  // Chrome's schema check: rule ids are 32-bit integers ("Invalid type:
  // expected integer, found number" otherwise), and at least 1.
  const int32 = (n) => Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31;
  const update = (key) => async ({ removeRuleIds = [], addRules = [] }) => {
    for (const id of removeRuleIds) if (!int32(id)) throw new Error(`removeRuleIds: Invalid type: expected integer, found number (${id})`);
    for (const rule of addRules) if (!int32(rule.id) || rule.id < 1) throw new Error(`addRules: invalid rule id ${rule.id}`);
    const kept = state[key].filter((r) => !removeRuleIds.includes(r.id));
    for (const rule of addRules) {
      // Chrome refuses a rule whose id is taken, and a tabIds condition outside session rules.
      if (kept.some((r) => r.id === rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
      if (key !== 'session' && rule.condition?.tabIds) throw new Error('tabIds is only supported for session rules');
      kept.push(structuredClone(rule));
    }
    state[key] = kept;
  };
  const api = {
    runtime: { id, getURL: (p = '') => `${scheme}://${id}${p.startsWith('/') ? p : `/${p}`}` },
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(state.dynamic),
      updateDynamicRules: update('dynamic'),
      getSessionRules: async () => structuredClone(state.session),
      updateSessionRules: update('session'),
    },
    action: {
      setBadgeText: async ({ tabId, text }) => void state.badges.set(tabId ?? 'global', text),
      getBadgeText: async ({ tabId } = {}) => state.badges.get(tabId ?? 'global') ?? '',
      setBadgeBackgroundColor: async () => {},
    },
    tabs: { getCurrent: async () => undefined },
    storage: {
      session: {
        get: async (key) => (key in state.store ? { [key]: structuredClone(state.store[key]) } : {}),
        set: async (items) => void Object.assign(state.store, structuredClone(items)),
      },
    },
  };
  if (downloads) api.downloads = { download: async (opts) => state.downloads.push(opts) };
  return { api, state };
}
