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

export async function runInTab(tabId, func, args = []) {
  const results = await api.scripting.executeScript({ target: { tabId }, func, args });
  return firstResult(results);
}
