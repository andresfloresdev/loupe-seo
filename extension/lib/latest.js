// Latest versions, for the Tech tab's update status: WordPress core (the
// version-check offers), plugins and themes on wordpress.org, and npm packages.
// Only a slug or a package name ever leaves, never the inspected site's URL.
// Answers are cached 12 hours in storage.local; three lookups at a time.
// lib/tech.js latestTargets says what to look up, withLatest what it means.

import { api } from './api.js';
import { fetchCapped, mapLimit } from './net.js';

export const LATEST_TTL = 12 * 60 * 60 * 1000;
const LATEST_BYTES = 256 * 1024;
const WPORG_SLUG = /^[a-z0-9-]{1,100}$/;
const NPM_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

// The big fields off: about 900 bytes instead of tens of KB.
const WPORG_FIELDS = ['sections', 'description', 'screenshots', 'reviews', 'banners', 'icons', 'versions', 'contributors', 'tags', 'compatibility', 'ratings', 'donate_link', 'downloaded', 'active_installs', 'homepage']
  .map((f) => `&request[fields][${f}]=0`)
  .join('');

export function latestUrl(target) {
  if (target?.kind === 'wp-core') return 'https://api.wordpress.org/core/version-check/1.7/';
  if (target?.kind === 'wp-plugin' && WPORG_SLUG.test(target.name ?? '')) return `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${target.name}${WPORG_FIELDS}`;
  if (target?.kind === 'wp-theme' && WPORG_SLUG.test(target.name ?? '')) return `https://api.wordpress.org/themes/info/1.2/?action=theme_information&request[slug]=${target.name}${WPORG_FIELDS}`;
  if (target?.kind === 'npm' && NPM_NAME.test(target.name ?? '')) return `https://registry.npmjs.org/${target.name}/latest`;
  return null;
}

// What one answer says: { offers } for core, { version } for the rest,
// { unlisted: true } when wordpress.org or npm has no such slug.
export function readAnswer(target, res) {
  if (res.error && res.status === 404) return { unlisted: true };
  if (res.error) return { error: res.error };
  let json;
  try {
    json = JSON.parse(res.text);
  } catch {
    return { error: res.capped ? 'Answer too large' : 'Not JSON' };
  }
  if (target.kind === 'wp-core') {
    const offers = (Array.isArray(json?.offers) ? json.offers : []).map((o) => o?.version).filter((v) => typeof v === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(v));
    return offers.length ? { offers: [...new Set(offers)] } : { error: 'No offers' };
  }
  if (json?.error) return { unlisted: true };
  if (typeof json?.version !== 'string' || json.version.length > 40) return { error: 'No version' };
  // A theme's name, to tell a wordpress.org theme from a custom one in a folder of the same name.
  return target.kind === 'wp-theme' && typeof json.name === 'string' ? { version: json.version, name: json.name.slice(0, 100) } : { version: json.version };
}

const cacheKey = (target) => `latest:${target.key}`;

// targets: from latestTargets(). Returns { [key]: answer }.
export async function fetchLatest(targets, { storage = api?.storage?.local, now = Date.now() } = {}) {
  const list = (targets ?? []).filter((t) => t?.key && latestUrl(t));
  const out = {};
  if (!list.length) return out;
  let cached = {};
  try {
    cached = (await storage?.get(list.map(cacheKey))) ?? {};
  } catch {}
  const todo = [];
  for (const t of list) {
    const hit = cached[cacheKey(t)];
    if (hit && typeof hit.at === 'number' && now - hit.at < LATEST_TTL && hit.answer) out[t.key] = hit.answer;
    else todo.push(t);
  }
  const fresh = {};
  await mapLimit(todo, 3, async (t) => {
    const answer = readAnswer(t, await fetchCapped(latestUrl(t), LATEST_BYTES, 10000));
    out[t.key] = answer;
    // A failed lookup is retried next time; a real answer (or "not listed") is kept.
    if (!answer.error) fresh[cacheKey(t)] = { at: now, answer };
  });
  if (Object.keys(fresh).length) {
    try {
      await storage?.set(fresh);
    } catch {}
  }
  return out;
}
