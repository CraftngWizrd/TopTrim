import { create } from 'zustand';
import type {
  Clip,
  ClipKind,
  Frames,
  Keyframe,
  MediaAsset,
  Marker,
  Project,
  ProjectMeta,
  TimelineState,
  Track,
  TrackKind,
} from '../../types/project';
import {
  clipFromAsset,
  createClip,
  createProject,
  createTimelineState,
  normalizeTimelineState,
  createTrack,
  defaultColorGrade,
  defaultTextProps,
  id as newId,
  TRACK_HEIGHT,
} from '../../engine/defaults';
import { defaultEffectParams, effectById } from '../../engine/effects';
import { transitionById } from '../../engine/transitions';
import { filterById } from '../../engine/libraries';
import {
  getPath,
  removeKeyframeAt,
  setPath,
  upsertKeyframe,
} from '../../engine/keyframes';
import {
  insertTrack,
  moveTrackWithinBand,
  nextTrackName,
  pruneEmptyTracks,
  sortTracks,
} from '../../engine/trackOrder';

/**
 * The single source of truth for everything that belongs to a project.
 *
 * History model: gestures, not diffs. A drag snapshots once at `beginGesture`,
 * mutates freely at 60fps with `update` (no history churn), and pushes exactly
 * one undo entry at `endGesture`. `commit` is the one-shot version.
 */

const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  label: string;
  state: TimelineState;
}

interface EditorStore {
  meta: ProjectMeta | null;
  state: TimelineState;

  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Snapshot taken at beginGesture, pushed to `past` at endGesture. */
  gestureSnapshot: TimelineState | null;
  gestureDepth: number;

  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;

  /* lifecycle */
  loadProject(p: Project): void;
  newProject(name?: string, width?: number, height?: number, fps?: number): Project;
  closeProject(): void;
  setMeta(patch: Partial<ProjectMeta>): void;
  markSaved(at: number, savedState?: TimelineState, savedMeta?: ProjectMeta | null): void;
  setSaving(v: boolean): void;
  toProject(): Project | null;

  /* history */
  beginGesture(): void;
  update(fn: (draft: TimelineState) => void): void;
  /** Clones only `clipIds`; for per-pointermove edits. */
  updateClips(clipIds: string[], fn: (clips: Record<string, Clip>, draft: TimelineState) => void): void;
  /**
   * Remove tracks left with no clips (keeping Main and the first audio track).
   * Mutates without pushing history, so call it inside a gesture or commit.
   */
  pruneTracks(): void;
  endGesture(label: string): void;
  cancelGesture(): void;
  commit(label: string, fn: (draft: TimelineState) => void): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /* assets */
  addAssets(assets: MediaAsset[]): void;
  removeAsset(assetId: string): void;

  /* tracks */
  addTrack(kind: TrackKind, atIndex?: number): string;
  removeTrack(trackId: string): void;
  patchTrack(trackId: string, patch: Partial<Track>): void;
  /** Step a track up (-1) or down (+1) within its band. */
  moveTrack(trackId: string, delta: number): void;
  /** Create an overlay track above everything and return its id. */
  addOverlayTrack(kind: TrackKind): string;

  /* clips */
  addClipFromAsset(assetId: string, trackId: string | null, atFrame: Frames): string | null;
  addTextClip(atFrame: Frames, content?: string): string | null;
  patchClip(clipId: string, patch: Partial<Clip>): void;
  setClipProperty(clipId: string, path: string, value: number, atFrame?: Frames): void;
  moveClips(moves: { clipId: string; start: Frames; trackId?: string }[]): void;
  trimClip(clipId: string, edge: 'left' | 'right', toFrame: Frames): void;
  splitClips(clipIds: string[], atFrame: Frames): string[];
  deleteClips(clipIds: string[], ripple?: boolean): void;
  duplicateClips(clipIds: string[]): string[];
  detachAudio(clipId: string): string | null;

  /* library application */
  addEffect(clipId: string, effectId: string): void;
  applyFilter(clipId: string, filterId: string): void;
  applyTransition(leftClipId: string, rightClipId: string, transitionId: string): void;
  removeTransition(clipId: string): void;

  /* keyframes */
  toggleKeyframe(clipId: string, path: string, frame: Frames): void;
  toggleCategoryKeyframe(clipId: string, paths: string[], frame: Frames, label: string): void;
  setKeyframeEasing(clipId: string, frame: Frames, easing: Keyframe['easing'], bezier?: [number, number, number, number], path?: string): void;
  moveKeyframes(moves: { clipId: string; path: string; keyframeId: string; frame: Frames }[]): void;
  deleteKeyframesAt(clipId: string, frame: Frames): void;

  /* markers / loop / playhead */
  addMarker(frame: Frames, label?: string): void;
  removeMarker(markerId: string): void;
  setLoop(inFrame: Frames, outFrame: Frames, enabled: boolean): void;
  setPlayhead(frame: Frames): void;

  /* derived */
  durationFrames(): Frames;
  clipsOnTrack(trackId: string): Clip[];
  clipAt(trackId: string, frame: Frames): Clip | null;
}

const clone = <T,>(v: T): T => structuredClone(v);

/** Longest clip end across every track — what the ruler and export length use. */
function computeDuration(state: TimelineState): Frames {
  let max = 0;
  for (const c of Object.values(state.clips)) max = Math.max(max, c.start + c.duration);
  return max;
}

/** Maximum timeline frames still available in the source from the current in-point. */
function maxTimelineLength(clip: Clip, state: TimelineState): Frames {
  if (!clip.assetId) return Number.MAX_SAFE_INTEGER;
  const asset = state.assets[clip.assetId];
  if (!asset || asset.kind === 'image') return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.floor((asset.durationFrames - clip.inPoint) / clip.speed));
}

const overlaps = (a: Clip, start: Frames, end: Frames) => a.start < end && start < a.start + a.duration;

/** Revoke a blob: URL (no-op for toptrim://data:/http URLs). */
const revokeBlobUrl = (url?: string) => {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
};

/** Free every blob URL a project's assets hold — called when it's replaced/closed. */
const revokeProjectBlobs = (state: TimelineState) => {
  const seen = new Set<string>();
  for (const a of Object.values(state.assets)) {
    if (a.url && !seen.has(a.url)) {
      seen.add(a.url);
      revokeBlobUrl(a.url);
    }
  }
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  meta: null,
  state: createTimelineState(),
  past: [],
  future: [],
  gestureSnapshot: null,
  gestureDepth: 0,
  dirty: false,
  saving: false,
  lastSavedAt: null,

  /* ---------------- lifecycle ---------------- */

  loadProject(p) {
    // The outgoing project's blob URLs (if any) are now orphaned — free them
    // before the state is replaced, or they leak for the process lifetime.
    revokeProjectBlobs(get().state);
    const { state, ...meta } = p;
    // Back-fill any fields a newer version added, so an older/partial project
    // opens instead of throwing mid-render.
    const loaded = normalizeTimelineState(state);
    // Projects saved before the band rules existed get their main track
    // inferred and their stack normalised on open.
    loaded.tracks = sortTracks(loaded.tracks);
    set({
      meta,
      state: loaded,
      past: [],
      future: [],
      gestureSnapshot: null,
      gestureDepth: 0,
      dirty: false,
      lastSavedAt: p.updatedAt,
    });
  },

  newProject(name, width, height, fps) {
    const p = createProject(name, width, height, fps);
    get().loadProject(p);
    return p;
  },

  closeProject() {
    revokeProjectBlobs(get().state);
    set({ meta: null, state: createTimelineState(), past: [], future: [], dirty: false });
  },

  setMeta(patch) {
    const meta = get().meta;
    if (!meta) return;
    set({ meta: { ...meta, ...patch, updatedAt: Date.now() }, dirty: true });
  },

  markSaved(at, savedState, savedMeta) {
    // Clear `dirty` only if nothing changed while the async write was in flight.
    // Mutations replace `state`/`meta` with new objects, so an unchanged
    // reference means the save captured the latest edit. If an edit slipped in
    // during the write, leave `dirty` true so the next autosave persists it —
    // otherwise that edit is silently considered saved but never written.
    const cur = get();
    const stale =
      (savedState !== undefined && cur.state !== savedState) ||
      (savedMeta !== undefined && cur.meta !== savedMeta);
    set({ dirty: stale ? cur.dirty : false, saving: false, lastSavedAt: at });
  },
  setSaving(v) {
    set({ saving: v });
  },

  toProject() {
    const { meta, state } = get();
    if (!meta) return null;
    return { ...meta, durationFrames: computeDuration(state), state };
  },

  /* ---------------- history ---------------- */

  beginGesture() {
    const { gestureDepth, state } = get();
    // Nested gestures share the outermost snapshot so they land as one undo step.
    if (gestureDepth === 0) set({ gestureSnapshot: clone(state), gestureDepth: 1 });
    else set({ gestureDepth: gestureDepth + 1 });
  },

  /**
   * General-purpose mutation. Deep-clones the whole state, so it is correct for
   * anything but too heavy for a 60fps gesture — use `updateClips` there.
   */
  update(fn) {
    const draft = clone(get().state);
    fn(draft);
    set({ state: draft, dirty: true });
  },

  /**
   * Hot-path mutation for drags.
   *
   * Deep-cloning the entire project on every pointermove is what made dragging
   * a clip in a large timeline feel like wading — the cost scaled with the
   * whole project, not with what you were touching. This clones only the clips
   * being edited and shallow-copies the containers above them, which is enough
   * for React to see new references and for undo to stay correct (the gesture
   * snapshot was already taken at `beginGesture`).
   */
  updateClips(clipIds, fn) {
    const state = get().state;
    const clips: Record<string, Clip> = { ...state.clips };
    for (const id of clipIds) {
      const existing = clips[id];
      if (existing) clips[id] = clone(existing);
    }
    const next: TimelineState = { ...state, clips };
    fn(clips, next);
    set({ state: next, dirty: true });
  },

  pruneTracks() {
    const state = get().state;
    const next = pruneEmptyTracks(state.tracks, Object.values(state.clips));
    if (next === state.tracks) return; // nothing emptied out
    set({ state: { ...state, tracks: next }, dirty: true });
  },

  endGesture(label) {
    const { gestureDepth, gestureSnapshot, past } = get();
    if (gestureDepth > 1) {
      set({ gestureDepth: gestureDepth - 1 });
      return;
    }
    if (!gestureSnapshot) {
      set({ gestureDepth: 0 });
      return;
    }
    const nextPast = [...past, { label, state: gestureSnapshot }];
    if (nextPast.length > HISTORY_LIMIT) nextPast.shift();
    set({ past: nextPast, future: [], gestureSnapshot: null, gestureDepth: 0, dirty: true });
  },

  cancelGesture() {
    const { gestureSnapshot } = get();
    if (gestureSnapshot) set({ state: gestureSnapshot });
    set({ gestureSnapshot: null, gestureDepth: 0 });
  },

  commit(label, fn) {
    get().beginGesture();
    get().update(fn);
    get().endGesture(label);
  },

  undo() {
    const { past, future, state } = get();
    if (past.length === 0) return;
    const entry = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, state: clone(state) }],
      state: entry.state,
      dirty: true,
    });
  },

  redo() {
    const { past, future, state } = get();
    if (future.length === 0) return;
    const entry = future[future.length - 1];
    set({
      future: future.slice(0, -1),
      past: [...past, { label: entry.label, state: clone(state) }],
      state: entry.state,
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  /* ---------------- assets ---------------- */

  addAssets(assets) {
    if (assets.length === 0) return;
    get().commit(assets.length > 1 ? `Import ${assets.length} files` : 'Import media', (d) => {
      for (const a of assets) d.assets[a.id] = a;
    });
  },

  removeAsset(assetId) {
    // Free the blob URL if this asset owns one (AI/generated/web-import assets
    // do; on Electron ordinary media uses toptrim:// and has nothing to revoke).
    // Only revoke a hash not shared with another surviving asset.
    const gone = get().state.assets[assetId];
    get().commit('Remove media', (d) => {
      delete d.assets[assetId];
      for (const c of Object.values(d.clips)) {
        if (c.assetId === assetId) delete d.clips[c.id];
      }
    });
    if (gone) {
      const stillUsed = Object.values(get().state.assets).some((a) => a.url === gone.url);
      if (!stillUsed) revokeBlobUrl(gone.url);
    }
  },

  /* ---------------- tracks ---------------- */

  /**
   * `atIndex` is ignored: placement follows the band rules (overlays on top,
   * main anchored, audio at the bottom) rather than an arbitrary position.
   */
  addTrack(kind, atIndex) {
    void atIndex;
    const trackId = newId();
    get().commit('Add track', (d) => {
      const track: Track = { ...createTrack(kind, nextTrackName(d.tracks, kind)), id: trackId };
      if (kind === 'video' && !d.tracks.some((t) => t.isMain)) track.isMain = true;
      d.tracks = insertTrack(d.tracks, track);
    });
    return trackId;
  },

  removeTrack(trackId) {
    get().commit('Delete track', (d) => {
      d.tracks = sortTracks(d.tracks.filter((t) => t.id !== trackId));
      for (const c of Object.values(d.clips)) if (c.trackId === trackId) delete d.clips[c.id];
    });
  },

  patchTrack(trackId, patch) {
    get().commit('Update track', (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) Object.assign(t, patch);
    });
  },

  /**
   * Explicitly create a track above the whole stack — what dragging a clip
   * past the top of the timeline does.
   */
  addOverlayTrack(kind) {
    const trackId = newId();
    get().commit('Add track', (d) => {
      const track: Track = { ...createTrack(kind, nextTrackName(d.tracks, kind)), id: trackId };
      d.tracks = insertTrack(d.tracks, track);
    });
    return trackId;
  },

  /** `delta` is a step within the track's own band; bands never interleave. */
  moveTrack(trackId, delta) {
    get().commit('Reorder tracks', (d) => {
      d.tracks = moveTrackWithinBand(d.tracks, trackId, delta);
    });
  },

  /* ---------------- clips ---------------- */

  addClipFromAsset(assetId, trackId, atFrame) {
    const state = get().state;
    const asset = state.assets[assetId];
    if (!asset) return null;

    const wantKind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
    let target = trackId ? state.tracks.find((t) => t.id === trackId && !t.locked) : undefined;
    if (!target || (wantKind === 'audio') !== (target.kind === 'audio')) {
      target = state.tracks.find((t) => t.kind === wantKind && !t.locked);
    }

    const clipId = newId();
    get().commit(`Add ${asset.name}`, (d) => {
      let tid = target?.id;
      if (!tid) {
        const t = createTrack(wantKind, nextTrackName(d.tracks, wantKind));
        if (wantKind === 'video' && !d.tracks.some((x) => x.isMain)) t.isMain = true;
        d.tracks = insertTrack(d.tracks, t);
        tid = t.id;
      }
      const base = clipFromAsset(asset, tid, Math.max(0, Math.round(atFrame)));
      // Never drop a clip on top of another — slide right to the first gap.
      const onTrack = Object.values(d.clips).filter((c) => c.trackId === tid).sort((a, b) => a.start - b.start);
      let start = base.start;
      for (const c of onTrack) {
        if (overlaps(c, start, start + base.duration)) start = c.start + c.duration;
      }
      d.clips[clipId] = { ...base, id: clipId, start };
    });
    return clipId;
  },

  addTextClip(atFrame, content) {
    const clipId = newId();
    get().commit('Add text', (d) => {
      let track = d.tracks.find((t) => t.kind === 'text' && !t.locked);
      if (!track) {
        track = createTrack('text', nextTrackName(d.tracks, 'text'));
        d.tracks = insertTrack(d.tracks, track);
      }
      const c = createClip({
        trackId: track.id,
        kind: 'text',
        name: content?.slice(0, 24) || 'Text',
        start: Math.max(0, Math.round(atFrame)),
        duration: 90,
        text: defaultTextProps(content),
      });
      d.clips[clipId] = { ...c, id: clipId };
    });
    return clipId;
  },

  patchClip(clipId, patch) {
    get().commit('Edit clip', (d) => {
      const c = d.clips[clipId];
      if (c) Object.assign(c, patch);
    });
  },

  /**
   * Writes a numeric property by path. When the property already has keyframes,
   * or `atFrame` is supplied and a keyframe exists there, the write lands on the
   * keyframe instead of the static value — matching how mainstream editors behave once a
   * property is animated.
   */
  setClipProperty(clipId, path, value, atFrame) {
    get().updateClips([clipId], (clips) => {
      const c = clips[clipId];
      if (!c) return;
      const animated = !!c.keyframes[path]?.length;
      if (animated && atFrame !== undefined) {
        upsertKeyframe(c.keyframes, path, atFrame, value, newId());
      } else {
        setPath(c, path, value);
      }
    });
  },

  moveClips(moves) {
    get().updateClips(
      moves.map((m) => m.clipId),
      (clips, d) => {
        for (const m of moves) {
          const c = clips[m.clipId];
          if (!c) continue;
          c.start = Math.max(0, Math.round(m.start));
          if (m.trackId && d.tracks.some((t) => t.id === m.trackId && !t.locked)) c.trackId = m.trackId;
        }
      }
    );
  },

  trimClip(clipId, edge, toFrame) {
    get().updateClips([clipId], (clips, d) => {
      const c = clips[clipId];
      if (!c) return;
      const frame = Math.round(toFrame);
      if (edge === 'left') {
        const maxStart = c.start + c.duration - 1;
        const minStart = Math.max(0, c.start - Math.floor(c.inPoint / c.speed));
        const next = Math.max(minStart, Math.min(frame, maxStart));
        const delta = next - c.start;
        c.start = next;
        c.duration -= delta;
        c.inPoint = Math.max(0, c.inPoint + Math.round(delta * c.speed));
      } else {
        const limit = maxTimelineLength(c, d);
        c.duration = Math.max(1, Math.min(frame - c.start, limit));
      }
    });
  },

  splitClips(clipIds, atFrame) {
    const created: string[] = [];
    const frame = Math.round(atFrame);
    get().commit('Split', (d) => {
      for (const cid of clipIds) {
        const c = d.clips[cid];
        if (!c) continue;
        if (frame <= c.start || frame >= c.start + c.duration) continue;

        const offset = frame - c.start;
        const rightId = newId();
        const right: Clip = {
          ...structuredClone(c),
          id: rightId,
          start: frame,
          duration: c.duration - offset,
          inPoint: c.inPoint + Math.round(offset * c.speed),
          transitionIn: null,
        };
        // Keyframes follow the half of the clip they were authored on.
        for (const [path, list] of Object.entries(right.keyframes)) {
          const kept = list.filter((k) => k.frame >= frame);
          if (kept.length) right.keyframes[path] = kept;
          else delete right.keyframes[path];
        }
        for (const [path, list] of Object.entries(c.keyframes)) {
          const kept = list.filter((k) => k.frame < frame);
          if (kept.length) c.keyframes[path] = kept;
          else delete c.keyframes[path];
        }

        c.duration = offset;
        c.transitionOut = null;
        d.clips[rightId] = right;
        created.push(rightId);
      }
    });
    return created;
  },

  deleteClips(clipIds, ripple = false) {
    if (clipIds.length === 0) return;
    get().commit(ripple ? 'Ripple delete' : 'Delete', (d) => {
      // Ripple closes the gap on each affected track, longest gap first so the
      // shifts do not interfere with each other.
      const removed = clipIds.map((cid) => d.clips[cid]).filter(Boolean) as Clip[];
      for (const c of removed) {
        delete d.clips[c.id];
        // Detached audio is linked to its source video. Deleting the VIDEO takes
        // its audio with it (the expected direction). Deleting the AUDIO must
        // NOT delete the video the user is still editing — just unlink it.
        if (c.linkedClipId) {
          const partner = d.clips[c.linkedClipId];
          if (!partner) continue;
          if (c.kind === 'audio' && partner.kind !== 'audio') {
            partner.linkedClipId = undefined;
          } else {
            delete d.clips[c.linkedClipId];
          }
        }
      }

      // A transition is stored on the outgoing clip but belongs to the SEAM. If
      // the clip on the far side is gone, the transition has no successor to
      // blend into — drop it, or it lingers as a stale timeline badge and
      // silently reactivates against whatever clip lands at that seam next.
      const dropDanglingTransitions = () => {
        const JOIN = 2;
        for (const c of Object.values(d.clips)) {
          if (!c.transitionOut) continue;
          const seam = c.start + c.duration;
          const hasSuccessor = Object.values(d.clips).some(
            (o) => o.id !== c.id && o.trackId === c.trackId && Math.abs(o.start - seam) <= JOIN
          );
          if (!hasSuccessor) c.transitionOut = null;
        }
      };

      if (!ripple) {
        dropDanglingTransitions();
        return;
      }

      const byTrack = new Map<string, Clip[]>();
      for (const c of removed) {
        if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
        byTrack.get(c.trackId)!.push(c);
      }
      for (const [trackId, gone] of byTrack) {
        gone.sort((a, b) => b.start - a.start);
        for (const g of gone) {
          for (const c of Object.values(d.clips)) {
            if (c.trackId === trackId && c.start >= g.start) c.start = Math.max(0, c.start - g.duration);
          }
        }
      }
      // After ripple shifts, re-evaluate seams against final positions.
      dropDanglingTransitions();
    });
    // Deleting the last clip on a track retires the track with it, in the same
    // undo step.
    get().pruneTracks();
  },

  duplicateClips(clipIds) {
    const created: string[] = [];
    get().commit('Duplicate', (d) => {
      for (const cid of clipIds) {
        const c = d.clips[cid];
        if (!c) continue;
        const copyId = newId();
        d.clips[copyId] = { ...structuredClone(c), id: copyId, start: c.start + c.duration, linkedClipId: undefined };
        created.push(copyId);
      }
    });
    return created;
  },

  detachAudio(clipId) {
    const state = get().state;
    const src = state.clips[clipId];
    if (!src || src.kind !== 'video' || !src.assetId) return null;
    const audioId = newId();
    get().commit('Detach audio', (d) => {
      let track = d.tracks.find((t) => t.kind === 'audio' && !t.locked);
      if (!track) {
        track = createTrack('audio', nextTrackName(d.tracks, 'audio'));
        d.tracks = insertTrack(d.tracks, track);
      }
      const c = d.clips[clipId];
      d.clips[audioId] = {
        ...structuredClone(c),
        id: audioId,
        kind: 'audio',
        trackId: track.id,
        name: `${c.name} (audio)`,
        effects: [],
        transitionIn: null,
        transitionOut: null,
        keyframes: {},
        linkedClipId: clipId,
      };
      c.audio = { ...c.audio, muted: true };
      c.linkedClipId = audioId;
    });
    return audioId;
  },

  /* ---------------- library application ---------------- */

  addEffect(clipId, effectId) {
    const def = effectById(effectId);
    if (!def) return;
    get().commit(`Add ${def.name}`, (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      // Dropping the same effect again replaces it rather than stacking two
      // copies that fight over the same parameters.
      const existing = c.effects.findIndex((e) => e.effectId === effectId);
      const instance = { id: newId(), effectId, enabled: true, params: defaultEffectParams(def) };
      if (existing >= 0) c.effects[existing] = instance;
      else c.effects.push(instance);
    });
  },

  applyFilter(clipId, filterId) {
    const def = filterById(filterId);
    if (!def) return;
    get().commit(`Apply ${def.name}`, (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      // Filters are a grade preset: reset to neutral first so switching between
      // them never compounds.
      c.color = { ...defaultColorGrade(), ...def.grade, lut: c.color.lut };
    });
  },

  /**
   * Put a transition on the seam between two clips.
   *
   * It is stored on the LEFT clip's `transitionOut` — a junction has exactly
   * one transition, and anchoring it to the outgoing clip means trimming or
   * deleting that clip takes the transition with it.
   */
  applyTransition(leftClipId, rightClipId, transitionId) {
    const def = transitionById(transitionId);
    if (!def) return;
    get().commit(`Add ${def.name}`, (d) => {
      const left = d.clips[leftClipId];
      const right = d.clips[rightClipId];
      if (!left || !right) return;
      // Never longer than half the shorter neighbour, or it would run past the
      // footage it is supposed to blend.
      const max = Math.max(2, Math.floor(Math.min(left.duration, right.duration) / 2));
      left.transitionOut = {
        id: newId(),
        transitionId,
        durationFrames: Math.min(def.defaultFrames, max),
        params: {},
      };
      right.transitionIn = null; // the seam owns one transition, not two
    });
  },

  removeTransition(clipId) {
    get().commit('Remove transition', (d) => {
      const c = d.clips[clipId];
      if (c) c.transitionOut = null;
    });
  },

  /* ---------------- keyframes ---------------- */

  toggleKeyframe(clipId, path, frame) {
    get().commit('Keyframe', (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const list = c.keyframes[path];
      if (list?.some((k) => k.frame === frame)) {
        removeKeyframeAt(c.keyframes, path, frame);
        return;
      }
      const current = getPath(c, path);
      if (current === undefined) return;
      // First keyframe on a property also pins the value it had before animating.
      upsertKeyframe(c.keyframes, path, frame, current, newId());
    });
  },

  /**
   * One diamond for a whole group (Position & size, Colour, Audio…).
   *
   * It records only the properties that are actually in play — already animated
   * or moved off their default — so pressing it on a clip where you have only
   * touched Scale does not litter the timeline with five redundant tracks.
   * When nothing in the group has been touched yet it records the group as it
   * stands, which is how you pin a starting pose before animating away from it.
   */
  toggleCategoryKeyframe(clipId, paths, frame, label) {
    if (paths.length === 0) return;
    get().commit(label, (d) => {
      const c = d.clips[clipId];
      if (!c) return;

      const allPresent = paths.every((p) => c.keyframes[p]?.some((k) => k.frame === frame));
      if (allPresent) {
        for (const path of paths) removeKeyframeAt(c.keyframes, path, frame);
        return;
      }
      for (const path of paths) {
        const value = getPath(c, path);
        if (value === undefined) continue;
        upsertKeyframe(c.keyframes, path, frame, value, newId());
      }
    });
  },

  /** Retime the curve leaving a keyframe. `path` omitted means every property at that frame. */
  setKeyframeEasing(clipId, frame, easing, bezier, path) {
    get().commit('Keyframe easing', (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      const paths = path ? [path] : Object.keys(c.keyframes);
      for (const p of paths) {
        for (const kf of c.keyframes[p] ?? []) {
          if (kf.frame !== frame) continue;
          kf.easing = easing;
          if (easing === 'bezier') kf.bezier = bezier ?? [0.25, 0.1, 0.25, 1];
          else delete kf.bezier;
        }
      }
    });
  },

  moveKeyframes(moves) {
    get().updateClips(
      moves.map((m) => m.clipId),
      (clips) => {
      for (const m of moves) {
        const c = clips[m.clipId];
        const list = c?.keyframes[m.path];
        if (!list) continue;
        const kf = list.find((k: Keyframe) => k.id === m.keyframeId);
        if (!kf) continue;
        kf.frame = Math.max(c.start, Math.min(Math.round(m.frame), c.start + c.duration));
        list.sort((a: Keyframe, b: Keyframe) => a.frame - b.frame);
      }
      }
    );
  },

  deleteKeyframesAt(clipId, frame) {
    get().commit('Delete keyframe', (d) => {
      const c = d.clips[clipId];
      if (!c) return;
      for (const path of Object.keys(c.keyframes)) removeKeyframeAt(c.keyframes, path, frame);
    });
  },

  /* ---------------- markers / loop / playhead ---------------- */

  addMarker(frame, label = '') {
    get().commit('Add marker', (d) => {
      const m: Marker = { id: newId(), frame: Math.round(frame), label, color: '#00E676' };
      d.markers.push(m);
      d.markers.sort((a, b) => a.frame - b.frame);
    });
  },

  removeMarker(markerId) {
    get().commit('Delete marker', (d) => {
      d.markers = d.markers.filter((m) => m.id !== markerId);
    });
  },

  setLoop(inFrame, outFrame, enabled) {
    get().update((d) => {
      d.loop = { inFrame: Math.round(inFrame), outFrame: Math.round(outFrame), enabled };
    });
  },

  /**
   * Playhead is stored so it survives save/reload, but it is NOT the playback
   * clock — PlaybackEngine drives a CSS variable during playback and only
   * writes back here when it stops.
   */
  setPlayhead(frame) {
    const f = Math.max(0, Math.round(frame));
    if (get().state.playhead === f) return;
    set((s) => ({ state: { ...s.state, playhead: f } }));
  },

  /* ---------------- derived ---------------- */

  durationFrames: () => computeDuration(get().state),

  clipsOnTrack: (trackId) =>
    Object.values(get().state.clips)
      .filter((c) => c.trackId === trackId)
      .sort((a, b) => a.start - b.start),

  clipAt(trackId, frame) {
    for (const c of Object.values(get().state.clips)) {
      if (c.trackId === trackId && frame >= c.start && frame < c.start + c.duration) return c;
    }
    return null;
  },
}));

export { computeDuration, TRACK_HEIGHT };
export type { ClipKind };
