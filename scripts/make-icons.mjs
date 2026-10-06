// Render the PNG icons the manifest references from the SVG sources in art/.
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'extension', 'icons');
await mkdir(out, { recursive: true });

const icon = await readFile(path.join(root, 'art', 'icon.svg'));
const toolbar = await readFile(path.join(root, 'art', 'toolbar.svg'));

const jobs = [
  ...[16, 32, 48, 64, 96, 128, 256, 512, 1024].map((s) => ({ svg: icon, size: s, name: `icon-${s}.png` })),
  ...[16, 19, 32, 38, 48].map((s) => ({ svg: toolbar, size: s, name: `toolbar-${s}.png` })),
];

for (const { svg, size, name } of jobs) {
  await sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, name));
}
console.log(`wrote ${jobs.length} icons to ${path.relative(root, out)}`);
