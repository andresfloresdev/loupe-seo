// lib/ua.js on the Safari path: one global dynamic rule and a global badge,
// whatever tab the popup passes; the Chrome per-tab hooks leave it alone.
// Runs ua.js against an in-memory browser.* (tests/unit/helpers/fake-browser.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeBrowser } from './helpers/fake-browser.js';

const { api, state } = fakeBrowser({ scheme: 'safari-web-extension' });
globalThis.browser = api;
const platform = await import('../../extension/lib/platform.js');
const ua = await import('../../extension/lib/ua.js');

const GOOGLEBOT = ua.UA_PRESETS.find((p) => p.id === 'googlebot-smartphone').ua;
const A = 41;
const B = 42;
const reset = () => Object.assign(state, { dynamic: [], session: [], badges: new Map(), store: {} });

test('platform.js reads safari-web-extension: as Safari', () => {
  assert.equal(platform.PLATFORM, 'safari');
  assert.equal(platform.IS_CHROME, false);
});

test('switching from tab A writes the one global rule and the global badge, as in 1.0', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  assert.deepEqual(state.session, []);
  assert.equal(state.dynamic.length, 1);
  assert.deepEqual(state.dynamic[0], ua.uaRule(GOOGLEBOT));
  assert.equal(state.dynamic[0].condition.tabIds, undefined);
  assert.equal(state.badges.get('global'), 'UA');
  assert.equal(state.badges.get(A), undefined);
  // Every tab sees it.
  assert.equal(await ua.activeUA(A), GOOGLEBOT);
  assert.equal(await ua.activeUA(B), GOOGLEBOT);
  assert.equal(await ua.activeUA(), GOOGLEBOT);
});

test('the per-tab hooks are no-ops: popup sync, tab close and badge restore keep the global rule', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  await ua.syncPopupUA(B);
  await ua.forgetTab(A);
  await ua.restoreTabBadge(A);
  assert.deepEqual(state.session, []);
  assert.equal(state.dynamic.length, 1);
  assert.equal(state.badges.get('global'), 'UA');
  assert.equal(state.badges.get(A), undefined);
});

test('reset clears the global rule and badge; syncBadge reads them back', async () => {
  reset();
  await ua.applyUA(GOOGLEBOT, A);
  state.badges = new Map();
  await ua.syncBadge();
  assert.equal(state.badges.get('global'), 'UA');
  await ua.applyUA(null, B);
  assert.deepEqual(state.dynamic, []);
  assert.equal(state.badges.get('global'), '');
  assert.equal(await ua.activeUA(A), null);
});

test('the Chrome-only rule builders refuse to run', () => {
  assert.throws(() => ua.tabRule(GOOGLEBOT, A, 3), /Per-tab rules need Chrome/);
  assert.throws(() => ua.popupRule(GOOGLEBOT, api.runtime.id), /Per-tab rules need Chrome/);
});
