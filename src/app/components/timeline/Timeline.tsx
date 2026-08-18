import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore, ZOOM_MAX, ZOOM_MIN } from '../../stores/uiStore';
import { useContextMenu } from '../common/ContextMenu';
import { TrackLabels } from './TrackLabels';
import { TimelineScrollbar } from './TimelineScrollbar';
import { playback } from '../../../engine/playback';
import {
  RULER_H,
  frameToX,
  hitTest,
  render,
  trackLayout,
  xToFrame,
  type DragPreview,
  type HitTarget,
} from '../../../engine/timelineRenderer';
import { resolveDrop, trackKindFor } from '../../../engine/timelineDrop';
import { findJunctions, junctionNear, type Junction } from '../../../engine/junctions';
import { DND_ASSET, DND_EFFECT, DND_FILTER, DND_TRANSITION } from '../../../engine/dragTypes';
import { collectSnapTargets, snapClipDrag, snapFrame, type SnapTarget } from '../../../engine/snapping';
import { EASING_PRESETS } from '../../../engine/keyframes';
import { kindFitsTrack } from '../../../engine/trackOrder';
import type { TrackKind } from '../../../types/project';
import { onStoryboardUpdate } from '../../../engine/storyboard';
import { onWaveformUpdate } from '../../../engine/waveform';
import { clamp } from '../../../engine/time';

type Gesture =
  | { kind: 'none' }
  | { kind: 'scrub' }
  | {
      kind: 'drag';
      clipIds: string[];
      startFrame: number;
      startX: number;
      startY: number;
      /** Pointer offset inside the grabbed clip, so the ghost sits under the cursor. */
      grabOffsetY: number;
      origins: Record<string, { start: number; trackId: string; laneTop: number }>;
      targets: SnapTarget[];
    }
  | { kind: 'trim'; clipId: string; edge: 'left' | 'right'; targets: SnapTarget[] }
  | { kind: 'keyframe'; clipId: string; frame: number }
  | { kind: 'fade'; clipId: string; side: 'in' | 'out'; startX: number; startValue: number }
  | { kind: 'marquee'; x0: number; y0: number };

export function Timeline() {
  const state = useEditorStore((s) => s.state);
  const meta = useEditorStore((s) => s.meta);
  const editor = useEditorStore;
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const scrollX = useUIStore((s) => s.scrollX);
  const setScrollX = useUIStore((s) => s.setScrollX);
  const scrollY = useUIStore((s) => s.scrollY);
  const setScrollY = useUIStore((s) => s.setScrollY);
  const selection = useUIStore((s) => s.selection);
  const select = useUIStore((s) => s.select);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const snapEnabled = useUIStore((s) => s.snapEnabled);
  const magnetEnabled = useUIStore((s) => s.magnetEnabled);
  const setDraggingKind = useUIStore((s) => s.setDraggingKind);
  const contextMenu = useContextMenu();

  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ clipId: string | null; edge: 'left' | 'right' | null; cursor: string }>({
    clipId: null,
    edge: null,
    cursor: 'default',
  });
  const [snapAt, setSnapAt] = useState<number | null>(null);
  /** True while a drag is far enough past the band edge to create a track. */
  const [spawnHint, setSpawnHint] = useState(false);
  /** Live drop feedback while a clip is in the air. */
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  /** Space opened above the stack for an incoming new track. */
  const [reservedTop, setReservedTop] = useState(0);
  /** What a library drag from the asset panel is hovering over. */
  const [libraryTarget, setLibraryTarget] = useState<LibraryDropTarget>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const fps = meta?.fps ?? 30;
  // Magnet drives clip-to-clip adsorption; snap drives playhead/marker guides.
  const snapSources = useMemo(
    () => ({ clipEdges: magnetEnabled, guides: snapEnabled }),
    [magnetEnabled, snapEnabled]
  );
  const anySnap = magnetEnabled || snapEnabled;
  const layout = useMemo(() => trackLayout(state.tracks, reservedTop), [state.tracks, reservedTop]);
  /** Ids currently airborne, dimmed in place while the ghost leads. */
  const draggingIdSet = useMemo(
    () => new Set(dragPreview ? (gesture.current.kind === 'drag' ? gesture.current.clipIds : []) : []),
    [dragPreview]
  );
  const durationFrames = useMemo(() => {
    let max = 0;
    for (const c of Object.values(state.clips)) max = Math.max(max, c.start + c.duration);
    return max;
  }, [state.clips]);

  /** Content width, with a screen of headroom so you can always drag past the end. */
  const contentWidth = Math.max(durationFrames * zoom + size.w * 0.6, size.w);
  const maxScrollX = Math.max(0, contentWidth - size.w);

  /** Track stack height, plus room for the "+ Track" row at the bottom. */
  const contentHeight = layout.total + ADD_TRACK_ROW_H;
  const maxScrollY = Math.max(0, contentHeight - size.h);

  // Shrinking the stack (deleting a track, zooming) can strand the view past
  // the end; pull it back rather than leaving a blank gap.
  useEffect(() => {
    if (scrollY > maxScrollY) setScrollY(maxScrollY);
  }, [scrollY, maxScrollY, setScrollY]);

  /* ---------------- sizing ---------------- */

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- playhead geometry ---------------- */

  useEffect(() => {
    playback.attachPlayheadHost(surfaceRef.current);
  }, []);

  useEffect(() => {
    playback.setGeometry(zoom, scrollX, 0);
  }, [zoom, scrollX]);

  /* ---------------- drawing ---------------- */

  const needsRedraw = useRef(true);
  /** Latched from the last render pass: true while shimmer tiles are on screen. */
  const shimmering = useRef(false);
  const requestRedraw = useCallback(() => {
    needsRedraw.current = true;
  }, []);

  useEffect(() => requestRedraw(), [state, zoom, scrollX, scrollY, selection, size, hover, snapAt, marquee, requestRedraw]);
  useEffect(() => onStoryboardUpdate(requestRedraw), [requestRedraw]);
  useEffect(() => onWaveformUpdate(requestRedraw), [requestRedraw]);

  useEffect(() => {
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const tick = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx && size.w > 0 && size.h > 0) {
        const w = Math.round(size.w);
        const h = Math.round(size.h);
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
          needsRedraw.current = true;
        }

        // Shimmering tiles animate, so keep painting while any are on screen.
        if (needsRedraw.current || shimmering.current) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const result = render({
            ctx,
            width: w,
            height: h,
            dpr,
            state,
            assets: state.assets,
            fps,
            zoom,
            scrollX,
            scrollY,
            selection,
            playhead: playback.currentFrame,
            hoverClipId: hover.clipId,
            hoverEdge: hover.edge,
            snapFrame: snapAt,
            marquee,
            dragging: gesture.current.kind === 'drag',
            dragPreview,
            draggingIds: draggingIdSet,
            reservedTop,
            libraryDrop:
              libraryTarget === null
                ? null
                : libraryTarget.kind === 'clip'
                  ? { kind: 'clip', clipId: libraryTarget.clipId }
                  : {
                      kind: 'junction',
                      trackId: libraryTarget.junction.trackId,
                      frame: libraryTarget.junction.frame,
                      leftClipId: libraryTarget.junction.leftClipId,
                      rightClipId: libraryTarget.junction.rightClipId,
                    },
          });
          shimmering.current = result.pendingThumbnails;
          needsRedraw.current = false;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, zoom, scrollX, scrollY, selection, size, hover, snapAt, marquee, fps, dragPreview, reservedTop, draggingIdSet, libraryTarget]);

  /* ---------------- follow the playhead during playback ---------------- */

  useEffect(() => {
    let raf = 0;
    const follow = () => {
      if (playback.isPlaying) {
        const x = playback.currentFrame * zoom - useUIStore.getState().scrollX;
        const margin = size.w * 0.12;
        if (x > size.w - margin) setScrollX(playback.currentFrame * zoom - size.w + margin);
        else if (x < 0) setScrollX(Math.max(0, playback.currentFrame * zoom - margin));
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [zoom, size.w, setScrollX]);

  /* ---------------- fit ---------------- */

  const fit = useCallback(() => {
    if (durationFrames <= 0 || size.w <= 0) return;
    setZoom(clamp((size.w - 32) / durationFrames, ZOOM_MIN, ZOOM_MAX));
    setScrollX(0);
  }, [durationFrames, size.w, setZoom, setScrollX]);

  useEffect(() => {
    const handler = () => fit();
    window.addEventListener('toptrim:fit-timeline', handler);
    return () => window.removeEventListener('toptrim:fit-timeline', handler);
  }, [fit]);

  /* ---------------- pointer helpers ---------------- */

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** `y` is viewport-relative; lanes live in scrolled content space. */
  const trackAtY = (y: number): string | null => {
    const contentY = y + scrollY;
    const index = layout.tops.findIndex((top, i) => contentY >= top && contentY < top + layout.heights[i]);
    return index >= 0 ? state.tracks[index].id : null;
  };

  /**
   * Index of the track a dragged clip should land on.
   *
   * Nearest lane centre among the tracks that can actually hold this clip —
   * not a strict hit test. Requiring the pointer to be inside a lane made
   * vertical dragging feel sticky: crossing over an audio band or drifting into
   * the gap below the last track froze the clip on its original row. Nearest
   * means it always follows you somewhere sensible.
   */
  const nearestTrackIndex = (pointerY: number, clipKind: string): number => {
    const contentY = pointerY + scrollY;
    let best = -1;
    let bestDist = Infinity;
    state.tracks.forEach((track, i) => {
      if (!kindFits(clipKind, track.kind)) return;
      const centre = layout.tops[i] + layout.heights[i] / 2;
      const dist = Math.abs(centre - contentY);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  };

  /** Nearest compatible track at or around `index`, searching outward. */
  const compatibleNear = (index: number, clipKind: string): string | null => {
    for (let radius = 0; radius < state.tracks.length; radius++) {
      for (const i of [index - radius, index + radius]) {
        const track = state.tracks[i];
        if (track && kindFits(clipKind, track.kind)) return track.id;
      }
    }
    return null;
  };

  /* ---------------- interactions ---------------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // right-click handled by the context menu
    const { x, y } = localPoint(e);
    const hit = hitTest(x, y, state, zoom, scrollX, scrollY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    switch (hit.kind) {
      case 'ruler': {
        gesture.current = { kind: 'scrub' };
        setDraggingKind('scrub');
        playback.pause();
        playback.scrubTo(hit.frame);
        break;
      }
      case 'keyframe': {
        gesture.current = { kind: 'keyframe', clipId: hit.clipId, frame: hit.frame };
        useUIStore.getState().setSelectedKeyframe(null);
        editor.getState().beginGesture();
        setDraggingKind('trim');
        break;
      }
      case 'fade': {
        const clip = state.clips[hit.clipId];
        gesture.current = {
          kind: 'fade',
          clipId: hit.clipId,
          side: hit.side,
          startX: x,
          startValue: hit.side === 'in' ? clip.audio.fadeInFrames : clip.audio.fadeOutFrames,
        };
        editor.getState().beginGesture();
        setDraggingKind('trim');
        break;
      }
      case 'clip': {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const nextSelection = additive
          ? selection.includes(hit.clipId)
            ? selection.filter((s) => s !== hit.clipId)
            : [...selection, hit.clipId]
          : selection.includes(hit.clipId)
            ? selection
            : [hit.clipId];
        select(nextSelection);

        if (hit.edge) {
          gesture.current = {
            kind: 'trim',
            clipId: hit.clipId,
            edge: hit.edge,
            targets: collectSnapTargets(state, playback.currentFrame, new Set([hit.clipId]), snapSources),
          };
          setDraggingKind('trim');
        } else {
          const origins: Record<string, { start: number; trackId: string; laneTop: number }> = {};
          for (const cid of nextSelection) {
            const c = state.clips[cid];
            if (!c) continue;
            const idx = state.tracks.findIndex((t) => t.id === c.trackId);
            origins[cid] = { start: c.start, trackId: c.trackId, laneTop: idx >= 0 ? layout.tops[idx] : 0 };
          }
          const primaryIdx = state.tracks.findIndex((t) => t.id === state.clips[hit.clipId]?.trackId);
          gesture.current = {
            kind: 'drag',
            clipIds: nextSelection,
            startFrame: hit.frame,
            startX: x,
            startY: y,
            // Keeps the ghost anchored where the clip was grabbed rather than
            // jumping so its top-left corner meets the cursor.
            grabOffsetY: primaryIdx >= 0 ? y - (layout.tops[primaryIdx] - scrollY) : 0,
            origins,
            targets: collectSnapTargets(state, playback.currentFrame, new Set(nextSelection), snapSources),
          };
          setDraggingKind('clip');
        }
        editor.getState().beginGesture();
        break;
      }
      default: {
        if (!e.shiftKey) clearSelection();
        gesture.current = { kind: 'marquee', x0: x, y0: y };
        setMarquee({ x0: x, y0: y, x1: x, y1: y });
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localPoint(e);
    const g = gesture.current;

    if (g.kind === 'none') {
      const hit = hitTest(x, y, state, zoom, scrollX, scrollY);
      setHover({
        clipId: hit.kind === 'clip' ? hit.clipId : null,
        edge: hit.kind === 'clip' ? hit.edge : null,
        cursor: cursorFor(hit),
      });
      useUIStore.getState().setHoverFrame(Math.round(xToFrame(x, zoom, scrollX)));
      return;
    }

    switch (g.kind) {
      case 'scrub':
        playback.scrubTo(Math.max(0, xToFrame(x, zoom, scrollX)));
        break;

      case 'drag': {
        /*
         * The clips are NOT moved during the drag. The ghost follows the
         * cursor freely in both axes and everything is decided on release, so
         * nothing snaps under your hand and the whole move is a single undo
         * step.
         */
        const rawDelta = (x - g.startX) / zoom;
        const clips = g.clipIds.map((cid) => state.clips[cid]).filter(Boolean);
        const snapped = snapClipDrag(
          clips.map((c) => ({ ...c, start: g.origins[c.id].start })),
          rawDelta,
          g.targets,
          zoom,
          anySnap
        );
        setSnapAt(snapped.atFrame);

        const primary = state.clips[g.clipIds[0]];
        if (!primary) break;

        // Where the pointer is pointing, and whether it is past the band.
        const beyond = wouldSpawnTrack(g.clipIds, y);
        const preferredIndex = nearestTrackIndex(y, primary.kind);

        const moving = clips.map((c) => ({
          id: c.id,
          kind: c.kind,
          start: Math.max(0, g.origins[c.id].start + snapped.delta),
          duration: c.duration,
        }));

        const resolution = beyond
          ? { trackId: null, needsNewTrack: true, pushedBy: 0 }
          : resolveDrop(state, moving, preferredIndex);

        const reserved = resolution.needsNewTrack && !isAudioKind(primary.kind) ? NEW_TRACK_H : 0;
        const withReserve = trackLayout(state.tracks, reserved);

        // Landing highlight for the primary clip.
        const landingIndex = resolution.trackId
          ? state.tracks.findIndex((t) => t.id === resolution.trackId)
          : -1;
        const dropY =
          landingIndex >= 0
            ? withReserve.tops[landingIndex]
            : isAudioKind(primary.kind)
              ? withReserve.total
              : RULER_H;
        const dropH = landingIndex >= 0 ? withReserve.heights[landingIndex] : NEW_TRACK_H;

        const primaryStart = Math.max(0, g.origins[primary.id].start + snapped.delta);

        setDragPreview({
          pushed: resolution.pushedBy > 0,
          dropRect: {
            x: frameToX(primaryStart, zoom, scrollX),
            y: dropY,
            w: primary.duration * zoom,
            h: dropH,
          },
          newTrackRect: resolution.needsNewTrack ? { y: dropY, h: dropH } : null,
          // Ghosts sit exactly under the cursor, in viewport space.
          ghosts: clips.map((c) => ({
            x: frameToX(g.origins[c.id].start, zoom, scrollX) + (x - g.startX),
            y: y - g.grabOffsetY + (g.origins[c.id].laneTop - g.origins[primary.id].laneTop),
            w: c.duration * zoom,
            h: c.kind === 'audio' ? 40 : 54,
            label: c.name,
          })),
        });
        setReservedTop(reserved);
        setSpawnHint(resolution.needsNewTrack);
        break;
      }

      case 'trim': {
        const raw = xToFrame(x, zoom, scrollX);
        const snapped = snapFrame(raw, g.targets, zoom, anySnap);
        setSnapAt(snapped.target ? snapped.frame : null);
        editor.getState().trimClip(g.clipId, g.edge, snapped.frame);
        break;
      }

      case 'keyframe': {
        const raw = Math.round(xToFrame(x, zoom, scrollX));
        editor.getState().updateClips([g.clipId], (clips) => {
          const clip = clips[g.clipId];
          if (!clip) return;
          const delta = raw - g.frame;
          if (delta === 0) return;
          for (const list of Object.values(clip.keyframes)) {
            for (const kf of list) {
              if (kf.frame === g.frame) kf.frame = clamp(kf.frame + delta, clip.start, clip.start + clip.duration);
            }
            list.sort((a, b) => a.frame - b.frame);
          }
        });
        gesture.current = { ...g, frame: raw };
        break;
      }

      case 'fade': {
        const deltaFrames = Math.round((x - g.startX) / zoom) * (g.side === 'in' ? 1 : -1);
        editor.getState().updateClips([g.clipId], (clips) => {
          const clip = clips[g.clipId];
          if (!clip) return;
          const value = clamp(g.startValue + deltaFrames, 0, Math.floor(clip.duration / 2));
          if (g.side === 'in') clip.audio.fadeInFrames = value;
          else clip.audio.fadeOutFrames = value;
        });
        break;
      }

      case 'marquee': {
        setMarquee({ x0: g.x0, y0: g.y0, x1: x, y1: y });
        break;
      }
    }
  };

  /**
   * Dragging a clip past the edge of its band spawns a track for it.
   *
   * This is the only way tracks come into being now, which is what makes it
   * predictable: drag beyond the rows that can hold this clip and you get a new
   * row. Non-audio grows upward (overlays composite over Main), audio grows
   * downward. Empty tracks are pruned separately, so the stack always matches
   * what is actually on the timeline.
   */
  const wouldSpawnTrack = (clipIds: string[], pointerY: number): boolean => {
    if (clipIds.length === 0) return false;
    const first = editor.getState().state.clips[clipIds[0]];
    if (!first) return false;

    const kind = trackKindForClip(first.kind);
    const lanes = state.tracks
      .map((t, i) => ({ track: t, top: layout.tops[i] - scrollY, bottom: layout.tops[i] + layout.heights[i] - scrollY }))
      .filter((l) => kindFits(first.kind, l.track.kind));
    if (lanes.length === 0) return false;

    // Audio lives at the bottom of the stack so it only grows downward;
    // everything else only grows upward. Dragging the other way would cross a
    // band boundary, which the ordering rules forbid.
    return kind === 'audio'
      ? pointerY > lanes[lanes.length - 1].bottom + SPAWN_MARGIN
      : pointerY < lanes[0].top - SPAWN_MARGIN;
  };

  /**
   * Land the selection.
   *
   * Nothing has moved until this runs, so this is the one place that decides
   * the final position: snap horizontally, resolve a non-overlapping track,
   * and create one if the band is full.
   */
  const commitDrop = (g: Extract<Gesture, { kind: 'drag' }>, x: number, y: number) => {
    const st = editor.getState();
    const clips = g.clipIds.map((cid) => st.state.clips[cid]).filter(Boolean);
    if (clips.length === 0) return;

    const rawDelta = (x - g.startX) / zoom;
    const snapped = snapClipDrag(
      clips.map((c) => ({ ...c, start: g.origins[c.id].start })),
      rawDelta,
      g.targets,
      zoom,
      anySnap
    );

    const primary = clips[0];
    const moving = clips.map((c) => ({
      id: c.id,
      kind: c.kind,
      start: Math.max(0, g.origins[c.id].start + snapped.delta),
      duration: c.duration,
    }));

    const beyond = wouldSpawnTrack(g.clipIds, y);
    const resolution = beyond
      ? { trackId: null, needsNewTrack: true, pushedBy: 0 }
      : resolveDrop(st.state, moving, nearestTrackIndex(y, primary.kind));

    let targetTrackId = resolution.trackId;
    if (resolution.needsNewTrack) {
      const kind = trackKindFor(primary.kind);
      targetTrackId = kind === 'audio' ? st.addTrack('audio') : st.addOverlayTrack(kind);
    }
    if (!targetTrackId) return;

    // Multi-clip selections keep their relative rows where they can; anything
    // that cannot follow lands on the resolved track.
    const primaryOriginIndex = st.state.tracks.findIndex((t) => t.id === g.origins[primary.id].trackId);
    const targetIndex = st.state.tracks.findIndex((t) => t.id === targetTrackId);
    const rowShift = targetIndex - primaryOriginIndex;

    st.moveClips(
      moving.map((m) => {
        const originIndex = st.state.tracks.findIndex((t) => t.id === g.origins[m.id].trackId);
        const destIndex = clamp(originIndex + rowShift, 0, st.state.tracks.length - 1);
        const destId = m.id === primary.id ? targetTrackId! : compatibleNear(destIndex, m.kind) ?? targetTrackId!;
        return { clipId: m.id, start: m.start, trackId: destId };
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const { x, y } = localPoint(e);

    switch (g.kind) {
      case 'scrub':
        playback.endScrub();
        editor.getState().setPlayhead(playback.currentFrame);
        break;
      case 'drag': {
        commitDrop(g, x, y);
        // Whatever the drag emptied out goes with it, inside the same undo step.
        editor.getState().pruneTracks();
        editor.getState().endGesture('Move clip');
        break;
      }
      case 'trim':
        editor.getState().endGesture('Trim clip');
        break;
      case 'keyframe':
        editor.getState().endGesture('Move keyframe');
        break;
      case 'fade':
        editor.getState().endGesture('Adjust fade');
        break;
      case 'marquee': {
        const x0 = Math.min(g.x0, x);
        const x1 = Math.max(g.x0, x);
        const y0 = Math.min(g.y0, y);
        const y1 = Math.max(g.y0, y);
        const inside: string[] = [];
        state.tracks.forEach((track, i) => {
          const top = layout.tops[i] - scrollY;
          const bottom = top + layout.heights[i];
          if (bottom < y0 || top > y1) return;
          for (const clip of Object.values(state.clips)) {
            if (clip.trackId !== track.id) continue;
            const cx = clip.start * zoom - scrollX;
            const cw = clip.duration * zoom;
            if (cx + cw >= x0 && cx <= x1) inside.push(clip.id);
          }
        });
        if (inside.length) select(inside, e.shiftKey);
        break;
      }
    }

    gesture.current = { kind: 'none' };
    setDraggingKind(null);
    setSnapAt(null);
    setSpawnHint(false);
    setDragPreview(null);
    setReservedTop(0);
    setMarquee(null);
  };

  /* ---------------- wheel ----------------
   *
   *   wheel        scroll the tracks vertically
   *   Ctrl+wheel   scroll along the timeline
   *   Alt+wheel    zoom about the cursor
   *
   * Zoom moved off Ctrl because Ctrl is horizontal scroll here. The zoom
   * slider and Ctrl+= / Ctrl+- still work, so zoom is never more than one
   * gesture away.
   */

  const onWheel = (e: React.WheelEvent) => {
    if (e.altKey) {
      const { x } = localPoint(e);
      const frameAtCursor = xToFrame(x, zoom, scrollX);
      const next = clamp(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), ZOOM_MIN, ZOOM_MAX);
      setZoom(next);
      // Keep the frame under the cursor pinned while zooming.
      setScrollX(Math.max(0, frameAtCursor * next - x));
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // A trackpad's horizontal axis still wins if the user is swiping sideways.
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setScrollX(clamp(scrollX + delta, 0, maxScrollX));
      return;
    }

    setScrollY(clamp(scrollY + e.deltaY, 0, maxScrollY));
  };

  /* ---------------- drops from the asset panel ---------------- */

  const junctions = useMemo(() => findJunctions(state), [state]);

  /** What the pointer is currently over, for the drop highlight. */
  const resolveLibraryTarget = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const { x, y } = localPoint(e);
    const frame = Math.max(0, xToFrame(x, zoom, scrollX));
    const trackId = trackAtY(y);

    if (types.includes(DND_TRANSITION)) {
      // Transitions land on a seam, so snap to the nearest one within reach.
      const tolerance = JUNCTION_GRAB_PX / Math.max(zoom, 1e-6);
      const junction = junctionNear(junctions, trackId, frame, tolerance);
      return junction ? ({ kind: 'junction', junction } as const) : null;
    }
    if (types.includes(DND_EFFECT) || types.includes(DND_FILTER)) {
      const hit = hitTest(x, y, state, zoom, scrollX, scrollY);
      return hit.kind === 'clip' ? ({ kind: 'clip', clipId: hit.clipId } as const) : null;
    }
    return null;
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const target = resolveLibraryTarget(e);
    e.dataTransfer.dropEffect = target ? 'copy' : 'none';
    setLibraryTarget(target);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const st = editor.getState();
    const { x, y } = localPoint(e);

    // Media: create a clip where it was dropped.
    const assetId = e.dataTransfer.getData(DND_ASSET);
    if (assetId) {
      setLibraryTarget(null);
      const trackId = trackAtY(y);
      const frame = Math.max(0, Math.round(xToFrame(x, zoom, scrollX)));
      const clipId = st.addClipFromAsset(assetId, trackId, frame);
      if (clipId) select([clipId]);
      return;
    }

    const target = resolveLibraryTarget(e);
    setLibraryTarget(null);
    if (!target) return;

    const transitionId = e.dataTransfer.getData(DND_TRANSITION);
    if (transitionId && target.kind === 'junction') {
      st.applyTransition(target.junction.leftClipId, target.junction.rightClipId, transitionId);
      select([target.junction.leftClipId]);
      return;
    }

    const effectId = e.dataTransfer.getData(DND_EFFECT);
    if (effectId && target.kind === 'clip') {
      st.addEffect(target.clipId, effectId);
      select([target.clipId]);
      return;
    }

    const filterId = e.dataTransfer.getData(DND_FILTER);
    if (filterId && target.kind === 'clip') {
      st.applyFilter(target.clipId, filterId);
      select([target.clipId]);
    }
  };

  /* ---------------- context menu ---------------- */

  const onContextMenu = (e: React.MouseEvent) => {
    const { x, y } = localPoint(e);
    const hit = hitTest(x, y, state, zoom, scrollX, scrollY);
    const st = editor.getState();
    const frame = Math.round(playback.currentFrame);

    // Right-clicking a keyframe goes straight to easing — the thing you
    // actually want at that moment — with the full editor one item away.
    if (hit.kind === 'keyframe') {
      const clipId = hit.clipId;
      if (!selection.includes(clipId)) select([clipId]);
      contextMenu([
        ...EASING_PRESETS.map((preset) => ({
          label: preset.name,
          onSelect: () => st.setKeyframeEasing(clipId, hit.frame, preset.easing, preset.bezier),
        })),
        { separator: true as const },
        {
          label: 'Custom curve…',
          onSelect: () => useUIStore.getState().openKeyframeEditor({ clipId, frame: hit.frame }),
        },
        {
          label: 'Delete keyframe',
          danger: true,
          onSelect: () => st.deleteKeyframesAt(clipId, hit.frame),
        },
      ])(e);
      return;
    }

    if (hit.kind === 'clip') {
      const clipId = hit.clipId;
      if (!selection.includes(clipId)) select([clipId]);
      const targets = selection.includes(clipId) ? selection : [clipId];
      const clip = state.clips[clipId];
      const keyframeCount = Object.values(clip?.keyframes ?? {}).reduce((n, l) => n + l.length, 0);

      contextMenu([
        { label: 'Split', shortcut: 'Ctrl+B', onSelect: () => st.splitClips(targets, frame) },
        {
          label: 'Split & delete left',
          onSelect: () => {
            const created = st.splitClips(targets, frame);
            st.deleteClips(targets);
            select(created);
          },
        },
        {
          label: 'Split & delete right',
          onSelect: () => {
            const created = st.splitClips(targets, frame);
            st.deleteClips(created);
          },
        },
        { separator: true },
        { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: () => select(st.duplicateClips(targets)) },
        {
          label: 'Detach audio',
          disabled: clip?.kind !== 'video' || !!clip?.linkedClipId,
          onSelect: () => st.detachAudio(clipId),
        },
        {
          label: clip?.enabled ? 'Disable clip' : 'Enable clip',
          onSelect: () => st.patchClip(clipId, { enabled: !clip?.enabled }),
        },
        {
          label: clip?.reversed ? 'Un-reverse' : 'Reverse',
          onSelect: () => st.patchClip(clipId, { reversed: !clip?.reversed }),
        },
        { separator: true },
        {
          label: keyframeCount > 0 ? `Keyframes… (${keyframeCount})` : 'Keyframes…',
          onSelect: () => useUIStore.getState().openKeyframeEditor({ clipId }),
        },
        { label: 'Speed…', onSelect: () => useUIStore.getState().setPropertyTab('speed') },
        { label: 'Add transition…', onSelect: () => useUIStore.getState().setAssetTab('transitions') },
        { label: 'Add effect…', onSelect: () => useUIStore.getState().setAssetTab('effects') },
        { separator: true },
        {
          label: 'Delete',
          shortcut: 'Del',
          danger: true,
          onSelect: () => {
            st.deleteClips(targets);
            clearSelection();
          },
        },
        {
          label: 'Ripple delete',
          shortcut: 'Ctrl+Del',
          danger: true,
          onSelect: () => {
            st.deleteClips(targets, true);
            clearSelection();
          },
        },
      ])(e);
      return;
    }

    contextMenu([
      { label: 'Add marker', shortcut: 'M', onSelect: () => st.addMarker(frame) },
      { label: 'Set loop in', shortcut: 'I', onSelect: () => st.setLoop(frame, Math.max(frame + 1, state.loop.outFrame), true) },
      { label: 'Set loop out', shortcut: 'O', onSelect: () => st.setLoop(Math.min(state.loop.inFrame, frame - 1), frame, true) },
      { label: 'Clear loop', disabled: !state.loop.enabled, onSelect: () => st.setLoop(0, 0, false) },
      { separator: true },
      { label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => select(Object.keys(state.clips)) },
      { label: 'Fit to window', shortcut: 'Ctrl+Shift+F', onSelect: fit },
    ])(e);
  };

  return (
    <div className="tl" ref={hostRef}>
      <TrackLabels layout={layout} scrollY={scrollY} />

      <div className="tl-body">
        <div
          className="tl-surface"
          ref={surfaceRef}
          data-cursor={hover.cursor}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => useUIStore.getState().setHoverFrame(null)}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
          onDragOver={onDragOver}
          onDragLeave={() => setLibraryTarget(null)}
          onDrop={onDrop}
        >
          <canvas ref={canvasRef} className="tl-canvas" />

          {/* Where the clip will land if released here. */}
          {spawnHint && <div className="tl-spawn-hint">New track</div>}

          <div className="playhead-line" aria-hidden="true">
            <div className="playhead-head" />
          </div>

          <TimelineScrollbar
            orientation="vertical"
            scroll={scrollY}
            viewport={size.h}
            content={contentHeight}
            onScroll={setScrollY}
          />
        </div>

        <TimelineScrollbar
          orientation="horizontal"
          scroll={scrollX}
          viewport={size.w}
          content={contentWidth}
          onScroll={setScrollX}
        />
      </div>
    </div>
  );
}

function cursorFor(hit: HitTarget): string {
  switch (hit.kind) {
    case 'ruler':
      return 'pointer';
    case 'clip':
      return hit.edge ? 'ew-resize' : 'grab';
    case 'keyframe':
      return 'ew-resize';
    case 'fade':
      return 'ew-resize';
    default:
      return 'default';
  }
}

/** Which track kinds a clip is allowed to land on. */
const kindFits = kindFitsTrack;

/** The track kind a clip of this kind needs. */
function trackKindForClip(clipKind: string): TrackKind {
  if (clipKind === 'audio') return 'audio';
  if (clipKind === 'text') return 'text';
  if (clipKind === 'sticker') return 'sticker';
  if (clipKind === 'effect') return 'effect';
  return 'video';
}

/**
 * How far past the band edge a drag must go before it counts as "make me a new
 * track". Large enough that brushing the edge while reaching for the top row
 * does not spawn one by accident.
 */
const SPAWN_MARGIN = 16;

/** Height of the "+ Track" row under the label column, included in scroll extent. */
const ADD_TRACK_ROW_H = 22;

/** Height of the gap opened for an incoming new track — a video lane. */
const NEW_TRACK_H = 54;

const isAudioKind = (kind: string) => kind === 'audio';

/** How near a seam the pointer must be for a transition to latch onto it. */
const JUNCTION_GRAB_PX = 26;

type LibraryDropTarget =
  | { kind: 'junction'; junction: Junction }
  | { kind: 'clip'; clipId: string }
  | null;

export { RULER_H };
