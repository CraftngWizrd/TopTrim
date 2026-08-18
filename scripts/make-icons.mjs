import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Render build/icon.svg to the raster icons Electron needs.
 *
 * electron-builder picks up build/icon.png (>=512px) on its own and derives the
 * platform formats at package time. The extra sizes are for the dev window and
 * the taskbar, which take a PNG directly.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'build', 'icon.svg');
const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(src);
const sizes = [1024, 512, 256, 128, 64, 32];

for (const size of sizes) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  const name = size === 1024 ? 'icon.png' : `icon-${size}.png`;
  writeFileSync(join(outDir, name), png);
}

/**
 * Windows .ico, assembled by hand.
 *
 * sharp has no ICO encoder and pulling a package in for one file is not worth
 * it: the format is a 6-byte header, a 16-byte directory entry per image, then
 * the PNG payloads concatenated. Vista and later accept PNG-compressed entries
 * directly, which is what every modern icon does.
 */
const icoSizes = [256, 128, 64, 32];
const images = [];
for (const size of icoSizes) {
  images.push({ size, data: await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer() });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;
for (const img of images) {
  const entry = Buffer.alloc(16);
  // 256 is stored as 0 — the field is one byte.
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
  entry.writeUInt8(0, 2); // palette count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(img.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += img.data.length;
}

writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));

console.log(`[toptrim] icons written -> build/ (${sizes.length} png + icon.ico)`);
