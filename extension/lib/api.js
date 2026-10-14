// Safari exposes `browser` (promise based) and also `chrome`. Chromium only has `chrome`.
// MV3 `chrome.*` APIs return promises too, so one handle works everywhere.
export const api = globalThis.browser ?? globalThis.chrome;

// scripting.executeScript resolves to [{ frameId, result }] in Safari 17+ and Chrome.
// Older Safari builds resolved to bare values, so accept both shapes.
export function firstResult(results) {
  const first = Array.isArray(results) ? results[0] : results;
  if (first && typeof first === 'object' && 'frameId' in first) return first.result;
  return first;
}

// world: 'MAIN' runs `func` in the page's own JavaScript world, to read globals
// the page set (Safari 15.4+, Chrome 95+). The default is the isolated world.
export async function runInTab(tabId, func, args = [], { world } = {}) {
  const results = await api.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) });
  return firstResult(results);
}
