import { get as idbGet, set as idbSet, createStore } from 'idb-keyval';
import type { MediaAsset } from '../types/project';
import { ffmpegClient, getFileHandle } from './ffmpegClient';

/**
 * Waveform peaks for audio clips.
 *
 * One peak array per asset at a fixed resolution, decoded once in the ffmpeg
 * worker and cached to IndexedDB. The timeline resamples it to whatever width
 * the clip currently occupies, so zooming costs nothing.
 */

/** Peaks per second of source. 40 is dense enough to read at full zoom. */
const PEAKS_PER_SECOND = 40;

const idbStore = createStore('toptrim-waveform', 'peaks');

const peaks = new Map<string, Float32Array>();
const inflight = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((cb) => cb());

export function onWaveformUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const getPeaks = (hash: string): Float32Array | null => peaks.get(hash) ?? null;
export const isWaveformPending = (hash: string) => inflight.has(hash);

/**
 * Resample the stored peaks to `width` bars covering [startSeconds, endSeconds).
 * Returns null while the peaks are still being decoded.
 */
export function samplePeaks(
  hash: string,
  startSeconds: number,
  endSeconds: number,
  bars: number
): Float32Array | null {
  const data = peaks.get(hash);
  if (!data || bars <= 0) return null;

  const out = new Float32Array(bars);
  const from = startSeconds * PEAKS_PER_SECOND;
  const to = endSeconds * PEAKS_PER_SECOND;
  const per = (to - from) / bars;

  for (let i = 0; i < bars; i++) {
    const a = Math.max(0, Math.floor(from + i * per));
    const b = Math.min(data.length, Math.max(a + 1, Math.ceil(from + (i + 1) * per)));
    let peak = 0;
    for (let j = a; j < b; j++) if (data[j] > peak) peak = data[j];
    out[i] = peak;
  }
  return out;
}

export async function ensureWaveform(asset: MediaAsset, fps: number): Promise<void> {
  if (asset.kind === 'image') return;
  if (asset.kind === 'video' && !asset.hasAudio) return;
  if (peaks.has(asset.hash) || inflight.has(asset.hash) || failed.has(asset.hash)) return;

  inflight.add(asset.hash);
  try {
    const cached = await idbGet<ArrayBuffer>(asset.hash, idbStore);
    if (cached) {
      peaks.set(asset.hash, new Float32Array(cached));
      notify();
      return;
    }

    const file = await getFileHandle(asset);
    if (!file) {
      failed.add(asset.hash);
      return;
    }

    const durationSeconds = asset.durationFrames / fps;
    const buckets = Math.max(64, Math.round(durationSeconds * PEAKS_PER_SECOND));
    const result = await ffmpegClient.extractPeaks(file, buckets, durationSeconds);

    peaks.set(asset.hash, result);
    void idbSet(asset.hash, result.buffer.slice(0), idbStore).catch(() => {});
    notify();
  } catch (err) {
    failed.add(asset.hash);
    console.warn('[toptrim] waveform decode failed', err);
  } finally {
    inflight.delete(asset.hash);
  }
}

export function releaseWaveform(hash: string) {
  peaks.delete(hash);
  failed.delete(hash);
}

export { PEAKS_PER_SECOND };
