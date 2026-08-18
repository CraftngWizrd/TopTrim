import type { Clip, Frames, TimelineState, Track } from '../types/project';
import { kindFitsTrack } from './trackOrder';

/**
 * Where a dragged selection actually lands when you let go.
 *
 * The drag itself is free — the clip follows the cursor without snapping — and
 * everything is decided here at drop time. Two rules shape the answer:
 *
 *   1. Clips never overlap on a track. If the drop would collide, the
 *      selection moves one track along the band and tries again.
 *   2. If nothing in the band has room, a new track is created for it.
 *
 * "Along the band" means upward for video/text/stickers (overlays stack over
 * Main) and downward for audio (which grows away from Main). Walking the wrong
 * way would cross a band boundary, which the ordering rules forbid.
 */

export interface MovingClip {
  id: string;
  kind: Clip['kind'];
  /** Start frame the clip would take if it landed where the pointer is. */
  start: Frames;
  duration: Frames;
}

export interface DropResolution {
  /** Existing track to land on, or null when a new one must be created. */
  trackId: string | null;
  /** True when the caller should create a track for this selection. */
  needsNewTrack: boolean;
  /** How many tracks the selection was pushed to avoid a collision. */
  pushedBy: number;
}

export const rangesOverlap = (aStart: Frames, aDur: Frames, bStart: Frames, bDur: Frames): boolean =>
  aStart < bStart + bDur && bStart < aStart + aDur;

/** Would `moving` fit on `trackId` without touching anything already there? */
export function trackHasRoom(
  state: TimelineState,
  trackId: string,
  moving: MovingClip[],
  ignoreIds: Set<string>
): boolean {
  for (const existing of Object.values(state.clips)) {
    if (existing.trackId !== trackId || ignoreIds.has(existing.id)) continue;
    for (const m of moving) {
      if (rangesOverlap(m.start, m.duration, existing.start, existing.duration)) return false;
    }
  }
  return true;
}

/**
 * Resolve the landing track.
 *
 * `preferredIndex` is the track nearest the pointer. From there we walk along
 * the band looking for the first one with room.
 */
export function resolveDrop(
  state: TimelineState,
  moving: MovingClip[],
  preferredIndex: number
): DropResolution {
  if (moving.length === 0) return { trackId: null, needsNewTrack: false, pushedBy: 0 };

  const kind = moving[0].kind;
  const ignore = new Set(moving.map((m) => m.id));
  const isAudio = kind === 'audio';

  // Indices of tracks that can hold this kind, ordered the way the band grows.
  const compatible: number[] = [];
  state.tracks.forEach((t, i) => {
    if (kindFitsTrack(kind, t.kind)) compatible.push(i);
  });
  if (compatible.length === 0) return { trackId: null, needsNewTrack: true, pushedBy: 0 };

  // Start from whichever compatible track is nearest the preferred index, then
  // move outward in the band's growth direction.
  let startAt = 0;
  let bestDist = Infinity;
  compatible.forEach((idx, n) => {
    const d = Math.abs(idx - preferredIndex);
    if (d < bestDist) {
      bestDist = d;
      startAt = n;
    }
  });

  const order = isAudio
    ? compatible.slice(startAt) // audio grows downward: later indices
    : compatible.slice(0, startAt + 1).reverse(); // overlays grow upward: earlier indices

  for (let n = 0; n < order.length; n++) {
    const track = state.tracks[order[n]];
    if (trackHasRoom(state, track.id, moving, ignore)) {
      return { trackId: track.id, needsNewTrack: false, pushedBy: n };
    }
  }

  // Every track in that direction is occupied — the selection needs its own.
  return { trackId: null, needsNewTrack: true, pushedBy: order.length };
}

/** Track kind a clip of this kind requires. */
export function trackKindFor(clipKind: Clip['kind']): Track['kind'] {
  if (clipKind === 'audio') return 'audio';
  if (clipKind === 'text') return 'text';
  if (clipKind === 'sticker') return 'sticker';
  if (clipKind === 'effect') return 'effect';
  return 'video';
}
