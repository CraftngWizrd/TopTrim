import type { Frames, Seconds } from '../types/project';

/**
 * Frames are the timeline's only unit. These are the boundary conversions:
 * to the <video> element, to ffmpeg, and to the on-screen timecode.
 */

export const framesToSeconds = (frames: Frames, fps: number): Seconds => frames / fps;

export const secondsToFrames = (seconds: Seconds, fps: number): Frames =>
  Math.round(seconds * fps);

/** Floor variant — use when mapping a continuous playhead to the frame it sits on. */
export const secondsToFrameFloor = (seconds: Seconds, fps: number): Frames =>
  Math.floor(seconds * fps);

const pad = (n: number, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0');

/** `HH:MM:SS:FF` — the editor's canonical timecode. */
export function formatTimecode(frames: Frames, fps: number): string {
  const sign = frames < 0 ? '-' : '';
  const f = Math.abs(Math.round(frames));
  const totalSeconds = Math.floor(f / fps);
  return (
    sign +
    `${pad(totalSeconds / 3600)}:${pad((totalSeconds % 3600) / 60)}:${pad(totalSeconds % 60)}:${pad(f % fps)}`
  );
}

/** `M:SS` / `H:MM:SS` — compact, for clip durations and the ruler. */
export function formatDuration(frames: Frames, fps: number): string {
  const totalSeconds = Math.max(0, Math.round(frames / fps));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `0:05.2` — ruler labels need sub-second precision when zoomed in. */
export function formatRulerLabel(frames: Frames, fps: number, showTenths: boolean): string {
  const totalSeconds = frames / fps;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (showTenths) return `${m}:${pad(s)}.${Math.floor((s % 1) * 10)}`;
  return `${m}:${pad(s)}`;
}

export function parseTimecode(text: string, fps: number): Frames | null {
  const parts = text.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 4) {
    const [h, m, s, f] = parts;
    return ((h * 3600 + m * 60 + s) * fps + f) | 0;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Math.round((h * 3600 + m * 60 + s) * fps);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Math.round((m * 60 + s) * fps);
  }
  if (parts.length === 1) return Math.round(parts[0] * fps);
  return null;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Rounds to `step`, used to keep dragged values on tidy increments. */
export const quantize = (v: number, step: number) => Math.round(v / step) * step;
