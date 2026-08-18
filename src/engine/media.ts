import type { MediaAsset, MediaKind } from '../types/project';
import type { PlatformAdapter, PlatformFile } from '../platform/types';
import { id as newId } from './defaults';
import { secondsToFrames } from './time';

/**
 * Media import. Probing happens through real media elements rather than
 * ffmpeg.wasm because it is instant and needs no WASM load — ffmpeg is reserved
 * for the work only it can do (frames, PCM, encoding).
 */

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|wmv|flv|3gp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|wma)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

export const MEDIA_ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov,.m4v,.flac,.opus';

export function kindForFile(file: { name: string; type?: string }): MediaKind | null {
  const type = file.type ?? '';
  if (type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

/**
 * Stable cache key for storyboard frames and waveform peaks.
 * Identity comes from path + size + mtime, which is both free and correct —
 * hashing the bytes of a 4 GB source on every import would not be.
 */
export function assetHash(file: PlatformFile): string {
  const base = file.localPath ?? file.name;
  return `${base}::${file.size}::${file.lastModified}`.replace(/[^\w:.-]/g, '_');
}

interface Probe {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

function probeVideo(url: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
    };
    el.onloadedmetadata = () => {
      const probe: Probe = {
        durationSeconds: Number.isFinite(el.duration) ? el.duration : 0,
        width: el.videoWidth || 1920,
        height: el.videoHeight || 1080,
        // Chromium exposes these on the media element for most containers.
        hasAudio:
          (el as unknown as { mozHasAudio?: boolean }).mozHasAudio ??
          (el as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount !== 0,
      };
      cleanup();
      resolve(probe);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error('Could not read video metadata'));
    };
    el.src = url;
  });
}

function probeAudio(url: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      resolve({
        durationSeconds: Number.isFinite(el.duration) ? el.duration : 0,
        width: 0,
        height: 0,
        hasAudio: true,
      });
    };
    el.onerror = () => reject(new Error('Could not read audio metadata'));
    el.src = url;
  });
}

function probeImage(url: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ durationSeconds: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false });
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = url;
  });
}

/**
 * Object URLs are created exactly once here and stored on the asset. They are
 * never re-created on re-render — that is what keeps the <video> element from
 * reloading and flashing black mid-edit.
 */
export async function importFiles(
  files: PlatformFile[],
  platform: PlatformAdapter,
  fps: number
): Promise<{ assets: MediaAsset[]; errors: { name: string; reason: string }[] }> {
  const assets: MediaAsset[] = [];
  const errors: { name: string; reason: string }[] = [];

  for (const file of files) {
    const kind = kindForFile(file);
    if (!kind) {
      errors.push({ name: file.name, reason: 'Unsupported file type' });
      continue;
    }

    // A toptrim:// URL survives save/reload; a blob: URL would not.
    const localPath = file.localPath ?? platform.getLocalPath(file) ?? null;
    const url = localPath ? await platform.getObjectUrl(localPath) : URL.createObjectURL(file);

    try {
      const probe =
        kind === 'video' ? await probeVideo(url) : kind === 'audio' ? await probeAudio(url) : await probeImage(url);

      assets.push({
        id: newId(),
        kind,
        name: file.name,
        path: localPath,
        url,
        size: file.size,
        durationFrames: kind === 'image' ? 150 : Math.max(1, secondsToFrames(probe.durationSeconds, fps)),
        width: probe.width,
        height: probe.height,
        fps,
        hasAudio: kind === 'image' ? false : probe.hasAudio,
        hash: assetHash(file),
        importedAt: Date.now(),
      });
    } catch (err) {
      if (!localPath) URL.revokeObjectURL(url);
      errors.push({ name: file.name, reason: (err as Error).message });
    }
  }

  return { assets, errors };
}

/** Re-attach URLs after a project is loaded from disk. */
export async function rehydrateAssetUrls(
  assets: Record<string, MediaAsset>,
  platform: PlatformAdapter
): Promise<{ missing: MediaAsset[] }> {
  const missing: MediaAsset[] = [];
  for (const asset of Object.values(assets)) {
    if (!asset.path) {
      // Blob URLs die with the page; the source has to be re-linked by hand.
      missing.push(asset);
      continue;
    }
    const stat = await platform.statFile(asset.path);
    if (!stat.exists) {
      missing.push(asset);
      continue;
    }
    asset.url = await platform.getObjectUrl(asset.path);
  }
  return { missing };
}

/** Extract a still from a video at `seconds`, as a data URL (project thumbnails). */
export function grabFrame(url: string, seconds: number, maxWidth = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.crossOrigin = 'anonymous';

    const fail = (e: unknown) => {
      video.removeAttribute('src');
      video.load();
      reject(e instanceof Error ? e : new Error('Frame grab failed'));
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(seconds, Math.max(0, (video.duration || 1) - 0.05));
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        video.removeAttribute('src');
        video.load();
        resolve(dataUrl);
      } catch (e) {
        fail(e);
      }
    };
    video.onerror = () => fail(new Error('Could not open video'));
    video.src = url;
  });
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
