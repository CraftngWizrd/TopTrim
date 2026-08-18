import { get as idbGet, set as idbSet, createStore } from 'idb-keyval';
import type { MediaAsset } from '../types/project';
import { ffmpegClient, getFileHandle } from './ffmpegClient';
import { UnsupportedSourceError, grabFrames, isSourceOpen, releaseSource } from './frameGrabber';

/**
 * Storyboard frames for timeline clips and media-panel hover scrub.
 *
 * Frames live on a fixed time grid keyed by the asset hash, so zooming reuses
 * everything already extracted and only asks for the gaps.
 *
 * EXTRACTION STRATEGY
 * -------------------
 * The browser's own decoder does the work (see frameGrabber.ts): no WASM
 * download before the first thumbnail, hardware acceleration, and one open
 * video reused across seeks. ffmpeg is the fallback, used only for sources the
 * browser will not open. That ordering is what makes a clip tile almost as
 * soon as it lands on the timeline rather than seconds later.
 */

export const THUMB_W = 54;
export const THUMB_H = 30;

/** Grid resolution, in milliseconds. Every request is snapped to this. */
const GRID_MS = 250;
/** Never hold more than this many decoded bitmaps across all assets. */
const BITMAP_BUDGET = 2400;
/** Frames per round. Browser-decoded grabs are cheap, so this can be generous. */
const BATCH_VIDEO = 24;
/** ffmpeg costs an exec per frame, so its rounds stay small. */
const BATCH_FFMPEG = 8;

const idbStore = createStore('toptrim-storyboard', 'frames');

type Extractor = 'video' | 'ffmpeg';

interface Strip {
  hash: string;
  frames: Map<number, ImageBitmap>;
  /** Grid keys currently in flight, or known to be unreadable. */
  inflight: Set<number>;
  failed: Set<number>;
  /** Insertion order, for eviction. */
  order: number[];
  extractor: Extractor;
  abort: AbortController | null;
  /** Rough total the strip is working towards, for progress reporting. */
  requested: number;
  completed: number;
  startedAt: number;
}

const strips = new Map<string, Strip>();
const listeners = new Set<() => void>();
let totalBitmaps = 0;

/**
 * Extraction failures used to be a console warning and an eternal shimmer.
 * The app installs a reporter here so problems — and progress — surface in the
 * jobs overlay where they can actually be acted on.
 */
export type StoryboardEvent =
  | { kind: 'start'; hash: string; assetName: string; total: number }
  | { kind: 'progress'; hash: string; assetName: string; done: number; total: number; startedAt: number }
  | { kind: 'done'; hash: string; assetName: string }
  | { kind: 'error'; hash: string; assetName: string; message: string };

let reporter: ((e: StoryboardEvent) => void) | null = null;
export const setStoryboardReporter = (fn: ((e: StoryboardEvent) => void) | null) => {
  reporter = fn;
};
const report = (e: StoryboardEvent) => reporter?.(e);

const snap = (seconds: number) => Math.round((seconds * 1000) / GRID_MS) * GRID_MS;

function strip(hash: string): Strip {
  let s = strips.get(hash);
  if (!s) {
    s = {
      hash,
      frames: new Map(),
      inflight: new Set(),
      failed: new Set(),
      order: [],
      extractor: 'video',
      abort: null,
      requested: 0,
      completed: 0,
      startedAt: 0,
    };
    strips.set(hash, s);
  }
  return s;
}

const notify = () => listeners.forEach((cb) => cb());

/** Repaint hook for the timeline canvas and the media grid. */
export function onStoryboardUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function remember(s: Strip, key: number, bitmap: ImageBitmap) {
  if (s.frames.has(key)) {
    bitmap.close();
    return;
  }
  s.frames.set(key, bitmap);
  s.order.push(key);
  totalBitmaps++;

  // Evict oldest frames globally once the budget is blown.
  while (totalBitmaps > BITMAP_BUDGET) {
    let evicted = false;
    for (const other of strips.values()) {
      const oldest = other.order.shift();
      if (oldest === undefined) continue;
      const bmp = other.frames.get(oldest);
      if (bmp) {
        bmp.close();
        other.frames.delete(oldest);
        totalBitmaps--;
        evicted = true;
      }
      if (totalBitmaps <= BITMAP_BUDGET) break;
    }
    if (!evicted) break;
  }
}

/** Nearest already-decoded frame to `seconds`, or null while it is still loading. */
export function getFrameAt(hash: string, seconds: number, toleranceMs = 4000): ImageBitmap | null {
  const s = strips.get(hash);
  if (!s || s.frames.size === 0) return null;

  const want = snap(seconds);
  const exact = s.frames.get(want);
  if (exact) return exact;

  let best: ImageBitmap | null = null;
  let bestDist = Infinity;
  for (const [key, bmp] of s.frames) {
    const d = Math.abs(key - want);
    if (d < bestDist) {
      bestDist = d;
      best = bmp;
    }
  }
  return bestDist <= toleranceMs ? best : null;
}

export const hasAnyFrames = (hash: string) => (strips.get(hash)?.frames.size ?? 0) > 0;
export const frameCount = (hash: string) => strips.get(hash)?.frames.size ?? 0;

/** Every cached frame in time order — used by the media panel's hover scrub. */
export function frameList(hash: string): ImageBitmap[] {
  const s = strips.get(hash);
  if (!s) return [];
  return [...s.frames.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}

/** Whether a strip is mid-extraction, for the UI to show a cancel affordance. */
export const isExtracting = (hash: string) => !!strips.get(hash)?.abort;

/** Stop work on a strip. Frames already gathered are kept. */
export function cancelStoryboard(hash: string) {
  const s = strips.get(hash);
  if (!s?.abort) return;
  s.abort.abort();
  s.abort = null;
  s.inflight.clear();
  // Do not mark the outstanding keys as failed — the user may resume later.
  report({ kind: 'done', hash, assetName: hash });
  notify();
}

export function cancelAllStoryboards() {
  for (const hash of strips.keys()) cancelStoryboard(hash);
}

/**
 * Ask for frames at the given source times. Already-cached and in-flight keys
 * are skipped, so this is safe to call on every timeline repaint.
 */
export async function ensureFrames(asset: MediaAsset, seconds: number[]): Promise<void> {
  if (asset.kind !== 'video') return;
  const s = strip(asset.hash);
  if (s.abort) return; // a round is already running for this asset

  const wanted: number[] = [];
  const seen = new Set<number>();
  for (const t of seconds) {
    const key = snap(Math.max(0, t));
    if (seen.has(key) || s.frames.has(key) || s.inflight.has(key) || s.failed.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  if (wanted.length === 0) return;

  const batchSize = s.extractor === 'video' ? BATCH_VIDEO : BATCH_FFMPEG;
  const batch = wanted.slice(0, batchSize);
  batch.forEach((k) => s.inflight.add(k));

  // Disk cache first — a reopened project should not re-decode anything.
  const stillMissing: number[] = [];
  let restored = false;
  for (const key of batch) {
    try {
      const blob = await idbGet<Blob>(`${asset.hash}|${key}`, idbStore);
      if (blob) {
        remember(s, key, await createImageBitmap(blob));
        s.inflight.delete(key);
        restored = true;
        continue;
      }
    } catch {
      /* a cache miss behaves the same as no cache */
    }
    stillMissing.push(key);
  }
  if (restored) notify();
  if (stillMissing.length === 0) return;

  const controller = new AbortController();
  s.abort = controller;
  if (s.startedAt === 0) s.startedAt = performance.now();
  s.requested += stillMissing.length;

  report({ kind: 'start', hash: asset.hash, assetName: asset.name, total: s.requested });

  try {
    if (s.extractor === 'video') {
      await extractWithBrowser(asset, s, stillMissing, controller.signal);
    } else {
      await extractWithFfmpeg(asset, s, stillMissing, controller.signal);
    }
  } catch (err) {
    if (err instanceof UnsupportedSourceError) {
      // Browser cannot open it — switch this asset to ffmpeg permanently and
      // let the next paint retry through that path.
      s.extractor = 'ffmpeg';
      stillMissing.forEach((k) => s.inflight.delete(k));
      releaseSource(asset.hash);
      s.abort = null;
      notify();
      return;
    }
    stillMissing.forEach((k) => {
      s.inflight.delete(k);
      s.failed.add(k);
    });
    report({ kind: 'error', hash: asset.hash, assetName: asset.name, message: (err as Error).message ?? String(err) });
  } finally {
    if (s.abort === controller) s.abort = null;
  }

  // Nothing left outstanding anywhere: the strip is done.
  if (s.inflight.size === 0) {
    s.startedAt = 0;
    s.requested = 0;
    s.completed = 0;
    report({ kind: 'done', hash: asset.hash, assetName: asset.name });
  }
}

/** The fast path: browser decoder, no WASM, one open video reused across seeks. */
async function extractWithBrowser(asset: MediaAsset, s: Strip, keys: number[], signal: AbortSignal) {
  const { bitmaps, timestamps } = await grabFrames(
    asset.hash,
    asset.url,
    keys.map((k) => k / 1000),
    {
      width: THUMB_W * 2,
      signal,
      // Frames land in one go below; this only keeps the overlay's counter
      // moving while a long batch is still in flight.
      onFrame: (done) => {
        report({
          kind: 'progress',
          hash: asset.hash,
          assetName: asset.name,
          done: s.completed + done,
          total: s.requested,
          startedAt: s.startedAt,
        });
      },
    }
  );

  for (let i = 0; i < bitmaps.length; i++) {
    // Snap to the requested grid slot rather than the decoder's reported time,
    // which lands on the nearest decodable frame and would otherwise scatter
    // keys off-grid and defeat the cache.
    const key = nearestRequested(keys, snap(timestamps[i]));
    remember(s, key, bitmaps[i]);
    s.completed++;
    void persist(asset.hash, key, s.frames.get(key)!);
  }

  for (const key of keys) {
    s.inflight.delete(key);
    if (!s.frames.has(key) && !signal.aborted) s.failed.add(key);
  }

  report({
    kind: 'progress',
    hash: asset.hash,
    assetName: asset.name,
    done: s.completed,
    total: s.requested,
    startedAt: s.startedAt,
  });
  notify();
}

/** Fallback for sources the browser will not decode. */
async function extractWithFfmpeg(asset: MediaAsset, s: Strip, keys: number[], signal: AbortSignal) {
  const file = await getFileHandle(asset);
  if (!file) {
    keys.forEach((k) => {
      s.inflight.delete(k);
      s.failed.add(k);
    });
    report({
      kind: 'error',
      hash: asset.hash,
      assetName: asset.name,
      message: 'Source file is not available in this session. Re-import it to generate thumbnails.',
    });
    return;
  }

  const { bitmaps, timestamps } = await ffmpegClient.extractFrames(
    file,
    keys.map((k) => k / 1000),
    THUMB_W * 2
  );

  for (let i = 0; i < bitmaps.length; i++) {
    const key = nearestRequested(keys, snap(timestamps[i]));
    remember(s, key, bitmaps[i]);
    s.completed++;
    void persist(asset.hash, key, s.frames.get(key)!);
  }
  for (const key of keys) {
    s.inflight.delete(key);
    if (!s.frames.has(key) && !signal.aborted) s.failed.add(key);
  }

  report({
    kind: 'progress',
    hash: asset.hash,
    assetName: asset.name,
    done: s.completed,
    total: s.requested,
    startedAt: s.startedAt,
  });
  notify();
}

/** Map a decoder-reported time back onto the grid slot that was asked for. */
function nearestRequested(keys: number[], key: number): number {
  let best = key;
  let bestDist = Infinity;
  for (const k of keys) {
    const d = Math.abs(k - key);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return bestDist <= GRID_MS * 4 ? best : key;
}

/**
 * Kick off a first pass so a clip shows something the moment it lands.
 *
 * Denser than it used to be: browser-decoded frames are cheap enough that the
 * opening pass can cover the clip properly instead of scattering a handful.
 */
export function primeStoryboard(asset: MediaAsset, fps: number) {
  if (asset.kind !== 'video') return;
  const durationSeconds = asset.durationFrames / fps;
  const count = Math.min(40, Math.max(6, Math.round(durationSeconds / 1.5)));
  const seconds = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * durationSeconds);
  void ensureFrames(asset, seconds);
}

async function persist(hash: string, key: number, bitmap: ImageBitmap) {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    await idbSet(`${hash}|${key}`, blob, idbStore);
  } catch {
    /* Persisting is an optimisation; failing to do it is not an error. */
  }
}

/** Let the user retry after fixing whatever caused a failure. */
export function retryStoryboard(hash: string) {
  const s = strips.get(hash);
  if (!s) return;
  s.failed.clear();
  notify();
}

export function releaseStoryboard(hash: string) {
  const s = strips.get(hash);
  if (!s) return;
  s.abort?.abort();
  for (const bmp of s.frames.values()) bmp.close();
  totalBitmaps -= s.frames.size;
  strips.delete(hash);
  releaseSource(hash);
}

export { isSourceOpen };
