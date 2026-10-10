// The compat gate's guard analysis: a Safari-unsupported call or rule feature
// only passes when it sits behind IS_CHROME from lib/platform.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../../scripts/compat-scan.mjs';

const FEATURES = { tabIds: 'declarativeNetRequest.RuleCondition.tabIds' };
const IMPORT = "import { api } from './api.js';\nimport { IS_CHROME } from './platform.js';\n";
const uses = (src, key) => scanSource(src, { features: FEATURES }).filter((u) => u.key === key);
const one = (src, key = 'downloads.download') => {
  const found = uses(src, key);
  assert.equal(found.length, 1, `one ${key} use in:\n${src}`);
  return found[0];
};

test('finds calls in every namespace, with their line', () => {
  const found = scanSource(`${IMPORT}api.downloads.download({});\nchrome.tabs.query({});\nbrowser.storage.local.get('x');\napi.alarms.create('a');`);
  assert.deepEqual(
    found.map((u) => [u.key, u.line]),
    [
      ['downloads.download', 3],
      ['tabs.query', 4],
      ['storage.local.get', 5],
      ['alarms.create', 6],
    ],
  );
});

test('an unguarded Chrome-only call is not behind the switch', () => {
  assert.equal(one(`${IMPORT}export const save = () => api.downloads.download({ url });`).guarded, false);
  assert.equal(one(`${IMPORT}if (ok) api.downloads.download({ url });`).guarded, false);
});

test('if (IS_CHROME), ternaries and && guard it', () => {
  assert.equal(one(`${IMPORT}if (IS_CHROME) api.downloads.download({ url });`).guarded, true);
  assert.equal(one(`${IMPORT}if (IS_CHROME && url) { await api.downloads.download({ url }); }`).guarded, true);
  assert.equal(one(`${IMPORT}const p = IS_CHROME ? api.downloads.download({ url }) : null;`).guarded, true);
  assert.equal(one(`${IMPORT}IS_CHROME && api.downloads.download({ url });`).guarded, true);
  assert.equal(one(`${IMPORT}if (!IS_CHROME) save(); else api.downloads.download({ url });`).guarded, true);
});

test('the wrong branch is not guarded', () => {
  assert.equal(one(`${IMPORT}if (IS_CHROME) save(); else api.downloads.download({ url });`).guarded, false);
  assert.equal(one(`${IMPORT}if (!IS_CHROME) api.downloads.download({ url });`).guarded, false);
  assert.equal(one(`${IMPORT}const p = IS_CHROME ? null : api.downloads.download({ url });`).guarded, false);
  assert.equal(one(`${IMPORT}IS_CHROME || api.downloads.download({ url });`).guarded, false);
});

test('a function that starts with if (!IS_CHROME) return|throw guards its body', () => {
  assert.equal(one(`${IMPORT}async function save() {\n  if (!IS_CHROME) throw new Error('no');\n  await api.downloads.download({ url });\n}`).guarded, true);
  assert.equal(one(`${IMPORT}const save = () => {\n  if (!IS_CHROME) { return; }\n  api.downloads.download({ url });\n};`).guarded, true);
  // The early exit has to come first, and has to exit.
  assert.equal(one(`${IMPORT}function save() {\n  api.downloads.download({ url });\n  if (!IS_CHROME) return;\n}`).guarded, false);
  assert.equal(one(`${IMPORT}function save() {\n  if (!IS_CHROME) log();\n  api.downloads.download({ url });\n}`).guarded, false);
});

test('rule features set as object keys are found and guarded the same way', () => {
  const key = 'declarativeNetRequest.RuleCondition.tabIds';
  assert.equal(one(`${IMPORT}export const rule = (t) => ({ condition: { tabIds: [t] } });`, key).guarded, false);
  assert.equal(one(`${IMPORT}export function rule(t) {\n  if (!IS_CHROME) throw new Error();\n  return { condition: { tabIds: [t] } };\n}`, key).guarded, true);
  const shorthand = one(`${IMPORT}export function rule(tabIds) {\n  if (!IS_CHROME) throw new Error();\n  return { condition: { tabIds } };\n}`, key);
  assert.equal(shorthand.guarded, true);
  // Reading a rule's tabIds is not using the feature.
  assert.equal(uses(`${IMPORT}const ids = rule.condition.tabIds;`, key).length, 0);
});

test('IS_CHROME only counts when imported from platform.js', () => {
  assert.equal(one("import { api } from './api.js';\nconst IS_CHROME = true;\nif (IS_CHROME) api.downloads.download({});").guarded, true, 'declared here: this file is the switch');
  assert.equal(one("import { api } from './api.js';\nimport { IS_CHROME } from './other.js';\nif (IS_CHROME) api.downloads.download({});").guarded, false);
  assert.equal(one("import { api } from './api.js';\nif (IS_CHROME) api.downloads.download({});").guarded, false);
  assert.equal(one("import { api } from './api.js';\nimport { IS_CHROME as yes } from './platform.js';\nif (IS_CHROME) api.downloads.download({});").guarded, false);
});

test('typeof is a feature test, not a call', () => {
  const u = one("import { api } from './api.js';\nexport const has = typeof api?.downloads?.download === 'function';");
  assert.equal(u.featureTest, true);
  assert.equal(one(`${IMPORT}api.downloads.download({});`).featureTest, false);
});

test('classic content scripts parse too', () => {
  const found = scanSource("(() => {\n  const api = globalThis.browser ?? globalThis.chrome;\n  api.storage.local.get('x');\n})();");
  assert.deepEqual(found.map((u) => u.key), ['storage.local.get']);
});
