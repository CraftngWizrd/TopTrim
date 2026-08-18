import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the ffmpeg.wasm core into `public/ffmpeg/`.
 *
 * The core packages expose their files through an `exports` map that Vite
 * cannot resolve with a `?url` suffix, and bundling an Emscripten glue file is
 * a bad idea anyway. Serving them as plain static assets keeps them same-origin
 * (which `toBlobURL` requires under COEP) in both dev and production.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'ffmpeg');

const FILES = [
  ['@ffmpeg/core-mt/dist/esm/ffmpeg-core.js', 'ffmpeg-core-mt.js'],
  ['@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core-mt.wasm'],
  ['@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js', 'ffmpeg-core-mt.worker.js'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const [from, to] of FILES) {
  const src = join(root, 'node_modules', from);
  if (!existsSync(src)) {
    console.warn(`[toptrim] missing ${from} — skipping`);
    continue;
  }
  copyFileSync(src, join(outDir, to));
  copied++;
}

console.log(`[toptrim] ffmpeg core synced (${copied}/${FILES.length} files) -> public/ffmpeg`);
