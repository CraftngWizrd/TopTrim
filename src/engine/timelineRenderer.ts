import type { Clip, MediaAsset, TimelineState, Track } from '../types/project';
import { THUMB_W, THUMB_H, ensureFrames, getFrameAt } from './storyboard';
import { samplePeaks } from './waveform';
import { keyframeFrames } from './keyframes';
import { formatRulerLabel } from './time';

/**
 * Custom Canvas 2D timeline renderer.
 *
 * Everything is drawn here: ruler, lanes, clips, storyboard strips, waveforms,
 * keyframes, markers and the loop region. Only the playhead lives in the DOM,
 * because it has to move every frame without touching React or this canvas.
 */

export const RULER_H = 20;
export const TRIM_HANDLE_W = 6;
/** Keyframe strip along the top of a clip. */
export const KF_STRIP_H = 8;

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;

  state: TimelineState;
  assets: Record<string, MediaAsset>;
  fps: number;

  /** Pixels per frame. */
  zoom: number;
  scrollX: number;
  /** Vertical scroll of the track area; the ruler is unaffected. */
  scrollY: number;
  selection: string[];
  playhead: number;
  hoverClipId: string | null;
  hoverEdge: 'left' | 'right' | null;
  /** Frame the snap indicator should be drawn at, if any. */
  snapFrame: number | null;
  /** Live marquee rectangle in canvas space. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Set while dragging; those clips render translucent at their new spot. */
  dragging: boolean;
  /** Live drop feedback, or null when no drag is in flight. */
  dragPreview: DragPreview | null;
  /** Clips currently being dragged — dimmed in place while the ghost leads. */
  draggingIds: Set<string>;
  /** Extra space opened above the first track for an incoming new track. */
  reservedTop: number;
  /**
   * Where a library item dragged from the asset panel would land. Without this
   * a transition or effect drag gave no feedback at all — you found out where
   * it went by letting go.
   */
  libraryDrop: LibraryDropPreview | null;
}

/** Landing spot for a transition (a seam) or an effect/filter (a clip). */
export type LibraryDropPreview =
  | { kind: 'junction'; trackId: string; frame: number; leftClipId: string; rightClipId: string }
  | { kind: 'clip'; clipId: string };

const COLORS = {
  bg: '#0A090D',
  laneEven: 'rgba(255,255,255,0.012)',
  laneOdd: 'rgba(255,255,255,0.028)',
  laneBorder: 'rgba(255,255,255,0.05)',
  rulerBg: '#0A090D',
  tickMajor: 'rgba(255,255,255,0.28)',
  tickMinor: 'rgba(255,255,255,0.11)',
  tickText: '#555250',
  accent: '#00E676',
  keyframe: '#00E676',
  marker: '#00E676',
  loop: 'rgba(0,230,118,0.09)',
  snap: '#FFB300',
  beat: 'rgba(0,230,118,0.5)',
};

const TRACK_BG: Record<Track['kind'], string> = {
  video: '#1A3528',
  audio: '#152030',
  text: '#201528',
  sticker: '#28201A',
  effect: '#202018',
};

const TRACK_BORDER: Record<Track['kind'], string> = {
  video: 'rgba(0,200,100,0.2)',
  audio: 'rgba(70,150,240,0.22)',
  text: 'rgba(180,110,240,0.22)',
  sticker: 'rgba(240,170,80,0.22)',
  effect: 'rgba(220,220,120,0.2)',
};

/**
 * Y offset of each track lane, and total content height.
 *
 * `reservedTop` opens a gap above the first track while a drag is hovering
 * past the top of the stack — the space the new track will occupy, so the
 * timeline shows you room being made rather than tracks jumping on drop.
 */
export function trackLayout(
  tracks: Track[],
  reservedTop = 0
): { tops: number[]; heights: number[]; total: number; reservedTop: number } {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = RULER_H + reservedTop;
  for (const t of tracks) {
    tops.push(y);
    heights.push(t.height);
    y += t.height;
  }
  return { tops, heights, total: y, reservedTop };
}

/** Live drag feedback: where it would land, and the clip following the cursor. */
export interface DragPreview {
  /** Highlighted landing lane, in content space. */
  dropRect: { x: number; y: number; w: number; h: number } | null;
  /** Clips following the pointer, in viewport space. */
  ghosts: { x: number; y: number; w: number; h: number; label: string }[];
  /** Dashed lane for the track that will be created, in content space. */
  newTrackRect: { y: number; h: number } | null;
  /** True when the landing spot had to move to avoid a collision. */
  pushed: boolean;
}

export const frameToX = (frame: number, zoom: number, scrollX: number) => frame * zoom - scrollX;
export const xToFrame = (x: number, zoom: number, scrollX: number) => (x + scrollX) / zoom;

export interface RenderResult {
  /** True when a shimmer tile was painted — the caller keeps animating while it is. */
  pendingThumbnails: boolean;
}

/** Set by drawStoryboard during a pass; read once at the end of render(). */
let sawShimmer = false;

export function render(input: RenderInput): RenderResult {
  const { ctx, width, height, state, scrollY } = input;
  sawShimmer = false;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  const layout = trackLayout(state.tracks, input.reservedTop);

  // The track area scrolls under a fixed ruler, so it is drawn inside a clip
  // region translated by scrollY. Without the clip, scrolled-up lanes would
  // paint straight over the ruler.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, width, Math.max(0, height - RULER_H));
  ctx.clip();
  ctx.translate(0, -scrollY);

  drawLanes(input, layout);
  drawLoopRegion(input, layout);
  drawBeats(input, layout);
  drawDropTarget(input);
  drawClips(input, layout);
  drawLibraryDrop(input, layout);
  drawMarkerLines(input, layout);

  ctx.restore();

  // Ruler and its marker heads sit above the scrolling content.
  drawRuler(input);
  drawMarkerHeads(input);
  drawSnapGuide(input);
  drawMarquee(input);
  // Ghosts follow the cursor in viewport space, above everything.
  drawGhosts(input);

  ctx.restore();
  return { pendingThumbnails: sawShimmer };
}

/* ------------------------------------------------------------------ *
 * Ruler
 * ------------------------------------------------------------------ */

function drawRuler(input: RenderInput) {
  const { ctx, width, zoom, scrollX, fps } = input;

  ctx.fillStyle = COLORS.rulerBg;
  ctx.fillRect(0, 0, width, RULER_H);
  ctx.strokeStyle = COLORS.laneBorder;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H - 0.5);
  ctx.lineTo(width, RULER_H - 0.5);
  ctx.stroke();

  // Pick a tick spacing that keeps labels at least 56px apart.
  const secondsPerLabel = niceStep(56 / (zoom * fps));
  const minorPerMajor = secondsPerLabel >= 1 ? 5 : 2;
  const minorSeconds = secondsPerLabel / minorPerMajor;

  const firstSecond = Math.floor(scrollX / zoom / fps / minorSeconds) * minorSeconds;
  const lastSecond = (scrollX + width) / zoom / fps;

  ctx.font = '7.5px "JetBrains Mono", monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  for (let s = firstSecond; s <= lastSecond; s += minorSeconds) {
    const x = Math.round(frameToX(s * fps, zoom, scrollX)) + 0.5;
    if (x < -20 || x > width + 20) continue;

    // Floating point drift makes `% secondsPerLabel` unreliable; compare
    // against the rounded multiple instead.
    const isMajor = Math.abs(s / secondsPerLabel - Math.round(s / secondsPerLabel)) < 1e-6;

    ctx.strokeStyle = isMajor ? COLORS.tickMajor : COLORS.tickMinor;
    ctx.beginPath();
    ctx.moveTo(x, isMajor ? RULER_H - 9 : RULER_H - 4);
    ctx.lineTo(x, RULER_H - 1);
    ctx.stroke();

    if (isMajor && s >= 0) {
      ctx.fillStyle = COLORS.tickText;
      ctx.fillText(formatRulerLabel(s * fps, fps, secondsPerLabel < 1), x + 3, 9);
    }
  }
}

/** 1, 2, 5, 10, 15, 30, 60… — the spacings a ruler is allowed to use. */
function niceStep(seconds: number): number {
  const steps = [1 / 30, 1 / 10, 1 / 5, 1 / 2, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  for (const s of steps) if (seconds <= s) return s;
  return 3600;
}

/* ------------------------------------------------------------------ *
 * Lanes / regions
 * ------------------------------------------------------------------ */

function drawLanes(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const { ctx, width, state } = input;
  state.tracks.forEach((track, i) => {
    const y = layout.tops[i];
    ctx.fillStyle = i % 2 === 0 ? COLORS.laneEven : COLORS.laneOdd;
    ctx.fillRect(0, y, width, track.height);
    ctx.strokeStyle = COLORS.laneBorder;
    ctx.beginPath();
    ctx.moveTo(0, y + track.height - 0.5);
    ctx.lineTo(width, y + track.height - 0.5);
    ctx.stroke();
  });
}

function drawLoopRegion(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const { ctx, state, zoom, scrollX, width } = input;
  if (!state.loop.enabled || state.loop.outFrame <= state.loop.inFrame) return;

  const x0 = frameToX(state.loop.inFrame, zoom, scrollX);
  const x1 = frameToX(state.loop.outFrame, zoom, scrollX);
  ctx.fillStyle = COLORS.loop;
  ctx.fillRect(x0, RULER_H, x1 - x0, layout.total - RULER_H);

  ctx.strokeStyle = 'rgba(0,230,118,0.45)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  for (const x of [x0, x1]) {
    if (x < -2 || x > width + 2) continue;
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, layout.total);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBeats(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const { ctx, state, zoom, scrollX, width } = input;
  if (state.beats.length === 0) return;
  ctx.strokeStyle = COLORS.beat;
  ctx.beginPath();
  for (const beat of state.beats) {
    const x = Math.round(frameToX(beat, zoom, scrollX)) + 0.5;
    if (x < 0 || x > width) continue;
    ctx.moveTo(x, layout.total - 5);
    ctx.lineTo(x, layout.total);
  }
  ctx.stroke();
}

/** Marker lines run through the scrolling track area. */
function drawMarkerLines(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const { ctx, state, zoom, scrollX, width } = input;
  ctx.strokeStyle = 'rgba(0,230,118,0.28)';
  for (const marker of state.markers) {
    const x = Math.round(frameToX(marker.frame, zoom, scrollX)) + 0.5;
    if (x < -6 || x > width + 6) continue;
    ctx.beginPath();
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, layout.total);
    ctx.stroke();
  }
}

/** Marker heads live in the ruler, which does not scroll. */
function drawMarkerHeads(input: RenderInput) {
  const { ctx, state, zoom, scrollX, width } = input;
  for (const marker of state.markers) {
    const x = Math.round(frameToX(marker.frame, zoom, scrollX)) + 0.5;
    if (x < -6 || x > width + 6) continue;
    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.moveTo(x - 4, RULER_H - 8);
    ctx.lineTo(x + 4, RULER_H - 8);
    ctx.lineTo(x, RULER_H - 2);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The landing zone: a filled outline where the selection will sit, plus the
 * dashed lane for a track that is about to be created.
 *
 * Drawn under the clips so real content stays readable on top of it.
 */
function drawDropTarget(input: RenderInput) {
  const { ctx, width } = input;
  const preview = input.dragPreview;
  if (!preview) return;

  if (preview.newTrackRect) {
    const { y, h } = preview.newTrackRect;
    ctx.fillStyle = 'rgba(0,230,118,0.07)';
    ctx.fillRect(0, y, width, h);
    ctx.strokeStyle = 'rgba(0,230,118,0.55)';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(0.5, y + 0.5, width - 1, h - 1);
    ctx.setLineDash([]);

    ctx.fillStyle = COLORS.accent;
    ctx.font = '9px "DM Sans", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('New track', 8, y + h / 2);
    ctx.textBaseline = 'alphabetic';
  }

  if (preview.dropRect) {
    const { x, y, w, h } = preview.dropRect;
    // Amber when the drop had to move to avoid a collision, so the jump is
    // explained before it happens rather than looking like a glitch.
    const colour = preview.pushed ? COLORS.snap : COLORS.accent;
    ctx.fillStyle = preview.pushed ? 'rgba(255,179,0,0.16)' : 'rgba(0,230,118,0.16)';
    roundedRect(ctx, x, y + 2, w, h - 4, 2);
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, x + 0.5, y + 2.5, w - 1, h - 5, 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

/** Translucent copies of the dragged clips, tracking the cursor exactly. */
function drawGhosts(input: RenderInput) {
  const { ctx } = input;
  const preview = input.dragPreview;
  if (!preview || preview.ghosts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.72;
  for (const g of preview.ghosts) {
    ctx.fillStyle = 'rgba(0,230,118,0.22)';
    roundedRect(ctx, g.x, g.y, g.w, g.h, 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    roundedRect(ctx, g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1, 2);
    ctx.stroke();
    ctx.lineWidth = 1;

    if (g.w > 30) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '9px "DM Sans", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(ctx, g.label, g.w - 10), g.x + 5, g.y + 4);
      ctx.textBaseline = 'alphabetic';
    }
  }
  ctx.restore();
}

function drawSnapGuide(input: RenderInput) {
  const { ctx, snapFrame, zoom, scrollX, height } = input;
  if (snapFrame === null) return;
  const x = Math.round(frameToX(snapFrame, zoom, scrollX)) + 0.5;
  ctx.strokeStyle = COLORS.snap;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Where a dragged library item will land.
 *
 * A transition belongs to a seam, so it is drawn as a band straddling the cut
 * covering both neighbours — that is the region it will actually affect. An
 * effect or filter belongs to one clip, so that clip is outlined.
 */
function drawLibraryDrop(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const drop = input.libraryDrop;
  if (!drop) return;
  const { ctx, state, zoom, scrollX } = input;

  if (drop.kind === 'clip') {
    const clip = state.clips[drop.clipId];
    if (!clip) return;
    const i = state.tracks.findIndex((t) => t.id === clip.trackId);
    if (i < 0) return;
    const x = frameToX(clip.start, zoom, scrollX);
    const w = Math.max(2, clip.duration * zoom);
    ctx.save();
    ctx.fillStyle = 'rgba(0, 230, 118, 0.16)';
    ctx.fillRect(x, layout.tops[i], w, layout.heights[i]);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, layout.tops[i] + 1, w - 2, layout.heights[i] - 2);
    ctx.restore();
    return;
  }

  const i = state.tracks.findIndex((t) => t.id === drop.trackId);
  if (i < 0) return;
  const left = state.clips[drop.leftClipId];
  const right = state.clips[drop.rightClipId];
  if (!left || !right) return;

  const top = layout.tops[i];
  const h = layout.heights[i];
  const seamX = frameToX(drop.frame, zoom, scrollX);
  // Show the span the transition will occupy: half into each neighbour, capped
  // the same way applyTransition caps it.
  const reach = Math.max(8, Math.min(left.duration, right.duration) / 2 * zoom * 0.5);

  ctx.save();
  const grad = ctx.createLinearGradient(seamX - reach, 0, seamX + reach, 0);
  grad.addColorStop(0, 'rgba(0, 230, 118, 0)');
  grad.addColorStop(0.5, 'rgba(0, 230, 118, 0.34)');
  grad.addColorStop(1, 'rgba(0, 230, 118, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(seamX - reach, top, reach * 2, h);

  // The seam itself, so the exact cut is unmistakable.
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(seamX, top);
  ctx.lineTo(seamX, top + h);
  ctx.stroke();

  // Little facing arrows read as "these two join here".
  const cy = top + h / 2;
  ctx.fillStyle = COLORS.accent;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(seamX + dir * 11, cy - 5);
    ctx.lineTo(seamX + dir * 4, cy);
    ctx.lineTo(seamX + dir * 11, cy + 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawMarquee(input: RenderInput) {
  const { ctx, marquee } = input;
  if (!marquee) return;
  const x = Math.min(marquee.x0, marquee.x1);
  const y = Math.min(marquee.y0, marquee.y1);
  const w = Math.abs(marquee.x1 - marquee.x0);
  const h = Math.abs(marquee.y1 - marquee.y0);
  ctx.fillStyle = 'rgba(0,230,118,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,230,118,0.6)';
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, h);
}

/* ------------------------------------------------------------------ *
 * Clips
 * ------------------------------------------------------------------ */

function drawClips(input: RenderInput, layout: ReturnType<typeof trackLayout>) {
  const { ctx, state, width, zoom, scrollX, selection, hoverClipId, hoverEdge, assets, fps } = input;

  // Index once per draw. Filtering the whole clip map inside the track loop
  // made every repaint O(tracks x clips), which is what turned a busy project
  // into a slideshow while dragging.
  const byTrack = new Map<string, Clip[]>();
  for (const clip of Object.values(state.clips)) {
    let list = byTrack.get(clip.trackId);
    if (!list) byTrack.set(clip.trackId, (list = []));
    list.push(clip);
  }

  state.tracks.forEach((track, trackIndex) => {
    const y = layout.tops[trackIndex];
    const h = track.height;

    const clips = byTrack.get(track.id) ?? [];
    for (const clip of clips) {
      const x = frameToX(clip.start, zoom, scrollX);
      const w = clip.duration * zoom;
      if (x + w < -8 || x > width + 8) continue;

      const selected = selection.includes(clip.id);
      const hovered = hoverClipId === clip.id;

      // A clip being dragged stays visible but recedes, so the ghost reads as
      // the thing you are moving.
      const isDragging = input.draggingIds.has(clip.id);
      if (isDragging) ctx.globalAlpha = 0.32;
      drawClip(input, clip, track, assets, x, y + 2, w, h - 4, selected, hovered, hoverEdge, fps);
      if (isDragging) ctx.globalAlpha = 1;
    }
  });

  void ctx;
}

function drawClip(
  input: RenderInput,
  clip: Clip,
  track: Track,
  assets: Record<string, MediaAsset>,
  x: number,
  y: number,
  w: number,
  h: number,
  selected: boolean,
  hovered: boolean,
  hoverEdge: 'left' | 'right' | null,
  fps: number
) {
  const { ctx, zoom } = input;
  const kind = track.kind;

  ctx.save();
  roundedRect(ctx, x, y, w, h, 2);
  ctx.clip();

  ctx.fillStyle = TRACK_BG[kind];
  ctx.fillRect(x, y, w, h);

  if (!clip.enabled) ctx.globalAlpha = 0.4;

  if (clip.kind === 'video' && clip.assetId) {
    drawStoryboard(input, clip, assets[clip.assetId], x, y, w, h, fps);
  } else if (clip.kind === 'audio' && clip.assetId) {
    drawWaveform(input, clip, assets[clip.assetId], x, y, w, h, fps);
  } else if (clip.kind === 'image' && clip.assetId) {
    drawFlatFill(ctx, x, y, w, h, '#1F2E28');
  } else if (clip.kind === 'text') {
    drawCentredLabel(ctx, clip.text?.content.split('\n')[0] ?? clip.name, x, y, w, h);
  } else if (clip.kind === 'sticker') {
    drawCentredLabel(ctx, clip.name, x, y, w, h);
  }

  // Legibility scrim behind the clip name.
  if (clip.kind === 'video' || clip.kind === 'image') {
    const grad = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
    grad.addColorStop(0, 'rgba(0,0,0,0.72)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h * 0.4);
  }

  if (w > 26) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '9px "DM Sans", sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(truncate(ctx, clip.name, w - 10), x + 5, y + 3);
  }

  drawFades(ctx, clip, x, y, w, h, zoom);
  drawTransitionBadges(ctx, clip, x, y, w, h, zoom);
  drawKeyframes(ctx, clip, x, y, w, zoom, input.scrollX);
  drawAppliedBadge(ctx, clip, x, y, w);

  ctx.globalAlpha = 1;
  ctx.restore();

  // Border and selection sit outside the clip's own clip region.
  ctx.strokeStyle = selected ? 'rgba(0,230,118,0.9)' : TRACK_BORDER[kind];
  ctx.lineWidth = selected ? 1.5 : 1;
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 2);
  ctx.stroke();
  ctx.lineWidth = 1;

  if (hovered && w > 16) {
    ctx.fillStyle = 'rgba(0,230,118,0.85)';
    if (hoverEdge !== 'right') ctx.fillRect(x + 1, y + 1, 4, h - 2);
    if (hoverEdge !== 'left') ctx.fillRect(x + w - 5, y + 1, 4, h - 2);
  }
}

/** Storyboard strip — tiled wall to wall, shimmer where frames have not arrived. */
function drawStoryboard(
  input: RenderInput,
  clip: Clip,
  asset: MediaAsset | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  fps: number
) {
  const { ctx, zoom, width } = input;
  if (!asset) return drawFlatFill(ctx, x, y, w, h, '#16281F');

  const needed: number[] = [];
  const now = performance.now();

  /*
   * Tiles are anchored to the SOURCE, not to the clip's left edge.
   *
   * `originX` is where source frame 0 would sit if the clip had never been
   * trimmed. Laying the grid from there means trimming an edge reveals and
   * hides frames — each thumbnail stays put over its own piece of footage —
   * instead of the whole strip resampling and swimming sideways on every
   * pixel of drag. It also means the frame under the cursor while trimming is
   * the frame you are actually trimming to.
   */
  const originX = x - (clip.inPoint / clip.speed) * zoom;
  const firstTile = Math.floor((x - originX) / THUMB_W);
  const lastTile = Math.ceil((x + w - originX) / THUMB_W);

  for (let i = firstTile; i < lastTile; i++) {
    const tileLeft = originX + i * THUMB_W;
    // Visible slice of this tile, clipped to the clip's own rect.
    const drawLeft = Math.max(tileLeft, x);
    const drawRight = Math.min(tileLeft + THUMB_W, x + w);
    if (drawRight <= drawLeft) continue;
    if (drawRight < 0 || drawLeft > width) continue; // offscreen: no draw, no request

    // Source time at the centre of the WHOLE tile, so a partly-revealed tile
    // keeps showing the same frame rather than swapping as it is uncovered.
    const sourceFrames = ((tileLeft + THUMB_W / 2 - originX) / zoom) * clip.speed;
    const sourceSeconds = Math.max(0, sourceFrames / fps);
    const bitmap = getFrameAt(asset.hash, sourceSeconds);

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawLeft, y, drawRight - drawLeft, h);
    ctx.clip();

    if (bitmap) {
      // Cover-fit against the full tile, then let the clip above crop it —
      // that is what makes a half-revealed tile show the correct half.
      const cover = Math.max(THUMB_W / bitmap.width, h / bitmap.height);
      const dw = bitmap.width * cover;
      const dh = bitmap.height * cover;
      ctx.drawImage(bitmap, tileLeft + (THUMB_W - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      // Shimmer — never a flat colour block.
      const phase = ((now / 1400 + i * 0.12) % 1) * (THUMB_W * 2) - THUMB_W * 0.5;
      const grad = ctx.createLinearGradient(tileLeft + phase - THUMB_W * 0.5, 0, tileLeft + phase + THUMB_W * 0.5, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.02)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      grad.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = '#16281F';
      ctx.fillRect(tileLeft, y, THUMB_W, h);
      ctx.fillStyle = grad;
      ctx.fillRect(tileLeft, y, THUMB_W, h);
      needed.push(sourceSeconds);
    }
    ctx.restore();

    // Tile seam, only where the boundary is actually inside the clip.
    const seam = tileLeft + THUMB_W;
    if (seam > x && seam < x + w) {
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.moveTo(Math.round(seam) + 0.5, y);
      ctx.lineTo(Math.round(seam) + 0.5, y + h);
      ctx.stroke();
    }
  }

  // ensureFrames dedupes internally, so calling it every paint is cheap.
  if (needed.length) {
    sawShimmer = true;
    void ensureFrames(asset, needed);
  }
}

function drawWaveform(
  input: RenderInput,
  clip: Clip,
  asset: MediaAsset | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  fps: number
) {
  const { ctx, playhead } = input;
  if (!asset) return;

  const bars = Math.max(1, Math.floor(w / 2));
  const startSeconds = clip.inPoint / fps;
  const endSeconds = (clip.inPoint + clip.duration * clip.speed) / fps;
  const peaks = samplePeaks(asset.hash, startSeconds, endSeconds, bars);

  const mid = y + h / 2;
  if (!peaks) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 2, mid);
    ctx.lineTo(x + w - 2, mid);
    ctx.stroke();
    return;
  }

  const playedX = frameToX(playhead, input.zoom, input.scrollX);
  const half = h / 2 - 3;
  for (let i = 0; i < bars; i++) {
    const bx = x + i * 2;
    const amp = Math.max(1, peaks[i] * half);
    ctx.fillStyle = bx < playedX ? 'rgba(0,230,118,0.85)' : 'rgba(150,200,255,0.55)';
    ctx.fillRect(bx, mid - amp, 1.4, amp * 2);
  }
}

/** Fade handles + the shaded triangle they produce. */
function drawFades(ctx: CanvasRenderingContext2D, clip: Clip, x: number, y: number, w: number, h: number, zoom: number) {
  const fadeIn = clip.audio.fadeInFrames * zoom;
  const fadeOut = clip.audio.fadeOutFrames * zoom;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  if (fadeIn > 1) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.min(fadeIn, w), y);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  }
  if (fadeOut > 1) {
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - Math.min(fadeOut, w), y);
    ctx.closePath();
    ctx.fill();
  }

  // Grab handles at the top corners.
  if (w > 20) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x + Math.min(Math.max(fadeIn, 0), w), y + 3, 2.5, 0, Math.PI * 2);
    ctx.arc(x + w - Math.min(Math.max(fadeOut, 0), w), y + 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTransitionBadges(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number
) {
  const draw = (cx: number, frames: number) => {
    const bw = Math.max(10, Math.min(frames * zoom, w / 2));
    ctx.fillStyle = 'rgba(0,230,118,0.24)';
    ctx.fillRect(cx, y, bw, h);
    ctx.strokeStyle = 'rgba(0,230,118,0.7)';
    ctx.beginPath();
    ctx.moveTo(cx, y + h);
    ctx.lineTo(cx + bw, y);
    ctx.stroke();
  };
  if (clip.transitionIn) draw(x, clip.transitionIn.durationFrames);
  if (clip.transitionOut) draw(x + w - Math.max(10, Math.min(clip.transitionOut.durationFrames * zoom, w / 2)), clip.transitionOut.durationFrames);
}

/**
 * Sparkle badge marking a clip whose media has had a processing pass baked in.
 *
 * Sits top-right so it never collides with the clip name, and shows a count
 * when more than one pass has been applied.
 */
function drawAppliedBadge(ctx: CanvasRenderingContext2D, clip: Clip, x: number, y: number, w: number) {
  const ops = clip.appliedOps ?? [];
  if (ops.length === 0 || w < 34) return;

  const r = 6.5;
  const cx = x + w - r - 4;
  const cy = y + r + 3;

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Four-point sparkle: a diamond pinched at the waist reads as "AI" at 13px
  // where any real glyph would just be mush.
  const s = 4.2;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.quadraticCurveTo(cx + s * 0.28, cy - s * 0.28, cx + s, cy);
  ctx.quadraticCurveTo(cx + s * 0.28, cy + s * 0.28, cx, cy + s);
  ctx.quadraticCurveTo(cx - s * 0.28, cy + s * 0.28, cx - s, cy);
  ctx.quadraticCurveTo(cx - s * 0.28, cy - s * 0.28, cx, cy - s);
  ctx.closePath();
  ctx.fill();

  if (ops.length > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ops.length), cx - r - 3, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function drawKeyframes(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  x: number,
  y: number,
  w: number,
  zoom: number,
  scrollX: number
) {
  const frames = keyframeFrames(clip.keyframes);
  if (frames.length === 0) return;

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y, w, KF_STRIP_H);

  for (const f of frames) {
    const kx = frameToX(f, zoom, scrollX);
    if (kx < x - 4 || kx > x + w + 4) continue;
    const ky = y + KF_STRIP_H / 2;
    ctx.fillStyle = COLORS.keyframe;
    ctx.beginPath();
    ctx.moveTo(kx, ky - 3.2);
    ctx.lineTo(kx + 3.2, ky);
    ctx.lineTo(kx, ky + 3.2);
    ctx.lineTo(kx - 3.2, ky);
    ctx.closePath();
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function drawFlatFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawCentredLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, w: number, h: number) {
  if (w < 20) return;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = '9px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(ctx, label, w - 10), x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Hit testing
 * ------------------------------------------------------------------ */

export type HitTarget =
  | { kind: 'ruler'; frame: number }
  | { kind: 'clip'; clipId: string; edge: 'left' | 'right' | null; frame: number }
  | { kind: 'keyframe'; clipId: string; frame: number }
  | { kind: 'fade'; clipId: string; side: 'in' | 'out' }
  | { kind: 'empty'; trackId: string | null; frame: number };

export function hitTest(
  x: number,
  y: number,
  state: TimelineState,
  zoom: number,
  scrollX: number,
  scrollY = 0
): HitTarget {
  const frame = Math.max(0, xToFrame(x, zoom, scrollX));
  if (y < RULER_H) return { kind: 'ruler', frame };

  // Below the ruler, pointer coordinates are in viewport space; the lanes are
  // scrolled, so translate into content space before matching a track.
  const contentY = y + scrollY;
  const layout = trackLayout(state.tracks);
  const trackIndex = layout.tops.findIndex((top, i) => contentY >= top && contentY < top + layout.heights[i]);
  if (trackIndex < 0) return { kind: 'empty', trackId: null, frame };

  const track = state.tracks[trackIndex];
  // Lane origin in viewport space, so the per-clip offsets below still compare
  // against the pointer's own coordinate system.
  const laneY = layout.tops[trackIndex] - scrollY;

  for (const clip of Object.values(state.clips)) {
    if (clip.trackId !== track.id) continue;
    const cx = frameToX(clip.start, zoom, scrollX);
    const cw = clip.duration * zoom;
    if (x < cx || x > cx + cw) continue;

    const localY = y - laneY - 2;

    // Keyframe strip wins over the body, but only where a keyframe actually is.
    if (localY <= KF_STRIP_H) {
      for (const kf of keyframeFrames(clip.keyframes)) {
        if (Math.abs(frameToX(kf, zoom, scrollX) - x) <= 4) {
          return { kind: 'keyframe', clipId: clip.id, frame: kf };
        }
      }
    }

    // Fade handles live in the top corners.
    if (localY <= 8 && cw > 20) {
      const inX = cx + clip.audio.fadeInFrames * zoom;
      const outX = cx + cw - clip.audio.fadeOutFrames * zoom;
      if (Math.abs(x - inX) <= 5) return { kind: 'fade', clipId: clip.id, side: 'in' };
      if (Math.abs(x - outX) <= 5) return { kind: 'fade', clipId: clip.id, side: 'out' };
    }

    const handle = Math.min(TRIM_HANDLE_W, cw / 3);
    if (x <= cx + handle) return { kind: 'clip', clipId: clip.id, edge: 'left', frame };
    if (x >= cx + cw - handle) return { kind: 'clip', clipId: clip.id, edge: 'right', frame };
    return { kind: 'clip', clipId: clip.id, edge: null, frame };
  }

  return { kind: 'empty', trackId: track.id, frame };
}
