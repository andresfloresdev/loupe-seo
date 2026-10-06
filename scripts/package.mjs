// Zip the extension folder (manifest.json at the zip root) into dist/.
// Safari 26 can load the zip or the unzipped folder via
// Settings › Developer › Add Temporary Extension…
import { readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const { version } = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
const out = path.join(dist, `loupe-seo-${version}.zip`);
await mkdir(dist, { recursive: true });
await rm(out, { force: true });

// python's zipfile CLI stores each argument under its basename, which puts
// manifest.json at the root of the archive.
const entries = (await readdir(ext)).map((n) => path.join(ext, n));
execFileSync('python3', ['-m', 'zipfile', '-c', out, ...entries], { stdio: 'inherit' });
const listing = execFileSync('python3', ['-m', 'zipfile', '-l', out]).toString();
const files = listing.trim().split('\n').length - 1;
console.log(`${path.relative(root, out)} (${files} files)`);
