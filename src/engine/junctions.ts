import type { Clip, Frames, TimelineState } from '../types/project';

/**
 * Cut points — where one clip ends and the next begins on the same track.
 *
 * A transition belongs to a junction, not to a clip, which is why dropping one
 * onto "a clip" was always ambiguous: a clip has two ends. Finding the seam
 * under the pointer makes the drop mean exactly one thing.
 */

export interface Junction {
  /** Frame where the two clips meet. */
  frame: Frames;
  trackId: string;
  leftClipId: string;
  rightClipId: string;
  /** Longest transition these two can support without eating a whole clip. */
  maxDurationFrames: Frames;
}

/**
 * Clips this close together still count as a cut. Trimming by hand rarely
 * lands exactly frame-perfect, and a one-frame gap should not stop you
 * dropping a transition on an obvious seam.
 */
const JOIN_TOLERANCE = 2;

export function findJunctions(state: TimelineState): Junction[] {
  const byTrack = new Map<string, Clip[]>();
  for (const clip of Object.values(state.clips)) {
    if (clip.kind === 'audio') continue; // transitions are a visual join
    let list = byTrack.get(clip.trackId);
    if (!list) byTrack.set(clip.trackId, (list = []));
    list.push(clip);
  }

  const junctions: Junction[] = [];
  for (const [trackId, clips] of byTrack) {
    clips.sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length - 1; i++) {
      const left = clips[i];
      const right = clips[i + 1];
      const leftEnd = left.start + left.duration;
      if (Math.abs(right.start - leftEnd) > JOIN_TOLERANCE) continue;

      junctions.push({
        frame: leftEnd,
        trackId,
        leftClipId: left.id,
        rightClipId: right.id,
        // Half of the shorter neighbour: a transition may never consume more
        // than half of either clip, or it would run past its own footage.
        maxDurationFrames: Math.max(2, Math.floor(Math.min(left.duration, right.duration) / 2)),
      });
    }
  }
  return junctions;
}

/** Junction nearest `frame` on `trackId`, within `toleranceFrames`. */
export function junctionNear(
  junctions: Junction[],
  trackId: string | null,
  frame: Frames,
  toleranceFrames: number
): Junction | null {
  let best: Junction | null = null;
  let bestDist = Infinity;
  for (const j of junctions) {
    if (trackId && j.trackId !== trackId) continue;
    const d = Math.abs(j.frame - frame);
    if (d < bestDist && d <= toleranceFrames) {
      bestDist = d;
      best = j;
    }
  }
  return best;
}
