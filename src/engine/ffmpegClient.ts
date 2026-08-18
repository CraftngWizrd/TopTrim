import type { MediaAsset } from '../types/project';
import { ffmpegHost, type FrameResult, type RunOptions } from './ffmpegHost';

/**
 * Stable façade over the ffmpeg host.
 *
 * Storyboards, waveforms, captions, clip operations and export all go through
 * this one surface, so the transport underneath can change without touching
 * any of them.
 */

export type { FrameResult, RunOptions };

export const ffmpegClient = {
  init: () => ffmpegHost.init(),

  extractFrames: (file: File, timestamps: number[], width: number, onProgress?: (v: number) => void) =>
    ffmpegHost.extractFrames(file, timestamps, width, onProgress),

  extractPeaks: (file: File, buckets: number, _durationSeconds: number, onProgress?: (v: number) => void) =>
    ffmpegHost.extractPeaks(file, buckets, onProgress),

  run: (args: string[], outName: string, options: RunOptions = {}) => ffmpegHost.run(args, outName, options),

  terminate: () => ffmpegHost.terminate(),
};

/**
 * ffmpeg hands back `Uint8Array<ArrayBufferLike>` because the WASM heap may be
 * a SharedArrayBuffer. It is a perfectly valid BlobPart at runtime; the cast
 * avoids copying multi-hundred-megabyte exports just to satisfy the type.
 */
export const asBlobPart = (data: Uint8Array): BlobPart => data as unknown as BlobPart;

/* ------------------------------------------------------------------ *
 * File handle registry
 *
 * ffmpeg reads sources through WORKERFS, which needs the original `File`.
 * Handles are captured at import and kept for the session. After a project is
 * reloaded there is no handle, so one is rebuilt from the local path — but only
 * for sources small enough that reading them whole is reasonable.
 * ------------------------------------------------------------------ */

const handles = new Map<string, File>();

/** Sources larger than this are not re-materialised after a reload. */
const REHYDRATE_LIMIT = 512 * 1024 * 1024;

export const registerFileHandle = (hash: string, file: File) => handles.set(hash, file);

export const hasFileHandle = (hash: string) => handles.has(hash);

export async function getFileHandle(asset: MediaAsset): Promise<File | null> {
  const existing = handles.get(asset.hash);
  if (existing) return existing;

  if (!asset.url || asset.size > REHYDRATE_LIMIT) return null;
  try {
    const res = await fetch(asset.url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], safeName(asset.name), { type: blob.type });
    handles.set(asset.hash, file);
    return file;
  } catch {
    return null;
  }
}

/** WORKERFS paths go straight into an ffmpeg argv; keep them boring. */
export function safeName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length).replace(/[^\w-]/g, '_');
  return `${base || 'media'}${ext.replace(/[^\w.]/g, '')}`;
}
