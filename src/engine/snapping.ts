import type { Clip, Frames, TimelineState } from '../types/project';

/**
 * Snapping. Targets are collected once per gesture (not per pointermove) and
 * matched in pixel space, so the magnet feels identical at every zoom level.
 */

export type SnapKind = 'playhead' | 'clip-start' | 'clip-end' | 'marker' | 'origin' | 'loop' | 'beat';

export interface SnapTarget {
  frame: Frames;
  kind: SnapKind;
}

export interface SnapResult {
  frame: Frames;
  target: SnapTarget | null;
}

/** Snap radius in screen pixels — constant regardless of zoom. */
export const SNAP_PX = 8;

/**
 * The two toolbar toggles do different jobs, and both are honoured here:
 *
 *   magnet — clips adsorb to each other's edges, so cuts butt up with no gap
 *   snap   — clips align to the playhead, markers, beats, the loop and zero
 *
 * Turning one off leaves the other working, which is the whole point of having
 * two buttons.
 */
export interface SnapSources {
  /** Magnet: other clips' start and end frames. */
  clipEdges: boolean;
  /** Snap: playhead, markers, beats, loop bounds and the timeline origin. */
  guides: boolean;
}

export function collectSnapTargets(
  state: TimelineState,
  playhead: Frames,
  excludeClipIds: Set<string> = new Set(),
  sources: SnapSources = { clipEdges: true, guides: true }
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  if (sources.guides) {
    targets.push({ frame: 0, kind: 'origin' });
    targets.push({ frame: playhead, kind: 'playhead' });
    for (const m of state.markers) targets.push({ frame: m.frame, kind: 'marker' });
    for (const b of state.beats) targets.push({ frame: b, kind: 'beat' });
    if (state.loop.enabled) {
      targets.push({ frame: state.loop.inFrame, kind: 'loop' });
      targets.push({ frame: state.loop.outFrame, kind: 'loop' });
    }
  }

  if (sources.clipEdges) {
    for (const clip of Object.values(state.clips)) {
      if (excludeClipIds.has(clip.id)) continue;
      targets.push({ frame: clip.start, kind: 'clip-start' });
      targets.push({ frame: clip.start + clip.duration, kind: 'clip-end' });
    }
  }

  return targets;
}

export function snapFrame(
  frame: Frames,
  targets: SnapTarget[],
  pixelsPerFrame: number,
  enabled: boolean
): SnapResult {
  if (!enabled || targets.length === 0) return { frame: Math.round(frame), target: null };

  const radiusFrames = SNAP_PX / Math.max(pixelsPerFrame, 1e-6);
  let best: SnapTarget | null = null;
  let bestDist = Infinity;

  for (const t of targets) {
    const d = Math.abs(t.frame - frame);
    if (d < bestDist && d <= radiusFrames) {
      bestDist = d;
      best = t;
    }
  }
  return best ? { frame: best.frame, target: best } : { frame: Math.round(frame), target: null };
}

/**
 * Snap a whole selection by testing both edges of every dragged clip and
 * applying the single best offset — so a multi-clip drag latches as one unit
 * instead of each clip fighting for its own target.
 */
export function snapClipDrag(
  clips: Clip[],
  deltaFrames: number,
  targets: SnapTarget[],
  pixelsPerFrame: number,
  enabled: boolean
): { delta: number; target: SnapTarget | null; atFrame: Frames | null } {
  if (!enabled || clips.length === 0) {
    return { delta: Math.round(deltaFrames), target: null, atFrame: null };
  }

  const radiusFrames = SNAP_PX / Math.max(pixelsPerFrame, 1e-6);
  let bestDelta = Math.round(deltaFrames);
  let best: SnapTarget | null = null;
  let bestAt: Frames | null = null;
  let bestDist = Infinity;

  for (const clip of clips) {
    for (const edge of [clip.start + deltaFrames, clip.start + clip.duration + deltaFrames]) {
      for (const t of targets) {
        const d = Math.abs(t.frame - edge);
        if (d < bestDist && d <= radiusFrames) {
          bestDist = d;
          bestDelta = Math.round(deltaFrames + (t.frame - edge));
          best = t;
          bestAt = t.frame;
        }
      }
    }
  }
  return { delta: bestDelta, target: best, atFrame: bestAt };
}
