import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromeManifest, MIN_CHROME, BROWSERS } from '../../scripts/manifest.mjs';
import { build, extDir, root } from '../../scripts/build.mjs';

const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

async function files(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p, base)));
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

test('Chrome manifest: downloads permission, minimum_chrome_version, no browser_specific_settings', () => {
  const m = chromeManifest(manifest);
  assert.ok(m.permissions.includes('downloads'));
  assert.equal(m.minimum_chrome_version, MIN_CHROME);
  assert.ok(Number(MIN_CHROME) >= 92, 'RuleCondition.tabIds needs Chrome 92');
  assert.equal('browser_specific_settings' in m, false);
});

test('Chrome manifest keeps everything else as Safari’s', () => {
  const m = chromeManifest(manifest);
  const { browser_specific_settings, ...rest } = manifest;
  const { minimum_chrome_version, permissions, ...chromeRest } = m;
  assert.deepEqual(chromeRest, (({ permissions: _p, ...r }) => r)(rest));
  assert.deepEqual(permissions, [...manifest.permissions, 'downloads']);
  // minimum_chrome_version sits right after version, for a readable manifest.
  const keys = Object.keys(m);
  assert.equal(keys.indexOf('minimum_chrome_version'), keys.indexOf('version') + 1);
});

test('the transform is pure and idempotent', () => {
  const before = structuredClone(manifest);
  const once = chromeManifest(manifest);
  assert.deepEqual(manifest, before, 'input untouched');
  const twice = chromeManifest(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.permissions.filter((p) => p === 'downloads').length, 1);
});

test('Safari’s manifest is the source and still sets strict_min_version 16.4', () => {
  assert.equal(BROWSERS.safari, null, 'Safari build is extension/ unchanged');
  assert.equal(manifest.browser_specific_settings.safari.strict_min_version, '16.4');
  assert.equal(manifest.permissions.includes('downloads'), false);
});

test('version 1.1.0 in package.json and the manifest', () => {
  assert.equal(manifest.version, '1.1.0');
  assert.equal(pkg.version, manifest.version);
});

test('descriptions say Safari and Chromium; the manifest’s fits Chrome’s 132 characters', () => {
  for (const d of [manifest.description, pkg.description]) assert.match(d, /Safari and Chromium/);
  assert.ok(manifest.description.length <= 132, String(manifest.description.length));
});

test('build writes dist/safari as extension/ byte for byte, and dist/chrome with only the manifest changed', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'loupe-build-'));
  try {
    const { version, dirs } = await build({ outDir: out });
    assert.equal(version, manifest.version);
    assert.deepEqual(Object.keys(dirs).sort(), ['chrome', 'safari']);
    const src = await files(extDir);
    for (const browser of ['safari', 'chrome']) {
      assert.deepEqual(await files(dirs[browser]), src, `${browser} has the same files`);
      for (const f of src) {
        if (browser === 'chrome' && f === 'manifest.json') continue;
        assert.ok((await readFile(path.join(dirs[browser], f))).equals(await readFile(path.join(extDir, f))), `${browser}/${f}`);
      }
    }
    assert.ok((await readFile(path.join(dirs.safari, 'manifest.json'))).equals(await readFile(path.join(extDir, 'manifest.json'))));
    assert.deepEqual(JSON.parse(await readFile(path.join(dirs.chrome, 'manifest.json'), 'utf8')), chromeManifest(manifest));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
