import type { BezierPoint, Clip, EasingKind, Frames, Keyframe, KeyframeMap } from '../types/project';
import { clamp, lerp } from './time';

/**
 * Keyframe engine. Any numeric property on a clip can be animated by dotted
 * path (`transform.scale`, `color.exposure`, `audio.volumeDb`, ...). The
 * timeline draws diamonds from the same map, and export reads values through
 * the same evaluator the preview uses — so what you see is what renders.
 */

/* ---------- property path access ---------- */

export function getPath(obj: unknown, path: string): number | undefined {
  let cur: any = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return typeof cur === 'number' ? cur : undefined;
}

export function setPath(obj: unknown, path: string, value: number): void {
  const keys = path.split('.');
  let cur: any = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/* ---------- easing ---------- */

/** Solve y for a given x on a cubic bezier with fixed endpoints (0,0)-(1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // Newton–Raphson, then bisect if the derivative is too flat to converge.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (t < 0 || t > 1) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v > x) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

const EASING_CURVES: Record<Exclude<EasingKind, 'bezier' | 'hold' | 'linear'>, [number, number, number, number]> = {
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

export function applyEasing(t: number, kf: Keyframe): number {
  switch (kf.easing) {
    case 'linear':
      return t;
    case 'hold':
      return 0;
    case 'bezier': {
      const [x1, y1, x2, y2] = kf.bezier ?? [0.25, 0.1, 0.25, 1];
      return cubicBezier(x1, y1, x2, y2, t);
    }
    default: {
      const [x1, y1, x2, y2] = EASING_CURVES[kf.easing];
      return cubicBezier(x1, y1, x2, y2, t);
    }
  }
}

/* ---------- evaluation ---------- */

/**
 * Value of `path` at absolute timeline frame `frame`.
 * Returns `fallback` when the property has no keyframes.
 */
export function evaluateKeyframes(
  keyframes: KeyframeMap,
  path: string,
  frame: Frames,
  fallback: number
): number {
  const list = keyframes[path];
  if (!list || list.length === 0) return fallback;
  if (list.length === 1) return list[0].value;

  if (frame <= list[0].frame) return list[0].value;
  const last = list[list.length - 1];
  if (frame >= last.frame) return last.value;

  // Keyframe lists are kept sorted by frame on insert, so binary search is safe.
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].frame <= frame) lo = mid;
    else hi = mid;
  }

  const a = list[lo];
  const b = list[hi];
  const span = b.frame - a.frame;
  if (span <= 0) return b.value;

  const t = (frame - a.frame) / span;
  return lerp(a.value, b.value, applyEasing(t, a));
}

/** Every animatable property resolved for one clip at one frame. */
export function resolveClipAt(clip: Clip, frame: Frames): {
  transform: Clip['transform'];
  color: Clip['color'];
  audio: Clip['audio'];
} {
  const paths = Object.keys(clip.keyframes);
  if (paths.length === 0) {
    return { transform: clip.transform, color: clip.color, audio: clip.audio };
  }

  // Clone only the groups that are actually animated. This runs once per layer
  // per animation frame, and deep-cloning the full colour grade (curves,
  // wheels, seven HSL bands) every time was pure waste on clips that only
  // animate a transform.
  const animatesTransform = paths.some((p) => p.startsWith('transform.'));
  const animatesColor = paths.some((p) => p.startsWith('color.'));
  const animatesAudio = paths.some((p) => p.startsWith('audio.'));

  const out = {
    transform: animatesTransform ? { ...clip.transform, crop: { ...clip.transform.crop } } : clip.transform,
    color: animatesColor ? structuredClone(clip.color) : clip.color,
    audio: animatesAudio ? { ...clip.audio } : clip.audio,
  };

  for (const path of paths) {
    const current = getPath(out, path);
    if (current === undefined) continue;
    setPath(out, path, evaluateKeyframes(clip.keyframes, path, frame, current));
  }
  return out;
}

/* ---------- mutation helpers ---------- */

export const hasKeyframeAt = (keyframes: KeyframeMap, path: string, frame: Frames): boolean =>
  !!keyframes[path]?.some((k) => k.frame === frame);

export function upsertKeyframe(
  keyframes: KeyframeMap,
  path: string,
  frame: Frames,
  value: number,
  id: string,
  easing: EasingKind = 'ease-in-out'
): void {
  const list = keyframes[path] ?? (keyframes[path] = []);
  const existing = list.find((k) => k.frame === frame);
  if (existing) {
    existing.value = value;
    return;
  }
  list.push({ id, frame, value, easing });
  list.sort((a, b) => a.frame - b.frame);
}

export function removeKeyframeAt(keyframes: KeyframeMap, path: string, frame: Frames): void {
  const list = keyframes[path];
  if (!list) return;
  const next = list.filter((k) => k.frame !== frame);
  if (next.length === 0) delete keyframes[path];
  else keyframes[path] = next;
}

export function moveKeyframe(keyframes: KeyframeMap, path: string, id: string, toFrame: Frames): void {
  const list = keyframes[path];
  if (!list) return;
  const kf = list.find((k) => k.id === id);
  if (!kf) return;
  kf.frame = Math.max(0, Math.round(toFrame));
  list.sort((a, b) => a.frame - b.frame);
}

/** Every distinct frame that carries a keyframe on this clip — what the timeline draws. */
export function keyframeFrames(keyframes: KeyframeMap): Frames[] {
  const set = new Set<Frames>();
  for (const list of Object.values(keyframes)) for (const k of list) set.add(k.frame);
  return [...set].sort((a, b) => a - b);
}

/* ---------- easing presets ---------- */

export interface EasingPreset {
  id: string;
  name: string;
  easing: EasingKind;
  bezier?: [number, number, number, number];
}

/**
 * The easing menu, in the order it reads best.
 *
 * The last two deliberately push their control points outside 0..1: overshoot
 * sails past the target and settles back, anticipate winds up the other way
 * first. The solver only inverts x, so a y outside the unit range is fine and
 * is what produces the motion.
 */
export const EASING_PRESETS: EasingPreset[] = [
  { id: 'linear', name: 'Linear', easing: 'linear' },
  { id: 'ease-in', name: 'Ease in', easing: 'ease-in' },
  { id: 'ease-out', name: 'Ease out', easing: 'ease-out' },
  { id: 'ease-in-out', name: 'Ease in-out', easing: 'ease-in-out' },
  { id: 'hold', name: 'Hold', easing: 'hold' },
  { id: 'smooth', name: 'Smooth', easing: 'bezier', bezier: [0.4, 0, 0.2, 1] },
  { id: 'snappy', name: 'Snappy', easing: 'bezier', bezier: [0.2, 0, 0, 1] },
  { id: 'gentle', name: 'Gentle', easing: 'bezier', bezier: [0.25, 0.1, 0.25, 1] },
  { id: 'overshoot', name: 'Overshoot', easing: 'bezier', bezier: [0.34, 1.56, 0.64, 1] },
  { id: 'anticipate', name: 'Anticipate', easing: 'bezier', bezier: [0.36, 0, 0.66, -0.56] },
];

export const easingPresetById = (id: string) => EASING_PRESETS.find((p) => p.id === id);

/** Control points for a keyframe's easing, for drawing and editing. */
export function bezierFor(kf: Keyframe): [number, number, number, number] {
  if (kf.easing === 'bezier' && kf.bezier) return kf.bezier;
  switch (kf.easing) {
    case 'ease-in':
      return [0.42, 0, 1, 1];
    case 'ease-out':
      return [0, 0, 0.58, 1];
    case 'ease-in-out':
      return [0.42, 0, 0.58, 1];
    case 'hold':
      return [1, 0, 1, 0];
    default:
      return [0, 0, 1, 1];
  }
}

/** Which of `paths` are actually in play — already animated, or moved off their default. */
export function engagedPaths(source: unknown, keyframes: KeyframeMap, paths: string[], defaults: unknown): string[] {
  return paths.filter((path) => {
    if (keyframes[path]?.length) return true;
    const current = getPath(source, path);
    const base = getPath(defaults, path);
    if (current === undefined || base === undefined) return false;
    return Math.abs(current - base) > 1e-6;
  });
}

/* ---------- speed curves ---------- */

/**
 * Map elapsed timeline progress (0..1) to source progress (0..1) through a
 * bezier speed ramp. The curve's y axis is *speed*, so source position is its
 * integral — that is what makes a ramp look continuous instead of jumping.
 */
export function evaluateSpeedCurve(curve: BezierPoint[], t: number, samples = 128): number {
  if (curve.length < 2) return t;
  const speedAt = (x: number): number => {
    const cx = clamp(x, 0, 1);
    let i = 0;
    while (i < curve.length - 2 && curve[i + 1].x < cx) i++;
    const a = curve[i];
    const b = curve[i + 1];
    const span = b.x - a.x;
    const local = span <= 0 ? 0 : (cx - a.x) / span;
    // Speed axis is stored 0..1 mapping to 0.1x..10x on a log scale.
    const y = lerp(a.y, b.y, cubicBezier(0.42, 0, 0.58, 1, local));
    return Math.pow(10, lerp(-1, 1, clamp(y, 0, 1)));
  };

  let total = 0;
  let upTo = 0;
  const step = 1 / samples;
  const target = clamp(t, 0, 1);
  for (let i = 0; i < samples; i++) {
    const x = i * step;
    const v = speedAt(x + step / 2) * step;
    total += v;
    if (x < target) upTo += v;
    else if (x < target + step) upTo += v * ((target - x) / step);
  }
  return total <= 0 ? t : clamp(upTo / total, 0, 1);
}

export const DEFAULT_SPEED_CURVE: BezierPoint[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
];

/** Speed-curve presets from the Speed tab. y = 0.5 is 1x on the log scale. */
export const SPEED_CURVE_PRESETS: Record<string, BezierPoint[]> = {
  custom: DEFAULT_SPEED_CURVE,
  hero: [{ x: 0, y: 0.62 }, { x: 0.3, y: 0.62 }, { x: 0.45, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.75, y: 0.62 }, { x: 1, y: 0.62 }],
  bullet: [{ x: 0, y: 0.75 }, { x: 0.35, y: 0.75 }, { x: 0.5, y: 0.05 }, { x: 0.65, y: 0.75 }, { x: 1, y: 0.75 }],
  montage: [{ x: 0, y: 0.35 }, { x: 0.25, y: 0.7 }, { x: 0.5, y: 0.35 }, { x: 0.75, y: 0.7 }, { x: 1, y: 0.35 }],
  'jump-cut': [{ x: 0, y: 0.5 }, { x: 0.45, y: 0.5 }, { x: 0.5, y: 0.95 }, { x: 0.55, y: 0.5 }, { x: 1, y: 0.5 }],
  'flash-in': [{ x: 0, y: 0.95 }, { x: 0.2, y: 0.5 }, { x: 1, y: 0.5 }],
  'flash-out': [{ x: 0, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 1, y: 0.95 }],
};
