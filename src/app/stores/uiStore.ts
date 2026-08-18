import { create } from 'zustand';
import type { Frames } from '../../types/project';

/**
 * Everything that is *view* rather than *document*: panel sizes, which tab is
 * open, what is selected, zoom, and in-flight worker jobs.
 *
 * Deliberately separate from editorStore so undo never rewinds your selection
 * or scroll position.
 */

export type Route = 'home' | 'editor';

export type AssetTab =
  | 'media' | 'audio' | 'text' | 'stickers' | 'effects'
  | 'transitions' | 'filters' | 'captions' | 'adjustment';

export type MediaSubNav = 'media' | 'yours' | 'generate' | 'library';

export type ModalKind = 'export' | 'settings' | 'shortcuts' | 'about' | 'newProject' | 'keyframes' | null;

/** What the keyframe editor should open on. */
export interface KeyframeTarget {
  clipId: string;
  frame?: number;
  path?: string;
}

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: false;
  onSelect: () => void;
}
export interface ContextMenuSeparator {
  separator: true;
}
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
}

export interface Job {
  id: string;
  label: string;
  detail: string;
  progress: number; // 0..1, -1 = indeterminate
  error?: string;
  done?: boolean;
  /** When the work started, so elapsed time and an ETA can be derived. */
  startedAt?: number;
  /** Units completed / expected, shown as "12 / 40" alongside the percentage. */
  done_count?: number;
  total_count?: number;
  /** Present when the job can be stopped; the overlay renders a cancel button. */
  onCancel?(): void;
}

/** Zoom is stored as pixels-per-frame so the Canvas renderer needs no conversion. */
export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 24;
export const ZOOM_DEFAULT = 1.2;

interface UIStore {
  route: Route;
  setRoute(r: Route): void;

  assetTab: AssetTab;
  setAssetTab(t: AssetTab): void;
  mediaSubNav: MediaSubNav;
  setMediaSubNav(s: MediaSubNav): void;

  /* selection */
  selection: string[];
  select(ids: string[], additive?: boolean): void;
  toggleSelect(id: string): void;
  clearSelection(): void;
  selectedKeyframe: { clipId: string; path: string; keyframeId: string } | null;
  setSelectedKeyframe(k: UIStore['selectedKeyframe']): void;

  /* timeline view */
  zoom: number;
  setZoom(z: number): void;
  zoomBy(factor: number): void;
  scrollX: number;
  setScrollX(x: number): void;
  /** Vertical scroll of the track area. The ruler stays pinned. */
  scrollY: number;
  setScrollY(y: number): void;
  snapEnabled: boolean;
  magnetEnabled: boolean;
  linkEnabled: boolean;
  toggleSnap(): void;
  toggleMagnet(): void;
  toggleLink(): void;

  /* layout */
  leftPanelWidth: number;
  rightPanelWidth: number;
  timelineHeight: number;
  setLeftPanelWidth(w: number): void;
  setRightPanelWidth(w: number): void;
  setTimelineHeight(h: number): void;

  /* right panel */
  propertyTab: string;
  setPropertyTab(t: string): void;
  colorSubTab: string;
  setColorSubTab(t: string): void;

  /* preview */
  playing: boolean;
  setPlaying(v: boolean): void;
  volume: number;
  muted: boolean;
  setVolume(v: number): void;
  toggleMute(): void;
  fullscreenPreview: boolean;
  toggleFullscreenPreview(): void;
  /** Canvas handles crop the picture instead of scaling it. */
  cropMode: boolean;
  setCropMode(v: boolean): void;
  toggleCropMode(): void;

  /* overlays */
  modal: ModalKind;
  openModal(m: ModalKind): void;
  closeModal(): void;
  keyframeTarget: KeyframeTarget | null;
  openKeyframeEditor(target: KeyframeTarget): void;
  contextMenu: ContextMenuState | null;
  openContextMenu(x: number, y: number, items: ContextMenuEntry[]): void;
  closeContextMenu(): void;

  /* worker jobs (storyboards, AI, export) */
  jobs: Record<string, Job>;
  setJob(job: Job): void;
  clearJob(id: string): void;

  /* transient */
  hoverFrame: Frames | null;
  setHoverFrame(f: Frames | null): void;
  draggingKind: 'clip' | 'trim' | 'scrub' | 'col' | 'row' | null;
  setDraggingKind(k: UIStore['draggingKind']): void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  route: 'home',
  setRoute: (route) => set({ route }),

  assetTab: 'media',
  setAssetTab: (assetTab) => set({ assetTab }),
  mediaSubNav: 'media',
  setMediaSubNav: (mediaSubNav) => set({ mediaSubNav }),

  selection: [],
  select: (ids, additive = false) =>
    set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids })),
  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [], selectedKeyframe: null }),
  selectedKeyframe: null,
  setSelectedKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),

  zoom: ZOOM_DEFAULT,
  setZoom: (z) => set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }),
  zoomBy: (factor) => set((s) => ({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s.zoom * factor)) })),
  scrollX: 0,
  setScrollX: (x) => set({ scrollX: Math.max(0, x) }),
  scrollY: 0,
  setScrollY: (y) => set({ scrollY: Math.max(0, y) }),
  snapEnabled: true,
  magnetEnabled: true,
  linkEnabled: true,
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleMagnet: () => set((s) => ({ magnetEnabled: !s.magnetEnabled })),
  toggleLink: () => set((s) => ({ linkEnabled: !s.linkEnabled })),

  leftPanelWidth: 300,
  rightPanelWidth: 280,
  timelineHeight: 180,
  setLeftPanelWidth: (w) => set({ leftPanelWidth: Math.max(220, Math.min(520, w)) }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: Math.max(220, Math.min(460, w)) }),
  setTimelineHeight: (h) => set({ timelineHeight: Math.max(120, Math.min(640, h)) }),

  propertyTab: 'basic',
  setPropertyTab: (propertyTab) => set({ propertyTab }),
  colorSubTab: 'basic',
  setColorSubTab: (colorSubTab) => set({ colorSubTab }),

  playing: false,
  setPlaying: (playing) => set({ playing }),
  volume: 1,
  muted: false,
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: volume === 0 }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  fullscreenPreview: false,
  toggleFullscreenPreview: () => set((s) => ({ fullscreenPreview: !s.fullscreenPreview })),
  cropMode: false,
  setCropMode: (cropMode) => set({ cropMode }),
  toggleCropMode: () => set((s) => ({ cropMode: !s.cropMode })),

  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  keyframeTarget: null,
  openKeyframeEditor: (keyframeTarget) => set({ keyframeTarget, modal: 'keyframes' }),
  contextMenu: null,
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),

  jobs: {},
  setJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  clearJob: (id) =>
    set((s) => {
      const next = { ...s.jobs };
      delete next[id];
      return { jobs: next };
    }),

  hoverFrame: null,
  setHoverFrame: (hoverFrame) => set({ hoverFrame }),
  draggingKind: null,
  setDraggingKind: (draggingKind) => {
    // Drives the body-level cursor override in cursors.css.
    if (draggingKind) document.body.dataset.dragging = draggingKind;
    else delete document.body.dataset.dragging;
    set({ draggingKind });
  },
}));
