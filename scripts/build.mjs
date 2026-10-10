// Build one folder per browser from extension/: dist/chrome/ and dist/safari/.
// Every file is copied as is; only Chrome's manifest.json is rewritten
// (scripts/manifest.mjs), so dist/safari/ is byte for byte extension/.
import { readFile, writeFile, rm, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BROWSERS } from './manifest.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extDir = path.join(root, 'extension');
export const distDir = path.join(root, 'dist');

export async function build({ outDir = distDir } = {}) {
  const manifest = JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8'));
  const dirs = {};
  await mkdir(outDir, { recursive: true });
  for (const [browser, transform] of Object.entries(BROWSERS)) {
    const dir = path.join(outDir, browser);
    await rm(dir, { recursive: true, force: true });
    await cp(extDir, dir, { recursive: true });
    if (transform) await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(transform(manifest), null, 2) + '\n');
    dirs[browser] = dir;
  }
  return { version: manifest.version, dirs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version, dirs } = await build();
  for (const [browser, dir] of Object.entries(dirs)) console.log(`${browser.padEnd(7)} ${path.relative(root, dir)}/ (${version})`);
}
