/**
 * TopTrim domain model.
 *
 * Everything on the timeline is measured in FRAMES, never seconds. Frames are
 * integers, so trims and cuts are exact and never drift. Seconds only appear at
 * the boundaries: the <video> element, ffmpeg arguments, and the timecode display.
 */

export type Frames = number;
export type Seconds = number;

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  /** Absolute path on disk. Null on web, where only the object URL exists. */
  path: string | null;
  /** `toptrim://local/...` in Electron, `blob:` on web. Created once, never re-created. */
  url: string;
  size: number;
  durationFrames: Frames;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Stable cache key for storyboard frames and waveform peaks. */
  hash: string;
  importedAt: number;
}

/* ------------------------------------------------------------------ *
 * Keyframes
 * ------------------------------------------------------------------ */

export type EasingKind = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | 'bezier';

export interface Keyframe {
  id: string;
  /** Timeline frame, absolute. */
  frame: Frames;
  value: number;
  easing: EasingKind;
  /** Cubic-bezier control handles, only used when easing === 'bezier'. */
  bezier?: [number, number, number, number];
}

/** Property path -> sorted keyframe list, e.g. `transform.scale`. */
export type KeyframeMap = Record<string, Keyframe[]>;

export interface BezierPoint {
  x: number; // 0..1 normalised time
  y: number; // 0..1 normalised value
  /** Handle offsets in normalised units. */
  hIn?: [number, number];
  hOut?: [number, number];
}

/* ------------------------------------------------------------------ *
 * Clip property groups
 * ------------------------------------------------------------------ */

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface Transform {
  /** Position in project pixel space; origin is the frame centre. */
  x: number;
  y: number;
  scale: number;     // percent, 100 = native
  scaleX: number;    // percent, independent axis scale
  scaleY: number;
  rotation: number;  // degrees
  opacity: number;   // 0..100
  flipH: boolean;
  flipV: boolean;
  blendMode: BlendMode;
  /** Crop as fractions of the source frame, 0..1. */
  crop: { left: number; top: number; right: number; bottom: number };
  anchorX: number;
  anchorY: number;
}

export interface CurvePoint { x: number; y: number }

export interface ColorWheel { hue: number; sat: number; lum: number }

export interface HslBand { hue: number; sat: number; lum: number }

export type HslRange = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta';

export interface ColorGrade {
  exposure: number;     // -100..100
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  sharpen: number;      // 0..100
  clarity: number;
  vignette: number;     // 0..100
  curves: {
    rgb: CurvePoint[];
    r: CurvePoint[];
    g: CurvePoint[];
    b: CurvePoint[];
  };
  wheels: { lift: ColorWheel; gamma: ColorWheel; gain: ColorWheel };
  hsl: Record<HslRange, HslBand>;
  lut: { id: string | null; intensity: number };
}

export type AudioEffectKind = 'reverb' | 'echo' | 'eq' | 'compressor' | 'pitch' | 'voice';

export interface AudioEffect {
  id: string;
  kind: AudioEffectKind;
  enabled: boolean;
  params: Record<string, number | string>;
}

export interface AudioProps {
  volumeDb: number;   // -60..+12
  muted: boolean;
  pan: number;        // -100 (L) .. 100 (R)
  fadeInFrames: Frames;
  fadeOutFrames: Frames;
  /** Curve of volume over the clip, drawn as the envelope line on the waveform. */
  effects: AudioEffect[];
  /** Set when noise reduction / vocal isolation produced a replacement asset. */
  processedAssetId?: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextProps {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: TextAlign;
  letterSpacing: number;
  lineHeight: number;
  outline: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; x: number; y: number; blur: number };
  background: { enabled: boolean; color: string; padding: number; radius: number };
  gradient: { enabled: boolean; from: string; to: string; angle: number };
}

/**
 * A processing pass that has already been baked into this clip's media
 * (stabilise, denoise, upscale...). Recorded so the timeline can badge the clip
 * and the AI panel can show what is already done rather than silently offering
 * to do it twice.
 */
export interface AppliedOp {
  /** Matches the operation id in aiOps. */
  id: string;
  label: string;
  at: number;
  /** What the clip pointed at before, so the pass can be reverted. */
  previousAssetId?: string;
}

export interface EffectInstance {
  id: string;
  effectId: string;     // key into the effect registry
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface TransitionInstance {
  id: string;
  transitionId: string; // key into the transition registry
  durationFrames: Frames;
  params: Record<string, number | string>;
}

export type AnimationSlot = 'in' | 'out' | 'loop';

export interface ClipAnimation {
  presetId: string;
  durationFrames: Frames;
}

/* ------------------------------------------------------------------ *
 * Clips and tracks
 * ------------------------------------------------------------------ */

export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'sticker' | 'effect';

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  assetId?: string;
  name: string;

  /** Timeline placement. */
  start: Frames;
  duration: Frames;

  /** Source in-point, in SOURCE frames (before speed is applied). */
  inPoint: Frames;
  speed: number;
  reversed: boolean;
  pitchCorrection: boolean;
  opticalFlow: boolean;
  /** Non-null switches the clip from a flat speed to a bezier speed ramp. */
  speedCurve: BezierPoint[] | null;

  enabled: boolean;

  transform: Transform;
  color: ColorGrade;
  audio: AudioProps;
  text?: TextProps;
  /** Sticker/emoji source, for kind === 'sticker'. */
  stickerId?: string;

  effects: EffectInstance[];
  transitionIn: TransitionInstance | null;
  transitionOut: TransitionInstance | null;
  animations: Partial<Record<AnimationSlot, ClipAnimation>>;

  /** Baked-in processing passes, oldest first. */
  appliedOps?: AppliedOp[];

  keyframes: KeyframeMap;

  /** Set when audio was detached from a video clip; the two move together. */
  linkedClipId?: string;

  /** Caption clips carry the word timings that produced them. */
  captionWords?: { text: string; start: Frames; end: Frames }[];
}

export type TrackKind = 'video' | 'audio' | 'text' | 'sticker' | 'effect';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  height: number;
  hidden: boolean;
  locked: boolean;
  muted: boolean;
  volumeDb: number;
  /**
   * The track the project started with. It anchors the middle of the stack:
   * overlays sit above it, audio below, and it cannot be reordered.
   */
  isMain?: boolean;
}

export interface Marker {
  id: string;
  frame: Frames;
  label: string;
  color: string;
}

export interface LoopRegion {
  enabled: boolean;
  inFrame: Frames;
  outFrame: Frames;
}

/** Adjustment tab — applied to the whole composition, above every track. */
export interface GlobalAdjustments {
  exposure: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  vignette: number;
}

/* ------------------------------------------------------------------ *
 * Project
 * ------------------------------------------------------------------ */

export interface TimelineState {
  tracks: Track[];
  clips: Record<string, Clip>;
  assets: Record<string, MediaAsset>;
  markers: Marker[];
  loop: LoopRegion;
  adjustments: GlobalAdjustments;
  /** Frame the playhead sits on. Not written during playback — see PlaybackEngine. */
  playhead: Frames;
  /** Beat timestamps from beat detection, in frames. */
  beats: Frames[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: Frames;
  thumbnailPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectMeta {
  state: TimelineState;
}

export type AspectPreset = '16:9' | '9:16' | '1:1' | '4:3' | '4:5' | '21:9' | 'original';
