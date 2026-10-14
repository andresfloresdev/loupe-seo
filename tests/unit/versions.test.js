// Version comparison and update status (lib/versions.js), on a trimmed copy of
// the real WordPress version-check answer of 2026-10-13
// (tests/unit/fixtures/wp-version-check-2026-10-13.json: the offers' version
// fields only). The module is imported with a fallback so that, on a checkout
// without it, every test still runs and fails on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const V = await import('../../extension/lib/versions.js').catch(() => ({}));
const { parseVersion, cleanVersion, compareVersions, isExact, isPrerelease, wpCoreStatus, latestStatus } = V;

const OFFERS = JSON.parse(readFileSync(new URL('./fixtures/wp-version-check-2026-10-13.json', import.meta.url), 'utf8')).offers.map((o) => o.version);

test('the trimmed offers: 26 versions, the newest first, back to 4.7', () => {
  assert.equal(OFFERS.length, 26);
  assert.equal(OFFERS[0], '7.1.3');
  assert.equal(OFFERS.at(-1), '4.7.38');
  assert.equal(typeof wpCoreStatus, 'function');
});

test('parseVersion: dotted numbers, a prerelease, build metadata dropped; null otherwise', () => {
  assert.deepEqual(parseVersion('16.5.0-canary.9'), { nums: [16, 5, 0], pre: ['canary', 9] });
  assert.deepEqual(parseVersion('v7.3.5'), { nums: [7, 3, 5], pre: [] });
  assert.deepEqual(parseVersion('22.2.2+sha-68c6c57'), { nums: [22, 2, 2], pre: [] });
  assert.deepEqual(parseVersion('5'), { nums: [5], pre: [] });
  for (const bad of ['', 'latest', '1.2.3.4.5', '6.9.4 beta', null, undefined, '1791211150x']) assert.equal(parseVersion(bad), null, String(bad));
  assert.equal(cleanVersion('22.2.2+sha-68c6c57'), '22.2.2');
  assert.equal(cleanVersion('v7.3.5'), '7.3.5');
});

test('compareVersions: numeric parts, missing parts are 0, a prerelease before its release', () => {
  assert.equal(compareVersions('6.9.10', '6.9.4'), 1, '10 > 4, not as text');
  assert.equal(compareVersions('7.1', '7.1.0'), 0);
  assert.equal(compareVersions('7.0.7', '7.1.3'), -1);
  assert.equal(compareVersions('16.5.0-canary.9', '16.5.0'), -1);
  assert.equal(compareVersions('16.5.0-canary.9', '16.4.0'), 1);
  assert.equal(compareVersions('16.5.0-canary.10', '16.5.0-canary.9'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc'), 1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1, 'numeric identifiers sort first');
  assert.equal(isExact('16.4.0'), true);
  assert.equal(isExact('5'), false);
  assert.equal(isExact('7.1'), false);
  assert.equal(isPrerelease('16.5.0-canary.9'), true);
  assert.equal(isPrerelease('16.4.0'), false);
});

test('WordPress branch rule on the 2026-10-13 offers', () => {
  const s = (v) => wpCoreStatus(v, OFFERS);
  assert.deepEqual(s('7.1.3'), { status: 'latest', latest: '7.1.3' }, 'yoast.com');
  assert.deepEqual(s('7.1.2'), { status: 'update', latest: '7.1.3', branch: '7.1.3' }, 'uqam.ca');
  assert.deepEqual(s('7.0.7'), { status: 'patched', latest: '7.1.3', branch: '7.0.7' }, 'fairmountbagel.com');
  assert.deepEqual(s('6.9.4'), { status: 'update', latest: '7.1.3', branch: '6.9.10' }, 'bixi.com');
  assert.deepEqual(s('6.7.10'), { status: 'patched', latest: '7.1.3', branch: '6.7.10' }, 'kinsta.com');
  assert.deepEqual(s('4.7.38'), { status: 'patched', latest: '7.1.3', branch: '4.7.38' }, 'the oldest branch still patched');
  assert.deepEqual(s('4.6.20'), { status: 'unsupported', latest: '7.1.3' });
  assert.deepEqual(s('3.9'), { status: 'unsupported', latest: '7.1.3' });
  assert.deepEqual(s('7.1'), { status: 'update', latest: '7.1.3', branch: '7.1.3' }, '7.1 is 7.1.0');
  assert.deepEqual(s('7.2.0'), { status: 'latest', latest: '7.1.3' }, 'newer than the offers (a beta site)');
  assert.equal(wpCoreStatus('hidden', OFFERS), null);
  assert.equal(wpCoreStatus('7.1.3', []), null);
});

test('latestStatus: behind, latest, and a prerelease newer than the stable release', () => {
  assert.deepEqual(latestStatus('16.5.0-canary.9', '16.4.0'), { status: 'prerelease', latest: '16.4.0' }, 'nextjs.org');
  assert.deepEqual(latestStatus('16.3.6', '16.4.0'), { status: 'behind', latest: '16.4.0' }, 'notion.com');
  assert.deepEqual(latestStatus('16.4.0-canary.1', '16.4.0'), { status: 'behind', latest: '16.4.0' }, 'a prerelease of the stable release is behind it');
  assert.deepEqual(latestStatus('4.6.1', '4.6.1'), { status: 'latest', latest: '4.6.1' }, 'nuxt.com');
  assert.deepEqual(latestStatus('22.2.2+sha-68c6c57', '22.2.2'), { status: 'latest', latest: '22.2.2' }, 'angular.dev');
  assert.deepEqual(latestStatus('5.16.0', '7.3.8'), { status: 'behind', latest: '7.3.8' }, 'floresagency.ca');
  assert.equal(latestStatus('unknown', '1.0.0'), null);
});
