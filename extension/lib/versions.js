// Version strings: parse, compare, and say where a found version stands
// against the latest release. Pure: no DOM, no browser APIs, unit-tested in
// Node (tests/unit/versions.test.js).

// "v16.5.0-canary.9+sha-1" -> { nums: [16, 5, 0], pre: ['canary', 9] }.
// Build metadata (after "+") never counts. Null when it is not a version.
export function parseVersion(v) {
  const m = /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return {
    nums: m[1].split('.').map(Number),
    pre: m[2] ? m[2].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

// The version as shown: no leading "v", no build metadata.
export function cleanVersion(v) {
  const s = String(v ?? '').trim();
  return parseVersion(s) ? s.replace(/^v/, '').replace(/\+.*$/, '') : s;
}

// Three numbers or more: a version precise enough to compare with a release.
export const isExact = (v) => (parseVersion(v)?.nums.length ?? 0) >= 3;
export const isPrerelease = (v) => (parseVersion(v)?.pre.length ?? 0) > 0;

// Semver order on dotted numbers (missing parts are 0), then a prerelease
// sorts before its release. Unparseable versions compare equal.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length ? -1 : y.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return Math.sign(p - q);
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const newest = (list) => list.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
const branchOf = (v) => parseVersion(v)?.nums.slice(0, 2).join('.') ?? '';

// WordPress core against the version-check offers (the newest release, then
// the newest of every branch WordPress still patches):
// - latest: the newest release;
// - patched: the newest of an older branch still in the list (6.9.10 while 7.1.3 is out);
// - update: a newer release of its own branch exists (6.9.4 while 6.9.10 is out);
// - unsupported: its branch is no longer in the list.
export function wpCoreStatus(version, offers) {
  const list = (offers ?? []).filter((v) => parseVersion(v));
  if (!parseVersion(version) || !list.length) return null;
  const latest = newest(list);
  if (compareVersions(version, latest) >= 0) return { status: 'latest', latest };
  const top = newest(list.filter((v) => branchOf(v) === branchOf(version)));
  if (!top) return { status: 'unsupported', latest };
  if (compareVersions(version, top) >= 0) return { status: 'patched', latest, branch: top };
  return { status: 'update', latest, branch: top };
}

// Anything else against its latest stable release:
// - latest: the same or newer;
// - prerelease: a prerelease newer than the latest stable (16.5.0-canary.9 vs 16.4.0);
// - behind: an older version (prereleases included).
export function latestStatus(version, latest) {
  if (!parseVersion(version) || !parseVersion(latest)) return null;
  const c = compareVersions(version, latest);
  if (c < 0) return { status: 'behind', latest };
  if (c > 0 && isPrerelease(version)) return { status: 'prerelease', latest };
  return { status: 'latest', latest };
}
