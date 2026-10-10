// Build dist/chrome/ and dist/safari/, then zip each (manifest.json at the zip
// root): dist/loupe-seo-chrome-<version>.zip and dist/loupe-seo-safari-<version>.zip.
// Chrome, Brave, Edge and Arc load the unzipped folder with Load unpacked.
// Safari 26 loads the zip or the folder via Settings › Developer › Add
// Temporary Extension…
// Each zip is then extracted and compared with its source, byte for byte; the
// Safari zip's source is extension/ itself.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { build, root, extDir, distDir } from './build.mjs';

async function files(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(p, base)));
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

async function sameTree(a, b) {
  const [fa, fb] = [await files(a), await files(b)];
  if (fa.join('\n') !== fb.join('\n')) return `file lists differ (${fa.length} vs ${fb.length})`;
  for (const f of fa) {
    if (!(await readFile(path.join(a, f))).equals(await readFile(path.join(b, f)))) return `${f} differs`;
  }
  return null;
}

const { version, dirs } = await build();
const sources = { ...dirs, safari: extDir };
for (const [browser, dir] of Object.entries(dirs)) {
  const out = path.join(distDir, `loupe-seo-${browser}-${version}.zip`);
  await rm(out, { force: true });
  // python's zipfile CLI stores each argument under its basename, which puts
  // manifest.json at the root of the archive.
  const entries = (await readdir(dir)).sort().map((n) => path.join(dir, n));
  execFileSync('python3', ['-m', 'zipfile', '-c', out, ...entries], { stdio: 'inherit' });

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'loupe-zip-'));
  try {
    execFileSync('python3', ['-m', 'zipfile', '-e', out, tmp]);
    const diff = await sameTree(tmp, sources[browser]);
    if (diff) throw new Error(`${path.relative(root, out)} does not match ${path.relative(root, sources[browser])}/: ${diff}`);
    console.log(`${path.relative(root, out)} (${(await files(tmp)).length} files, same as ${path.relative(root, sources[browser])}/)`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
