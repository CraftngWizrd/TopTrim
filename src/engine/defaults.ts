import { nanoid } from 'nanoid';
import type {
  AudioProps,
  Clip,
  ClipKind,
  ColorGrade,
  GlobalAdjustments,
  HslRange,
  MediaAsset,
  Project,
  TextProps,
  TimelineState,
  Track,
  TrackKind,
  Transform,
} from '../types/project';

export const id = () => nanoid(12);

/** Track heights are fixed by type — Section 6.4. */
export const TRACK_HEIGHT: Record<TrackKind, number> = {
  video: 54,
  audio: 40,
  text: 28,
  sticker: 28,
  effect: 28,
};

export const defaultTransform = (): Transform => ({
  x: 0,
  y: 0,
  scale: 100,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  opacity: 100,
  flipH: false,
  flipV: false,
  blendMode: 'normal',
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  anchorX: 0.5,
  anchorY: 0.5,
});

const neutralCurve = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const HSL_RANGES: HslRange[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta'];

export const defaultColorGrade = (): ColorGrade => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  sharpen: 0,
  clarity: 0,
  vignette: 0,
  curves: {
    rgb: neutralCurve(),
    r: neutralCurve(),
    g: neutralCurve(),
    b: neutralCurve(),
  },
  wheels: {
    lift: { hue: 0, sat: 0, lum: 0 },
    gamma: { hue: 0, sat: 0, lum: 0 },
    gain: { hue: 0, sat: 0, lum: 0 },
  },
  hsl: Object.fromEntries(HSL_RANGES.map((r) => [r, { hue: 0, sat: 0, lum: 0 }])) as ColorGrade['hsl'],
  lut: { id: null, intensity: 100 },
});

export const defaultAudioProps = (): AudioProps => ({
  volumeDb: 0,
  muted: false,
  pan: 0,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  effects: [],
});

export const defaultTextProps = (content = 'Your text here'): TextProps => ({
  content,
  fontFamily: 'Outfit',
  fontSize: 64,
  fontWeight: 700,
  color: '#FFFFFF',
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.2,
  outline: { enabled: false, color: '#000000', width: 4 },
  shadow: { enabled: false, color: 'rgba(0,0,0,0.6)', x: 0, y: 4, blur: 8 },
  background: { enabled: false, color: 'rgba(0,0,0,0.55)', padding: 16, radius: 6 },
  gradient: { enabled: false, from: '#00E676', to: '#00C15E', angle: 90 },
});

export const defaultAdjustments = (): GlobalAdjustments => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
});

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: id(),
    kind,
    name,
    height: TRACK_HEIGHT[kind],
    hidden: false,
    locked: false,
    muted: false,
    volumeDb: 0,
  };
}

export function createClip(partial: Partial<Clip> & { trackId: string; kind: ClipKind }): Clip {
  return {
    id: id(),
    name: 'Clip',
    start: 0,
    duration: 90,
    inPoint: 0,
    speed: 1,
    reversed: false,
    pitchCorrection: true,
    opticalFlow: false,
    speedCurve: null,
    enabled: true,
    transform: defaultTransform(),
    color: defaultColorGrade(),
    audio: defaultAudioProps(),
    effects: [],
    transitionIn: null,
    transitionOut: null,
    animations: {},
    keyframes: {},
    ...partial,
  };
}

export function clipFromAsset(asset: MediaAsset, trackId: string, start: number): Clip {
  const kind: ClipKind = asset.kind === 'image' ? 'image' : asset.kind;
  return createClip({
    trackId,
    kind,
    assetId: asset.id,
    name: asset.name,
    start,
    // Images have no intrinsic length; 5 seconds is a common default.
    duration: asset.kind === 'image' ? 150 : asset.durationFrames,
    inPoint: 0,
    text: undefined,
  });
}

/**
 * A fresh timeline: "Main" on top, "Audio 1" beneath it.
 * Everything added later stacks above Main; audio stays at the bottom.
 */
export function createTimelineState(): TimelineState {
  const video = { ...createTrack('video', 'Main'), isMain: true };
  const audio = createTrack('audio', 'Audio 1');
  return {
    tracks: [video, audio],
    clips: {},
    assets: {},
    markers: [],
    loop: { enabled: false, inFrame: 0, outFrame: 0 },
    adjustments: defaultAdjustments(),
    playhead: 0,
    beats: [],
  };
}

/**
 * Back-fill a loaded project's state so a shape written by an older version (or
 * a partially-corrupt one) can't crash the renderer.
 *
 * Loaded clips bypass `createClip`, so a field added later (keyframes, audio,
 * transform.crop, …) would be `undefined` and the first `clip.audio.muted` or
 * `clip.keyframes[path]` access throws mid-render, white-screening the editor.
 * This merges every clip/track/state over the current defaults — version-
 * agnostic, so it tolerates any additive schema change without a migration.
 */
export function normalizeTimelineState(raw: unknown): TimelineState {
  const base = createTimelineState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<TimelineState>;

  const tracks =
    Array.isArray(s.tracks) && s.tracks.length
      ? s.tracks.map((t) => ({ ...createTrack(t?.kind ?? 'video', t?.name ?? 'Track'), ...t }))
      : base.tracks;

  const clips: Record<string, Clip> = {};
  if (s.clips && typeof s.clips === 'object') {
    for (const [cid, c] of Object.entries(s.clips as Record<string, Partial<Clip>>)) {
      if (!c || typeof c !== 'object') continue;
      const filled = createClip({ trackId: c.trackId ?? tracks[0].id, kind: c.kind ?? 'video' });
      clips[cid] = {
        ...filled,
        ...c,
        id: c.id ?? cid,
        transform: {
          ...filled.transform,
          ...(c.transform ?? {}),
          crop: { ...filled.transform.crop, ...(c.transform?.crop ?? {}) },
        },
        color: { ...filled.color, ...(c.color ?? {}) },
        audio: { ...filled.audio, ...(c.audio ?? {}) },
        effects: Array.isArray(c.effects) ? c.effects : [],
        keyframes: c.keyframes && typeof c.keyframes === 'object' ? c.keyframes : {},
        animations: c.animations && typeof c.animations === 'object' ? c.animations : {},
      } as Clip;
    }
  }

  return {
    ...base,
    ...s,
    tracks,
    clips,
    assets: (s.assets && typeof s.assets === 'object' ? s.assets : {}) as TimelineState['assets'],
    markers: Array.isArray(s.markers) ? s.markers : [],
    loop: { ...base.loop, ...(s.loop ?? {}) },
    adjustments: { ...base.adjustments, ...((s.adjustments as object) ?? {}) },
    beats: Array.isArray(s.beats) ? s.beats : [],
    playhead: typeof s.playhead === 'number' ? s.playhead : 0,
  };
}

export function createProject(name = 'Untitled project', width = 1920, height = 1080, fps = 30): Project {
  const now = Date.now();
  return {
    id: id(),
    name,
    width,
    height,
    fps,
    durationFrames: 0,
    thumbnailPath: null,
    createdAt: now,
    updatedAt: now,
    state: createTimelineState(),
  };
}

export const ASPECT_PRESETS: { label: string; value: string; ratio: number | null }[] = [
  { label: 'Original', value: 'original', ratio: null },
  { label: '16:9  Landscape', value: '16:9', ratio: 16 / 9 },
  { label: '9:16  Portrait', value: '9:16', ratio: 9 / 16 },
  { label: '1:1  Square', value: '1:1', ratio: 1 },
  { label: '4:3  Classic', value: '4:3', ratio: 4 / 3 },
  { label: '4:5  Portrait', value: '4:5', ratio: 4 / 5 },
  { label: '21:9  Cinematic', value: '21:9', ratio: 21 / 9 },
];

export const RESOLUTION_PRESETS = [
  { label: '3840×2160  4K', width: 3840, height: 2160 },
  { label: '2560×1440  2K', width: 2560, height: 1440 },
  { label: '1920×1080  1080p', width: 1920, height: 1080 },
  { label: '1280×720  720p', width: 1280, height: 720 },
  { label: '854×480  480p', width: 854, height: 480 },
];

export const FPS_PRESETS = [24, 25, 30, 50, 60, 120];
