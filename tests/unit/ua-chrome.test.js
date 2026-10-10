// lib/ua.js on the Chrome path: per-tab session rules, per-tab badge, popup
// requests covered, cleanup on tab close. Runs ua.js against an in-memory
// chrome.* (tests/unit/helpers/fake-browser.js); node --test gives each file
// its own process, so the global is set before extension/ is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser } from './helpers/fake-browser.js';

const { api, state } = fakeBrowser({ scheme: 'chrome-extension', downloads: true });
globalThis.chrome = api;
const platform = await import('../../extension/lib/platform.js');
const ua = await import('../../extension/lib/ua.js');

const GOOGLEBOT = ua.UA_PRESETS.find((p) => p.id === 'googlebot-smartphone').ua;
const BING = ua.UA_PRESETS.find((p) => p.id === 'bingbot').ua;
// Real Chromium tab ids run past a billion: rule ids can't be derived from them.
const A = 1_746_120_041;
const B = 1_746_120_042;
const reset = () => Object.assign(state, { dynamic: [], session: [], badges: new Map(), store: {} });
const forTab = (tabId) => state.session.filter((r) => r.condition.tabIds?.includes(tabId) && !r.condition.initiatorDomains);
const popupRules = () => state.session.filter((r) => r.condition.initiatorDomains);

test('platform.js reads chrome-extension: and the downloads API as Chrome', () => {
  assert.equal(platform.PLATFORM, 'chrome');
  assert.equal(platform.IS_CHROME, true);
});

test('switching tab A writes a session rule for tab A only, no global rule', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  assert.deepEqual(state.dynamic, []);
  const [rule] = forTab(A);
  assert.ok(rule, 'tab A has a rule');
  assert.deepEqual(rule.condition.tabIds, [A]);
  assert.equal(rule.action.requestHeaders[0].value, GOOGLEBOT);
  assert.ok(rule.condition.resourceTypes.includes('main_frame'));
  assert.equal(forTab(B).length, 0);
  assert.equal(await ua.activeUA(A), GOOGLEBOT);
  assert.equal(await ua.activeUA(B), null);
});

test('the badge shows on tab A only', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  assert.equal(state.badges.get(A), 'UA');
  assert.equal(state.badges.get(B), undefined);
  assert.equal(state.badges.get('global'), undefined);
});

test('the popup inspecting tab A gets tab A’s user agent for its own requests (tabId -1, from Loupe only)', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  const [rule] = popupRules();
  assert.ok(rule, 'popup rule written');
  assert.deepEqual(rule.condition.tabIds, [-1]);
  assert.deepEqual(rule.condition.initiatorDomains, [api.runtime.id]);
  assert.equal(rule.action.requestHeaders[0].value, GOOGLEBOT);
});

test('opening the popup on another tab points the popup rule at that tab, or drops it', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, B);
  await ua.syncPopupUA(A);
  assert.deepEqual(popupRules().map((r) => r.action.requestHeaders[0].value), [GOOGLEBOT]);
  await ua.syncPopupUA(B);
  assert.deepEqual(popupRules().map((r) => r.action.requestHeaders[0].value), [BING]);
  await ua.syncPopupUA(99);
  assert.deepEqual(popupRules(), []);
  // The tabs' own rules are untouched.
  assert.equal(await ua.activeUA(A), GOOGLEBOT);
  assert.equal(await ua.activeUA(B), BING);
});

test('a popup opened as a page also covers its own tab', async () => {
  reset();
  api.tabs.getCurrent = async () => ({ id: 7 });
  try {
    await ua.applyUA(GOOGLEBOT, A);
    assert.deepEqual(popupRules()[0].condition.tabIds, [-1, 7]);
  } finally {
    api.tabs.getCurrent = async () => undefined;
  }
});

test('switching again replaces tab A’s rule instead of adding one', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, A);
  assert.equal(forTab(A).length, 1);
  assert.equal(await ua.activeUA(A), BING);
  assert.equal(popupRules().length, 1);
});

test('reset clears tab A’s rule, its popup rule and its badge, and leaves tab B alone', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, B);
  await ua.applyUA(null, A);
  assert.equal(forTab(A).length, 0);
  assert.equal(state.badges.get(A), '');
  assert.equal(await ua.activeUA(B), BING);
  assert.equal(state.badges.get(B), 'UA');
});

test('closing tab A removes its rules', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, B);
  await ua.syncPopupUA(A);
  await ua.forgetTab(A);
  assert.equal(forTab(A).length, 0);
  assert.equal(popupRules().length, 0, 'the popup rule written for tab A goes too');
  assert.equal(await ua.activeUA(B), BING);
});

test('the badge comes back after Chrome clears it on navigation', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  state.badges.delete(A); // Chrome drops tab badges when the tab navigates
  await ua.restoreTabBadge(A);
  assert.equal(state.badges.get(A), 'UA');
  await ua.restoreTabBadge(B);
  assert.equal(state.badges.get(B), undefined, 'an unswitched tab gets no badge');
});

test('syncBadge puts the badge back on every switched tab', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, B);
  state.badges = new Map();
  await ua.syncBadge();
  assert.equal(state.badges.get(A), 'UA');
  assert.equal(state.badges.get(B), 'UA');
  assert.equal(state.badges.get('global'), undefined);
});

test('rule ids stay small and unique whatever the tab ids', async () => {
  reset();
  const tabs = [A, B, 7, 2 ** 31 - 1];
  for (const t of tabs) await ua.applyUA(GOOGLEBOT, t);
  const ids = state.session.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => Number.isInteger(id) && id >= 1 && id < 100), JSON.stringify(ids));
  for (const t of tabs) assert.equal(await ua.activeUA(t), GOOGLEBOT);
  // A freed id is reused.
  await ua.forgetTab(B);
  await ua.applyUA(BING, 99);
  assert.equal(new Set(state.session.map((r) => r.id)).size, state.session.length);
  assert.equal(await ua.activeUA(99), BING);
});

test('closing a tab leaves the popup rule when it carries another tab’s user agent', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.applyUA(BING, B);
  await ua.syncPopupUA(B);
  await ua.forgetTab(A);
  assert.deepEqual(popupRules().map((r) => r.action.requestHeaders[0].value), [BING]);
});

test('a switch without a tab is refused', async () => {
  reset();
  await assert.rejects(ua.applyUA(GOOGLEBOT, undefined));
  assert.deepEqual(state.session, []);
  assert.deepEqual(state.dynamic, []);
});
