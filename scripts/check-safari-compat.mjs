// Static compatibility gate, Safari first. Every WebExtension API the code
// uses (any namespace), every declarativeNetRequest rule feature it sets and
// every manifest key is checked against MDN's browser-compat-data:
// - Safari: fails on anything unsupported, or needing a newer Safari than the
//   manifest's strict_min_version, unless the use sits behind the platform
//   switch (IS_CHROME, extension/lib/platform.js; rules in scripts/compat-scan.mjs).
// - Chrome: fails if the Chrome build's minimum_chrome_version
//   (scripts/manifest.mjs) is lower than the newest Chrome version any of it needs.
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource } from './compat-scan.mjs';
import { chromeManifest } from './manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
const minSafari = manifest.browser_specific_settings?.safari?.strict_min_version ?? '16.4';
const chrome = chromeManifest(manifest);
const minChrome = chrome.minimum_chrome_version;

const ALIASES = { contextMenus: 'menus' };
const api = bcd.webextensions.api;
const man = bcd.webextensions.manifest;

const cmp = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

function support(node, browser) {
  const s = node?.__compat?.support?.[browser];
  const first = Array.isArray(s) ? s[0] : s;
  if (!first) return { known: false };
  const added = first.version_added;
  return {
    known: true,
    supported: added !== false && added !== null && first.version_removed == null,
    version: typeof added === 'string' ? added.replace(/^≤/, '') : added,
    partial: Boolean(first.partial_implementation),
    notes: [].concat(first.notes ?? []).join(' ').replace(/<[^>]+>/g, ''),
  };
}
const safari = (node) => support(node, 'safari');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function apiNode(key) {
  const parts = key.split('.');
  parts[0] = ALIASES[parts[0]] ?? parts[0];
  let node = api;
  for (const p of parts) node = node?.[p];
  // storage.local.get -> storage.StorageArea.get
  if (!node && parts[0] === 'storage' && parts.length === 3) node = api.storage?.StorageArea?.[parts[2]] ?? api.storage?.[parts[1]];
  return node;
}

// Rule features the code sets as object keys rather than calls.
const FEATURES = { requestHeaders: 'declarativeNetRequest.RuleAction.requestHeaders' };
for (const name of Object.keys(api.declarativeNetRequest.RuleCondition)) {
  if (name !== '__compat') FEATURES[name] = `declarativeNetRequest.RuleCondition.${name}`;
}

// key -> { files: Set, guarded: bool (every use), featureTestOnly: bool }
const usage = new Map();
for (const file of await walk(extDir)) {
  const rel = path.relative(root, file);
  for (const use of scanSource(await readFile(file, 'utf8'), { features: FEATURES })) {
    const u = usage.get(use.key) ?? { where: new Set(), unguarded: new Set(), behind: 0, tests: 0 };
    u.where.add(`${rel}:${use.line}`);
    if (use.featureTest) u.tests++;
    else if (use.guarded) u.behind++;
    else u.unguarded.add(`${rel}:${use.line}`);
    usage.set(use.key, u);
  }
}

const problems = [];
const rows = [];
const verdictFor = (s) =>
  !s.known ? 'unknown' : !s.supported ? 'UNSUPPORTED' : s.version && cmp(s.version, minSafari) > 0 ? `needs Safari ${s.version}` : s.partial ? 'partial' : 'ok';
const bad = (v) => v === 'UNSUPPORTED' || v.startsWith('needs');

for (const key of [...usage.keys()].sort()) {
  const u = usage.get(key);
  const s = safari(apiNode(key));
  let verdict = verdictFor(s);
  let note = s.partial || verdict !== 'ok' ? s.notes.slice(0, 110) : '';
  if (bad(verdict)) {
    if (u.unguarded.size) problems.push(`${key}: ${verdict}, not behind IS_CHROME (${[...u.unguarded].join(', ')})`);
    else {
      verdict = 'Chrome only';
      note = `${s.supported ? `Safari ${s.version}+` : 'not in Safari'}, behind IS_CHROME${u.tests ? ' (and feature-tested in platform.js)' : ''}`;
    }
  }
  rows.push([key, s.version ?? '-', verdict, note]);
}

// Manifest keys and permissions (Safari's manifest is extension/manifest.json).
for (const key of Object.keys(manifest)) {
  if (['manifest_version', 'name', 'short_name', 'version', 'description', 'browser_specific_settings'].includes(key)) continue;
  const s = safari(man[key]);
  const verdict = !s.known ? 'unknown' : !s.supported ? 'UNSUPPORTED' : cmp(s.version, minSafari) > 0 ? `needs Safari ${s.version}` : 'ok';
  rows.push([`manifest.${key}`, s.version ?? '-', verdict, '']);
  if (bad(verdict)) problems.push(`manifest.${key}: ${verdict}`);
}
for (const k of Object.keys(manifest.background ?? {})) {
  const s = safari(man.background?.[k]);
  const verdict = !s.supported ? 'UNSUPPORTED' : cmp(s.version, minSafari) > 0 ? `needs Safari ${s.version}` : 'ok';
  rows.push([`manifest.background.${k}`, s.version ?? '-', verdict, '']);
  if (verdict !== 'ok') problems.push(`manifest.background.${k}: ${verdict}`);
}
const permNode = man.permissions;
for (const perm of manifest.permissions ?? []) {
  const s = safari(permNode?.[perm] ?? api[ALIASES[perm] ?? perm]);
  const verdict = !s.known ? 'unknown' : !s.supported ? 'UNSUPPORTED' : cmp(s.version, minSafari) > 0 ? `needs Safari ${s.version}` : 'ok';
  rows.push([`permission:${perm}`, s.version ?? '-', verdict, '']);
  if (bad(verdict)) problems.push(`permission ${perm}: ${verdict}`);
}

const w = [54, 8, 14];
console.log(`Safari compatibility (minimum ${minSafari}, BCD ${bcd.__meta.version})\n`);
for (const [a, b, c, d] of rows) console.log(`${a.padEnd(w[0])} ${String(b).padEnd(w[1])} ${c.padEnd(w[2])} ${d}`);

// ---- Chrome build ----------------------------------------------------------
// The newest Chrome version anything above needs, against minimum_chrome_version.
const needs = [];
const chromeNeed = (label, node) => {
  const s = support(node, 'chrome');
  if (!s.known) return;
  if (!s.supported) problems.push(`${label}: not supported in Chrome`);
  else if (typeof s.version === 'string') needs.push([label, s.version]);
};
for (const key of usage.keys()) chromeNeed(key, apiNode(key));
for (const key of Object.keys(chrome)) {
  if (['manifest_version', 'name', 'short_name', 'version', 'description', 'minimum_chrome_version'].includes(key)) continue;
  chromeNeed(`manifest.${key}`, man[key]);
}
for (const k of Object.keys(chrome.background ?? {})) chromeNeed(`manifest.background.${k}`, man.background?.[k]);
for (const perm of chrome.permissions ?? []) chromeNeed(`permission:${perm}`, permNode?.[perm] ?? api[ALIASES[perm] ?? perm]);
needs.sort((a, b) => cmp(b[1], a[1]) || a[0].localeCompare(b[0]));
const top = needs[0]?.[1] ?? '0';
console.log(`\nChrome build (minimum_chrome_version ${minChrome}): needs Chrome ${top}. Newest requirements:`);
for (const [label, v] of needs.slice(0, 6)) console.log(`  ${label.padEnd(w[0] - 2)} ${v}`);
if (!minChrome || cmp(top, minChrome) > 0) problems.push(`minimum_chrome_version ${minChrome} is lower than Chrome ${top} (${needs.filter((n) => n[1] === top).map((n) => n[0]).join(', ')})`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nNo unsupported APIs or manifest keys.');
