// Static Safari compatibility gate: every WebExtension API the code calls and
// every manifest key it uses is checked against MDN's browser-compat-data.
// Fails if anything is unsupported in Safari or needs a newer Safari than the
// manifest's strict_min_version.
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
const minSafari = manifest.browser_specific_settings?.safari?.strict_min_version ?? '16.4';

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

function safari(node) {
  const s = node?.__compat?.support?.safari;
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

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// Calls look like api.ns.member, api.ns.sub.member (storage.local.get) or
// chrome/browser.ns.member inside the classic content script.
const usage = new Map();
for (const file of await walk(extDir)) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(/\b(?:api|chrome|browser)\.([a-zA-Z]+)\.([a-zA-Z]+)(?:\.([a-zA-Z]+))?/g)) {
    const [, ns, a, b] = m;
    if (['runtime', 'storage', 'tabs', 'scripting', 'action', 'contextMenus', 'declarativeNetRequest'].includes(ns)) {
      const key = b && ns === 'storage' ? `${ns}.${a}.${b}` : `${ns}.${a}`;
      if (!usage.has(key)) usage.set(key, new Set());
      usage.get(key).add(path.relative(root, file));
    }
  }
}

const problems = [];
const rows = [];
for (const key of [...usage.keys()].sort()) {
  const parts = key.split('.');
  parts[0] = ALIASES[parts[0]] ?? parts[0];
  let node = api;
  for (const p of parts) node = node?.[p];
  // storage.local.get -> storage.StorageArea.get
  if (!node && parts[0] === 'storage' && parts.length === 3) node = api.storage?.StorageArea?.[parts[2]] ?? api.storage?.[parts[1]];
  const s = safari(node);
  let verdict = 'ok';
  if (!s.known) verdict = 'unknown';
  else if (!s.supported) verdict = 'UNSUPPORTED';
  else if (s.version && cmp(s.version, minSafari) > 0) verdict = `needs Safari ${s.version}`;
  else if (s.partial) verdict = 'partial';
  rows.push([key, s.version ?? '-', verdict, s.partial || verdict !== 'ok' ? s.notes.slice(0, 110) : '']);
  if (verdict === 'UNSUPPORTED' || verdict.startsWith('needs')) problems.push(`${key}: ${verdict} (${[...usage.get(key)].join(', ')})`);
}

// Manifest keys and permissions.
for (const key of Object.keys(manifest)) {
  if (['manifest_version', 'name', 'short_name', 'version', 'description', 'browser_specific_settings'].includes(key)) continue;
  const s = safari(man[key]);
  const verdict = !s.known ? 'unknown' : !s.supported ? 'UNSUPPORTED' : cmp(s.version, minSafari) > 0 ? `needs Safari ${s.version}` : 'ok';
  rows.push([`manifest.${key}`, s.version ?? '-', verdict, '']);
  if (verdict === 'UNSUPPORTED' || verdict.startsWith('needs')) problems.push(`manifest.${key}: ${verdict}`);
}
for (const [k, v] of Object.entries(manifest.background ?? {})) {
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
  if (verdict === 'UNSUPPORTED' || verdict.startsWith('needs')) problems.push(`permission ${perm}: ${verdict}`);
}

// declarativeNetRequest header modification is a sub-feature with its own version.
const dnrHeaders = safari(api.declarativeNetRequest?.RuleAction?.requestHeaders);
rows.push(['dnr RuleAction.requestHeaders', dnrHeaders.version, cmp(dnrHeaders.version, minSafari) > 0 ? 'needs newer' : 'ok', '']);
const dnrTabIds = safari(api.declarativeNetRequest?.RuleCondition?.tabIds);
rows.push(['dnr RuleCondition.tabIds (not used)', String(dnrTabIds.version), dnrTabIds.supported ? 'ok' : 'unsupported, avoided', '']);

const w = [38, 8, 22];
console.log(`Safari compatibility (minimum ${minSafari}, BCD ${bcd.__meta.version})\n`);
for (const [a, b, c, d] of rows) console.log(`${a.padEnd(w[0])} ${String(b).padEnd(w[1])} ${c.padEnd(w[2])} ${d}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nNo unsupported APIs or manifest keys.');
