import type { Track, TrackKind } from '../types/project';

/**
 * Track ordering, conventional non-linear-editor style.
 *
 * The timeline is three bands, top to bottom:
 *
 *   overlay   video/text/sticker/effect tracks added after the project began.
 *             Newest sits highest, and higher means it composites on top.
 *   main      the video track the project was created with. It stays put.
 *   audio     always pinned to the bottom, in creation order.
 *
 * Array order IS render order — index 0 is the top row and the topmost layer —
 * so keeping the array sorted keeps the canvas, the compositor and the export
 * agreeing about what is in front of what, with no separate z-index to drift.
 */

export type TrackBand = 'overlay' | 'main' | 'audio';

const BAND_RANK: Record<TrackBand, number> = { overlay: 0, main: 1, audio: 2 };

export function bandOf(track: Track): TrackBand {
  if (track.kind === 'audio') return 'audio';
  return track.isMain ? 'main' : 'overlay';
}

/**
 * Identify the main track for a project saved before the flag existed: the
 * earliest video track. Returns a new array only when something changed.
 */
export function ensureMainTrack(tracks: Track[]): Track[] {
  if (tracks.some((t) => t.isMain)) return tracks;
  const firstVideo = tracks.find((t) => t.kind === 'video');
  if (!firstVideo) return tracks;
  return tracks.map((t) => (t.id === firstVideo.id ? { ...t, isMain: true } : t));
}

/**
 * Canonical order. Stable within a band, so an explicit reorder inside the
 * overlay stack survives the next sort.
 */
export function sortTracks(tracks: Track[]): Track[] {
  const withMain = ensureMainTrack(tracks);
  return withMain
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const rank = BAND_RANK[bandOf(a.track)] - BAND_RANK[bandOf(b.track)];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((e) => e.track);
}

/**
 * Where a newly created track belongs.
 *
 * New overlays go to the very top, which is what "drag it higher" means in
 * practice — the thing you just added is the thing you are about to work on,
 * and it composites over everything below. Audio appends to the bottom band.
 */
export function insertTrack(tracks: Track[], track: Track): Track[] {
  const sorted = sortTracks(tracks);
  if (track.kind === 'audio') return sortTracks([...sorted, track]);
  return sortTracks([track, ...sorted]);
}

/**
 * Move a track within its own band. Bands themselves never interleave: audio
 * cannot be dragged above the main track, and the main track does not move.
 */
export function moveTrackWithinBand(tracks: Track[], trackId: string, delta: number): Track[] {
  const sorted = sortTracks(tracks);
  const from = sorted.findIndex((t) => t.id === trackId);
  if (from < 0) return sorted;

  const track = sorted[from];
  const band = bandOf(track);
  if (band === 'main') return sorted; // the main track is an anchor

  const siblings = sorted.filter((t) => bandOf(t) === band);
  const localIndex = siblings.findIndex((t) => t.id === trackId);
  const target = Math.max(0, Math.min(siblings.length - 1, localIndex + delta));
  if (target === localIndex) return sorted;

  const reordered = [...siblings];
  reordered.splice(localIndex, 1);
  reordered.splice(target, 0, track);

  // Rebuild the full list, substituting the reordered band in place.
  let cursor = 0;
  return sorted.map((t) => (bandOf(t) === band ? reordered[cursor++] : t));
}

/** Default name for a new track of this kind, given what already exists. */
export function nextTrackName(tracks: Track[], kind: TrackKind): string {
  if (kind === 'video' && !tracks.some((t) => t.isMain)) return 'Main';
  const label = kind[0].toUpperCase() + kind.slice(1);
  const count = tracks.filter((t) => t.kind === kind && !t.isMain).length + 1;
  return `${label} ${count}`;
}

/**
 * Tracks that always exist, even when empty: the main video track and the
 * first audio track. Everything else is created by dropping media on it and
 * disappears again when its last clip leaves, so the stack only ever shows
 * rows that are carrying something.
 */
export function isProtectedTrack(track: Track, tracks: Track[]): boolean {
  if (track.isMain) return true;
  const firstAudio = tracks.find((t) => t.kind === 'audio');
  return !!firstAudio && firstAudio.id === track.id;
}

/**
 * Drop tracks that hold no clips, keeping the protected pair.
 * Returns the same array reference when nothing changed, so callers can skip
 * a pointless state write.
 */
export function pruneEmptyTracks(tracks: Track[], clips: { trackId: string }[]): Track[] {
  const used = new Set(clips.map((c) => c.trackId));
  const kept = tracks.filter((t) => used.has(t.id) || isProtectedTrack(t, tracks));
  return kept.length === tracks.length ? tracks : sortTracks(kept);
}

/** Can a clip of this kind live on this track? */
export function kindFitsTrack(clipKind: string, trackKind: TrackKind): boolean {
  if (clipKind === 'audio') return trackKind === 'audio';
  if (clipKind === 'video' || clipKind === 'image') return trackKind === 'video';
  if (clipKind === 'text') return trackKind === 'text';
  if (clipKind === 'sticker') return trackKind === 'sticker';
  return trackKind === 'effect';
}
