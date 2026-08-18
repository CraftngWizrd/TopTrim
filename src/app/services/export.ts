import { transitionById } from '../../engine/transitions';
import type { Clip, MediaAsset, Project } from '../../types/project';
import { useEditorStore } from '../stores/editorStore';
import { platform } from '../hooks/usePlatform';
import { asBlobPart, ffmpegClient, getFileHandle, safeName } from '../../engine/ffmpegClient';
import { effectById } from '../../engine/effects';
import { framesToSeconds } from '../../engine/time';
import { stickerById, stickerDataUrl } from '../../engine/libraries';

/**
 * Export.
 *
 * Every visual clip becomes its own ffmpeg input, is trimmed/sped/graded in its
 * own chain, then overlaid onto a black canvas at its timeline position. That
 * one mechanism covers gaps, multi-track compositing and picture-in-picture
 * without special cases. Audio is trimmed, delayed and mixed the same way.
 *
 * Text and sticker clips are rasterised to PNG in the browser first, so what
 * exports is pixel-for-pixel what the preview showed — same fonts, same
 * styling — rather than a second, divergent text renderer.
 *
 * No watermark is added. Ever. There is no resolution cap.
 */

export type ExportFormat = 'mp4' | 'webm' | 'mov' | 'gif' | 'mp3' | 'wav';
export type Quality = 'high' | 'medium' | 'web';

export interface ExportSettings {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  quality: Quality;
  audioBitrate: number;
  applyEffects: boolean;
  burnCaptions: boolean;
  audioOnly: boolean;
}

export interface PlatformPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'youtube', label: 'YouTube', width: 1920, height: 1080, fps: 30, format: 'mp4' },
  { id: 'youtube4k', label: 'YouTube 4K', width: 3840, height: 2160, fps: 30, format: 'mp4' },
  { id: 'tiktok', label: 'TikTok', width: 1080, height: 1920, fps: 30, format: 'mp4' },
  { id: 'reels', label: 'Instagram Reels', width: 1080, height: 1920, fps: 30, format: 'mp4' },
  { id: 'twitter', label: 'Twitter / X', width: 1280, height: 720, fps: 30, format: 'mp4' },
  { id: 'discord', label: 'Discord', width: 1280, height: 720, fps: 30, format: 'mp4' },
  { id: 'custom', label: 'Custom', width: 1920, height: 1080, fps: 30, format: 'mp4' },
];

const CRF: Record<Quality, number> = { high: 18, medium: 23, web: 28 };
const PRESET: Record<Quality, string> = { high: 'medium', medium: 'faster', web: 'veryfast' };

export interface ExportProgress {
  stage: string;
  detail: string;
  /** 0..1, or -1 when the stage has no measurable progress. */
  value: number;
  log?: string;
}

export interface ExportResult {
  savedPath: string | null;
  cancelled: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Rasterising overlays
 * ------------------------------------------------------------------ */

/** Draw a text clip exactly as the preview does, at full project resolution. */
async function rasterizeText(clip: Clip, width: number, height: number): Promise<Uint8Array | null> {
  const t = clip.text;
  if (!t) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const lines = t.content.split('\n');
  ctx.font = `${t.fontWeight} ${t.fontSize}px "${t.fontFamily}", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align === 'left' ? 'left' : t.align === 'right' ? 'right' : 'center';

  const lineHeight = t.fontSize * t.lineHeight;
  const blockHeight = lineHeight * lines.length;
  const cx = width / 2 + clip.transform.x;
  const cy = height / 2 + clip.transform.y;
  const x = t.align === 'left' ? cx - width / 4 : t.align === 'right' ? cx + width / 4 : cx;

  if (t.background.enabled) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.fillStyle = t.background.color;
    roundRect(
      ctx,
      cx - widest / 2 - t.background.padding,
      cy - blockHeight / 2 - t.background.padding * 0.4,
      widest + t.background.padding * 2,
      blockHeight + t.background.padding * 0.8,
      t.background.radius
    );
    ctx.fill();
  }

  if (t.shadow.enabled) {
    ctx.shadowColor = t.shadow.color;
    ctx.shadowOffsetX = t.shadow.x;
    ctx.shadowOffsetY = t.shadow.y;
    ctx.shadowBlur = t.shadow.blur;
  }

  lines.forEach((line, i) => {
    const y = cy - blockHeight / 2 + lineHeight * (i + 0.5);
    if (t.outline.enabled) {
      ctx.lineWidth = t.outline.width * 2;
      ctx.strokeStyle = t.outline.color;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
    }
    if (t.gradient.enabled) {
      const rad = (t.gradient.angle * Math.PI) / 180;
      const grad = ctx.createLinearGradient(
        cx - Math.cos(rad) * width * 0.25,
        cy - Math.sin(rad) * height * 0.25,
        cx + Math.cos(rad) * width * 0.25,
        cy + Math.sin(rad) * height * 0.25
      );
      grad.addColorStop(0, t.gradient.from);
      grad.addColorStop(1, t.gradient.to);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = t.color;
    }
    ctx.fillText(line, x, y);
  });

  return canvasToPng(canvas);
}

async function rasterizeSticker(clip: Clip, width: number, height: number): Promise<Uint8Array | null> {
  const def = clip.stickerId ? stickerById(clip.stickerId) : null;
  if (!def) return null;

  const img = new Image();
  img.src = stickerDataUrl(def);
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const size = Math.min(width, height) * 0.3 * (clip.transform.scale / 100);
  ctx.globalAlpha = clip.transform.opacity / 100;
  ctx.translate(width / 2 + clip.transform.x, height / 2 + clip.transform.y);
  ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);

  return canvasToPng(canvas);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Could not rasterise overlay'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
 * Filter chain builders
 * ------------------------------------------------------------------ */

/** Per-clip colour grade, expressed as ffmpeg filters. */
function gradeFilters(clip: Clip, global: Project['state']['adjustments']): string[] {
  const c = clip.color;
  const out: string[] = [];

  const brightness = ((c.exposure + global.exposure) / 100) * 0.35;
  const contrast = 1 + (c.contrast + global.contrast) / 130;
  const saturation = Math.max(0, 1 + (c.saturation + global.saturation + c.vibrance * 0.5) / 110);
  const gamma = 1 - (c.shadows + global.shadows) / 400;

  if (brightness || contrast !== 1 || saturation !== 1 || gamma !== 1) {
    out.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`);
  }

  const temp = c.temperature + global.temperature;
  if (temp) out.push(`colortemperature=temperature=${Math.round(6500 - temp * 22)}`);
  if (c.sharpen + global.sharpen > 0) out.push(`unsharp=5:5:${(((c.sharpen + global.sharpen) / 100) * 1.5).toFixed(2)}`);
  if (c.vignette + global.vignette > 0) out.push(`vignette=angle=${(Math.PI / 5 + ((c.vignette + global.vignette) / 100) * 0.6).toFixed(3)}`);

  // Tone curves only emit when they are no longer the identity line.
  const curve = (points: { x: number; y: number }[]) => points.map((p) => `${p.x.toFixed(3)}/${p.y.toFixed(3)}`).join(' ');
  const isIdentity = (points: { x: number; y: number }[]) =>
    points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
  const curves: string[] = [];
  if (!isIdentity(c.curves.rgb)) curves.push(`all='${curve(c.curves.rgb)}'`);
  if (!isIdentity(c.curves.r)) curves.push(`r='${curve(c.curves.r)}'`);
  if (!isIdentity(c.curves.g)) curves.push(`g='${curve(c.curves.g)}'`);
  if (!isIdentity(c.curves.b)) curves.push(`b='${curve(c.curves.b)}'`);
  if (curves.length) out.push(`curves=${curves.join(':')}`);

  return out;
}

function effectFilters(clip: Clip): string[] {
  const out: string[] = [];
  for (const inst of clip.effects) {
    if (!inst.enabled) continue;
    if (inst.effectId === 'chroma-key') {
      // Validate the colour before it enters the filtergraph. This is the one
      // effect param that is a string, and it is interpolated into
      // -filter_complex; an unvalidated value like `0x0[v];movie=secret.key[x];`
      // would inject extra filters (arbitrary-file read via movie=). A strict
      // hex check makes that impossible — anything malformed falls back to green.
      const raw = String(inst.params.color ?? '#00ff00');
      const hex = /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw) ? raw.replace(/^#/, '') : '00ff00';
      const color = `0x${hex}`;
      const similarity = (clampNum(inst.params.similarity, 0, 100, 30) / 100).toFixed(3);
      const blend = (clampNum(inst.params.smoothness, 0, 100, 10) / 100).toFixed(3);
      out.push(`chromakey=${color}:${similarity}:${blend}`);
      continue;
    }
    const def = effectById(inst.effectId);
    if (!def?.ffmpeg) continue;
    // Drop non-finite values (a string param becomes NaN via Number()), which
    // `?? default` would NOT catch — leaving `gblur=sigma=NaN` in the graph and
    // failing the render. Missing keys then fall back to the builder's defaults.
    const params = Object.fromEntries(
      Object.entries(inst.params)
        .map(([k, v]) => [k, Number(v)] as const)
        .filter(([, v]) => Number.isFinite(v))
    );
    const filter = def.ffmpeg(params);
    if (filter) out.push(filter);
  }
  return out;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** A finite number in [min,max], or `fallback` for NaN/Infinity/non-numbers. */
const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ------------------------------------------------------------------ *
 * The export
 * ------------------------------------------------------------------ */

export async function runExport(
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void
): Promise<ExportResult> {
  const { state, meta } = useEditorStore.getState();
  if (!meta) return { savedPath: null, cancelled: false, error: 'No project open' };

  const fps = settings.fps;
  const W = settings.width;
  const H = settings.height;

  const tracks = new Map(state.tracks.map((t, i) => [t.id, state.tracks.length - i]));
  const active = Object.values(state.clips)
    .filter((c) => {
      const track = state.tracks.find((t) => t.id === c.trackId);
      return c.enabled && track && !track.hidden;
    })
    .sort((a, b) => (tracks.get(a.trackId) ?? 0) - (tracks.get(b.trackId) ?? 0));

  if (active.length === 0) return { savedPath: null, cancelled: false, error: 'Timeline is empty' };

  const durationFrames = active.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const durationSeconds = framesToSeconds(durationFrames, meta.fps);

  onProgress({ stage: 'Preparing', detail: 'Collecting sources', value: -1 });

  /*
   * Native ffmpeg when the host has it.
   *
   * This is the difference between a render that finishes and one you abandon:
   * the WASM build encodes 1080p in software at a few frames per second, so a
   * minute of timeline takes many minutes. The native binary reads sources
   * straight off disk — no mounting, no copying — and can reach the machine's
   * hardware encoders. Every source must have a real path for this to work; a
   * generated or blob-backed asset falls the whole export back to WASM.
   */
  const native = await platform.nativeFFmpeg();
  const everySourceOnDisk = active.every((c) => {
    if (c.kind === 'text' || c.kind === 'sticker') return true;
    const a = c.assetId ? state.assets[c.assetId] : undefined;
    return !!a?.path;
  });
  const useNative = !!native && everySourceOnDisk;

  const files: File[] = [];
  const writes: { name: string; data: Uint8Array }[] = [];
  const inputArgs: string[] = [];
  const videoChains: string[] = [];
  const audioChains: { chain: string; label: string }[] = [];
  const overlayOrder: { label: string; clip: Clip; scaledW: number; scaledH: number }[] = [];
  /**
   * Clips joined by a real transition, keyed by clip id -> the run it belongs
   * to. Members are composited with `xfade` instead of being overlaid
   * individually, because a wipe or a slide needs both pictures in one filter.
   */
  const runMembers = new Map<string, { runId: number; label: string }>();

  let inputIndex = 0;

  /*
   * Transitions.
   *
   * A transition lives on the outgoing clip and joins it to the next clip on
   * the same track. Both pictures have to be inside one filter for a wipe or a
   * slide to mean anything, so consecutive clips joined this way are collected
   * into a "run" and composited with `xfade`, then overlaid as a single unit.
   *
   * The overlap eats into the incoming clip's own head — it starts early and
   * reaches its in-point exactly where the cut used to be — so the run has the
   * same total length as the clips it replaces and nothing downstream shifts.
   * That is also why it is capped by how much source sits before the in-point.
   */
  // The next clip on the same track that begins where `clip` ends (within the
  // 2-frame join slop). Excludes `clip` itself — without that guard a clip of
  // duration <= 2 satisfies `start >= start + duration - 2` for itself and
  // becomes its own neighbour, which fed a self-referential run below.
  const nextOnTrack = (clip: Clip): Clip | undefined =>
    active
      .filter((c) => c.id !== clip.id && c.trackId === clip.trackId && c.start >= clip.start + clip.duration - 2)
      .sort((a, b) => a.start - b.start)[0];

  const incomingTransition = new Map<string, { seconds: number; transitionId: string }>();
  for (const clip of active) {
    const t = clip.transitionOut;
    if (!t || clip.kind === 'audio') continue;

    const next = nextOnTrack(clip);
    if (!next) continue;

    const asset = next.assetId ? state.assets[next.assetId] : undefined;
    const headroomFrames = asset && next.kind === 'video' ? next.inPoint / Math.max(next.speed, 0.0001) : Infinity;
    const frames = Math.max(
      0,
      Math.min(t.durationFrames, Math.floor(next.duration / 2), Math.floor(clip.duration / 2), headroomFrames)
    );
    if (frames > 0) {
      incomingTransition.set(next.id, {
        seconds: framesToSeconds(frames, meta.fps),
        transitionId: t.transitionId,
      });
    }
  }

  /**
   * Chains of clips linked by transitions.
   *
   * Only pairs that actually produced an overlap above are linked, so a
   * transition that was capped to nothing leaves both clips on the ordinary
   * overlay path. Text and stickers never join a run — they are overlays in
   * their own right.
   */
  const runs: Clip[][] = [];
  {
    const successor = new Map<string, Clip>();
    const claimed = new Set<string>();
    for (const clip of active) {
      if (clip.kind === 'audio' || clip.kind === 'text' || clip.kind === 'sticker') continue;
      const next = nextOnTrack(clip);
      // Claim each successor for at most ONE predecessor: two clips selecting
      // the same `next` would reuse its filter label and abort the export.
      if (next && !claimed.has(next.id) && incomingTransition.has(next.id) && next.kind !== 'text' && next.kind !== 'sticker') {
        successor.set(clip.id, next);
        claimed.add(next.id);
      }
    }
    const isSuccessor = new Set([...successor.values()].map((c) => c.id));
    for (const clip of active) {
      // Start a run only at its head, so each chain is walked once.
      if (!successor.has(clip.id) || isSuccessor.has(clip.id)) continue;
      const chain: Clip[] = [clip];
      const visited = new Set<string>([clip.id]);
      let cur: Clip | undefined = clip;
      while (cur && successor.has(cur.id)) {
        const nxt: Clip = successor.get(cur.id)!;
        if (visited.has(nxt.id)) break; // never loop, however pathological the seams
        visited.add(nxt.id);
        chain.push(nxt);
        cur = nxt;
      }
      // A run is only foldable if every member resolves to an asset; otherwise a
      // member would emit no chain, leaving the others' xfade labels dangling
      // and aborting the whole export. Demote such chains to the overlay path.
      const foldable = chain.length >= 2 && chain.every((c) => c.assetId && state.assets[c.assetId]);
      if (foldable) runs.push(chain);
    }
    runs.forEach((chain, runId) =>
      chain.forEach((c) => runMembers.set(c.id, { runId, label: '' }))
    );
  }

  /* ---- base canvas ---- */
  inputArgs.push('-f', 'lavfi', '-t', durationSeconds.toFixed(3), '-i', `color=c=black:s=${W}x${H}:r=${fps}`);
  const baseIndex = inputIndex++;

  /* ---- visual clips ---- */
  for (const clip of active) {
    if (clip.kind === 'audio') continue;

    // An incoming transition pulls this clip earlier and lengthens it by the
    // overlap, taking the extra frames from its own head.
    const fadeIn = incomingTransition.get(clip.id)?.seconds ?? 0;
    const clipStart = Math.max(0, framesToSeconds(clip.start, meta.fps) - fadeIn);
    const clipDur = framesToSeconds(clip.duration, meta.fps) + fadeIn;
    const sourceIn = Math.max(0, framesToSeconds(clip.inPoint, meta.fps) - fadeIn * clip.speed);
    const sourceDur = clipDur * clip.speed;

    let label: string;

    if (clip.kind === 'text' || clip.kind === 'sticker') {
      if (clip.kind === 'text' && !settings.burnCaptions) continue;
      const png = clip.kind === 'text' ? await rasterizeText(clip, W, H) : await rasterizeSticker(clip, W, H);
      if (!png) continue;
      const name = `ov_${inputIndex}.png`;
      writes.push({ name, data: png });
      // Native runs from a scratch directory; WASM writes into its own FS root.
      inputArgs.push('-loop', '1', '-t', clipDur.toFixed(3), '-i', useNative ? `{TMP}/${name}` : name);
      label = `v${inputIndex}`;
      videoChains.push(`[${inputIndex}:v]format=rgba,setpts=PTS-STARTPTS+${clipStart.toFixed(3)}/TB[${label}]`);
      overlayOrder.push({ label, clip, scaledW: W, scaledH: H });
      inputIndex++;
      continue;
    }

    const asset = clip.assetId ? state.assets[clip.assetId] : undefined;
    if (!asset) continue;

    let inputPath: string;
    if (useNative) {
      inputPath = asset.path!; // guaranteed by everySourceOnDisk
    } else {
      const handle = await getFileHandle(asset);
      if (!handle) {
        return { savedPath: null, cancelled: false, error: `Source for "${asset.name}" is unavailable. Re-import it and export again.` };
      }
      const name = safeName(asset.name);
      if (!files.some((f) => f.name === name)) files.push(new File([handle], name, { type: handle.type }));
      inputPath = `/mnt/${name}`;
    }

    if (clip.kind === 'image') {
      inputArgs.push('-loop', '1', '-t', clipDur.toFixed(3), '-i', inputPath);
    } else {
      // Fast seek before -i, exact duration after: seeks in O(1) and cuts exactly.
      inputArgs.push('-ss', sourceIn.toFixed(3), '-t', sourceDur.toFixed(3), '-i', inputPath);
    }

    const scaledW = Math.max(2, Math.round(((W * clip.transform.scale) / 100) * (clip.transform.scaleX / 100)));
    const scaledH = Math.max(2, Math.round(((H * clip.transform.scale) / 100) * (clip.transform.scaleY / 100)));

    const chain: string[] = [];
    const { crop } = clip.transform;
    if (crop.left || crop.right || crop.top || crop.bottom) {
      chain.push(
        `crop=iw*${(1 - crop.left - crop.right).toFixed(4)}:ih*${(1 - crop.top - crop.bottom).toFixed(4)}:iw*${crop.left.toFixed(4)}:ih*${crop.top.toFixed(4)}`
      );
    }
    chain.push(`scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease`);
    if (clip.transform.flipH) chain.push('hflip');
    if (clip.transform.flipV) chain.push('vflip');
    if (clip.speed !== 1 && clip.kind === 'video') chain.push(`setpts=(PTS-STARTPTS)/${clampNum(clip.speed, 0.01, 100, 1)}`);
    else chain.push('setpts=PTS-STARTPTS');
    if (clip.reversed) chain.push('reverse');
    chain.push(...gradeFilters(clip, state.adjustments));
    if (settings.applyEffects) chain.push(...effectFilters(clip));
    if (clip.transform.rotation) chain.push(`rotate=${((clip.transform.rotation * Math.PI) / 180).toFixed(5)}:c=none:ow=rotw(${((clip.transform.rotation * Math.PI) / 180).toFixed(5)}):oh=roth(${((clip.transform.rotation * Math.PI) / 180).toFixed(5)})`);
    if (clip.transform.opacity < 100) chain.push(`format=rgba,colorchannelmixer=aa=${(clip.transform.opacity / 100).toFixed(3)}`);
    else chain.push('format=rgba');
    const run = runMembers.get(clip.id);

    if (run) {
      // xfade needs both inputs identical in size, format and rate, so a run
      // member is composited onto the full canvas with its position baked in;
      // the empty area is transparent so a transition on an overlay track still
      // lets the tracks below show through.
      //
      // crop-then-pad, NOT bare pad: a clip scaled past 100% is LARGER than the
      // canvas, and `pad` errors when the input exceeds the target ("not within
      // the padded area") — which failed the whole export. The crop trims any
      // overflow to the canvas (keeping the zoom), and the pad position is
      // clamped so the input always fits, so this never errors regardless of
      // scale or offset. Expressions are single-quoted so their commas are not
      // read as filter separators.
      const px = Math.round(clip.transform.x);
      const py = Math.round(clip.transform.y);
      chain.push(`crop=w='min(iw,${W})':h='min(ih,${H})'`);
      chain.push(
        `pad=w=${W}:h=${H}:x='max(0,min(${W}-iw,(${W}-iw)/2+(${px})))':y='max(0,min(${H}-ih,(${H}-ih)/2+(${py})))':color=#00000000`
      );
      chain.push(`fps=${fps}`);
      chain.push('setpts=PTS-STARTPTS');

      label = `r${inputIndex}`;
      videoChains.push(`[${inputIndex}:v]${chain.join(',')}[${label}]`);
      run.label = label;
    } else {
      // Fade the alpha up so the outgoing clip shows through beneath it.
      if (fadeIn > 0) chain.push(`fade=t=in:alpha=1:st=0:d=${fadeIn.toFixed(3)}`);
      chain.push(`fps=${fps}`);
      chain.push(`setpts=PTS-STARTPTS+${clipStart.toFixed(3)}/TB`);

      label = `v${inputIndex}`;
      videoChains.push(`[${inputIndex}:v]${chain.join(',')}[${label}]`);
      overlayOrder.push({ label, clip, scaledW, scaledH });
    }

    /* ---- this clip's own audio ---- */
    if (clip.kind === 'video' && asset.hasAudio && !clip.audio.muted) {
      audioChains.push(buildAudioChain(inputIndex, clip, clipStart, clipDur, meta.fps));
    }

    inputIndex++;
  }

  /* ---- standalone audio clips ---- */
  for (const clip of active) {
    if (clip.kind !== 'audio' || clip.audio.muted) continue;
    const asset = clip.assetId ? state.assets[clip.assetId] : undefined;
    if (!asset) continue;
    const handle = await getFileHandle(asset);
    if (!handle) continue;

    const name = safeName(asset.name);
    if (!files.some((f) => f.name === name)) files.push(new File([handle], name, { type: handle.type }));

    const clipStart = framesToSeconds(clip.start, meta.fps);
    const clipDur = framesToSeconds(clip.duration, meta.fps);
    inputArgs.push('-ss', framesToSeconds(clip.inPoint, meta.fps).toFixed(3), '-t', (clipDur * clip.speed).toFixed(3), '-i', `/mnt/${name}`);
    audioChains.push(buildAudioChain(inputIndex, clip, clipStart, clipDur, meta.fps));
    inputIndex++;
  }

  /* ---- fold each transition run into one stream ---- */
  //
  // xfade's `offset` is measured from the start of its first input, and each
  // fold makes the accumulator longer, so the offset for clip i is simply
  // where that clip sits on the timeline relative to the head of the run,
  // minus the overlap it shares with its predecessor. Because every incoming
  // clip was pre-rolled by exactly that overlap, the folded stream ends up the
  // same length as the clips it replaces.
  runs.forEach((chain, runId) => {
    const labels = chain.map((c) => runMembers.get(c.id)?.label).filter(Boolean) as string[];
    // A member whose source was unavailable never produced a chain; without
    // every link the run cannot be folded, so leave it to the overlay path.
    if (labels.length !== chain.length || labels.length < 2) return;

    const head = chain[0];
    let acc = labels[0];
    for (let i = 1; i < chain.length; i++) {
      const clip = chain[i];
      const info = incomingTransition.get(clip.id);
      if (!info) return;
      const def = transitionById(info.transitionId);
      const kind = def?.xfade ?? 'fade';
      const offset = Math.max(
        0,
        framesToSeconds(clip.start - head.start, meta.fps) - info.seconds
      );
      const out = `xf${runId}_${i}`;
      videoChains.push(
        `[${acc}][${labels[i]}]xfade=transition=${kind}:duration=${info.seconds.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`
      );
      acc = out;
    }

    const last = chain[chain.length - 1];
    const runStart = framesToSeconds(head.start, meta.fps);
    const positioned = `run${runId}`;
    videoChains.push(`[${acc}]setpts=PTS-STARTPTS+${runStart.toFixed(3)}/TB[${positioned}]`);

    // The run occupies the whole span of its members, positioned at the head.
    overlayOrder.push({
      label: positioned,
      clip: { ...head, duration: last.start + last.duration - head.start, transform: { ...head.transform, x: 0, y: 0 } },
      scaledW: W,
      scaledH: H,
    });
  });

  /* ---- assemble the graph ---- */
  // Overlay order is z-order, and folded runs were appended after everything
  // else — so restore track order or a run on a low track would cover the
  // tracks above it. Array.sort is stable, so clips within a track keep the
  // order they were emitted in.
  overlayOrder.sort((a, b) => (tracks.get(a.clip.trackId) ?? 0) - (tracks.get(b.clip.trackId) ?? 0));

  const parts: string[] = [...videoChains];
  let current = `${baseIndex}:v`;
  overlayOrder.forEach((entry, i) => {
    const { clip, scaledW, scaledH } = entry;
    const x = Math.round((W - scaledW) / 2 + clip.transform.x);
    const y = Math.round((H - scaledH) / 2 + clip.transform.y);
    const start = framesToSeconds(clip.start, meta.fps);
    const end = framesToSeconds(clip.start + clip.duration, meta.fps);
    const out = i === overlayOrder.length - 1 ? 'vout' : `ov${i}`;
    const pos = clip.kind === 'text' || clip.kind === 'sticker' ? 'x=0:y=0' : `x=${x}:y=${y}`;
    parts.push(`[${current}][${entry.label}]overlay=${pos}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':eof_action=pass[${out}]`);
    current = out;
  });
  if (overlayOrder.length === 0) parts.push(`[${current}]null[vout]`);

  parts.push(...audioChains.map((c) => c.chain));
  const audioLabels = audioChains.map((c) => `[${c.label}]`);
  if (audioLabels.length > 1) {
    parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0[aout]`);
  } else if (audioLabels.length === 1) {
    parts.push(`${audioLabels[0]}anull[aout]`);
  }

  const filterComplex = parts.join(';');

  /* ---- output args ---- */
  const outName = `export.${settings.format}`;
  const args: string[] = ['-hide_banner', '-loglevel', 'error', ...inputArgs, '-filter_complex', filterComplex];

  if (settings.audioOnly) {
    if (audioLabels.length === 0) return { savedPath: null, cancelled: false, error: 'No audio to export' };
    args.push('-map', '[aout]');
  } else {
    args.push('-map', '[vout]');
    if (audioLabels.length) args.push('-map', '[aout]');
  }

  switch (settings.format) {
    case 'webm':
      args.push('-c:v', 'libvpx-vp9', '-crf', String(CRF[settings.quality]), '-b:v', '0', '-c:a', 'libopus', '-b:a', `${settings.audioBitrate}k`);
      break;
    case 'gif':
      args.push('-vf', `fps=${Math.min(fps, 20)},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-an');
      break;
    case 'mp3':
      args.push('-vn', '-c:a', 'libmp3lame', '-b:a', `${settings.audioBitrate}k`);
      break;
    case 'wav':
      args.push('-vn', '-c:a', 'pcm_s16le');
      break;
    default:
      args.push(
        '-c:v', 'libx264',
        '-preset', PRESET[settings.quality],
        '-crf', String(CRF[settings.quality]),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', `${settings.audioBitrate}k`
      );
  }
  args.push('-r', String(fps), '-t', durationSeconds.toFixed(3), '-y', outName);

  /* ---- run ---- */
  onProgress({
    stage: 'Rendering',
    detail: `${overlayOrder.length} layers · ${durationSeconds.toFixed(1)}s · ${useNative ? 'native ffmpeg' : 'WebAssembly'}`,
    value: 0,
  });

  const started = performance.now();

  if (useNative && native) {
    return runNative(native, args, outName, writes, settings, meta.name, durationSeconds, started, onProgress);
  }

  try {
    const data = await ffmpegClient.run(args, outName, {
      files,
      writes,
      onProgress: (value) => {
        const elapsed = (performance.now() - started) / 1000;
        const remaining = value > 0.02 ? Math.round(elapsed / value - elapsed) : null;
        onProgress({
          stage: 'Rendering',
          detail: remaining !== null ? `${Math.round(value * 100)}% — about ${remaining}s left` : 'Starting…',
          value,
        });
      },
      onLog: (log) => onProgress({ stage: 'Rendering', detail: '', value: -1, log }),
    });

    onProgress({ stage: 'Saving', detail: 'Writing file', value: 1 });
    const savedPath = await platform.saveFile(new Blob([asBlobPart(data)], { type: mimeFor(settings.format) }), {
      defaultFilename: `${meta.name.replace(/[^\w-]/g, '_')}.${settings.format}`,
      filters: [{ name: settings.format.toUpperCase(), extensions: [settings.format] }],
    });

    return { savedPath, cancelled: savedPath === null };
  } catch (err) {
    return { savedPath: null, cancelled: false, error: (err as Error).message };
  }
}

/** Job id of the render currently in flight, so the modal can stop it. */
let activeNativeJob: string | null = null;

export async function cancelNativeExport(): Promise<boolean> {
  if (!activeNativeJob) return false;
  const native = await platform.nativeFFmpeg();
  if (!native) return false;
  return native.cancel(activeNativeJob);
}

/**
 * Render with the native binary.
 *
 * Output is written straight to the file the user picked — there is no
 * intermediate copy through memory, which for a 4K export is the difference
 * between working and running the tab out of heap.
 */
async function runNative(
  native: NonNullable<Awaited<ReturnType<typeof platform.nativeFFmpeg>>>,
  args: string[],
  outName: string,
  writes: { name: string; data: Uint8Array }[],
  settings: ExportSettings,
  projectName: string,
  durationSeconds: number,
  started: number,
  onProgress: (p: ExportProgress) => void
): Promise<ExportResult> {
  // Ask for the destination without creating anything: ffmpeg writes it.
  const savePath = await platform.pickSavePath({
    defaultFilename: `${projectName.replace(/[^\w-]/g, '_')}.${settings.format}`,
    filters: [{ name: settings.format.toUpperCase(), extensions: [settings.format] }],
  });
  if (!savePath) return { savedPath: null, cancelled: true };

  // The placeholder output name becomes the real destination path.
  const finalArgs = args.map((a) => (a === outName ? savePath : a));

  const jobId = `export-${Date.now()}`;
  activeNativeJob = jobId;

  const stopLog = native.onLog(({ jobId: id, text }) => {
    if (id !== jobId) return;
    for (const line of text.split(/[\r\n]+/)) {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (!m) {
        if (line.trim()) onProgress({ stage: 'Rendering', detail: '', value: -1, log: line });
        continue;
      }
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const value = Math.max(0, Math.min(1, seconds / durationSeconds));
      const elapsed = (performance.now() - started) / 1000;
      const remaining = value > 0.02 ? Math.round(elapsed / value - elapsed) : null;
      const speed = /speed=\s*([\d.]+)x/.exec(line)?.[1];
      onProgress({
        stage: 'Rendering',
        detail: [
          `${Math.round(value * 100)}%`,
          speed ? `${speed}x realtime` : null,
          remaining !== null ? `about ${remaining}s left` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        value,
      });
    }
  });

  try {
    const { code, stderr, cancelled } = await native.run(jobId, finalArgs, writes);
    if (cancelled) return { savedPath: null, cancelled: true };
    if (code !== 0) {
      // The tail of stderr is where ffmpeg puts the actual reason.
      const reason = stderr.split(/[\r\n]+/).filter(Boolean).slice(-4).join(' ');
      return { savedPath: null, cancelled: false, error: reason || `ffmpeg exited with code ${code}` };
    }
    return { savedPath: savePath, cancelled: false };
  } finally {
    stopLog();
    activeNativeJob = null;
  }
}

function buildAudioChain(
  inputIndex: number,
  clip: Clip,
  clipStart: number,
  clipDur: number,
  projectFps: number
): { chain: string; label: string } {
  const label = `a${inputIndex}`;
  const parts: string[] = ['asetpts=PTS-STARTPTS'];

  // atempo only accepts 0.5–2.0, so a big speed change has to be chained.
  // Clamp first: speed 0 loops forever (0/2 === 0), and a negative or Infinity
  // speed never converges — an unbounded loop that hangs the render before
  // ffmpeg even starts. The UI limits speed to 0.1–10; this guards tampered
  // state and anything that bypasses the slider.
  const speed = clampNum(clip.speed, 0.01, 100, 1);
  if (speed !== 1) {
    let remaining = speed;
    while (remaining > 2) {
      parts.push('atempo=2.0');
      remaining /= 2;
    }
    while (remaining < 0.5) {
      parts.push('atempo=0.5');
      remaining *= 2;
    }
    parts.push(`atempo=${remaining.toFixed(4)}`);
  }
  if (clip.reversed) parts.push('areverse');

  const gain = Math.pow(10, clip.audio.volumeDb / 20);
  if (Math.abs(gain - 1) > 0.001) parts.push(`volume=${gain.toFixed(4)}`);

  const fadeIn = framesToSeconds(clip.audio.fadeInFrames, projectFps);
  const fadeOut = framesToSeconds(clip.audio.fadeOutFrames, projectFps);
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);

  if (clip.audio.pan !== 0) {
    const p = clip.audio.pan / 100;
    const l = (1 - Math.max(0, p)).toFixed(3);
    const r = (1 + Math.min(0, p)).toFixed(3);
    parts.push(`pan=stereo|c0=${l}*c0|c1=${r}*c1`);
  }

  for (const fx of clip.audio.effects) {
    if (!fx.enabled) continue;
    switch (fx.kind) {
      case 'echo':
        parts.push(`aecho=0.8:0.9:${Math.round(Number(fx.params.delay ?? 250))}:${(Number(fx.params.feedback ?? 35) / 100).toFixed(2)}`);
        break;
      case 'reverb':
        parts.push(`aecho=0.8:0.88:60|110|190:${(Number(fx.params.mix ?? 25) / 200).toFixed(2)}|${(Number(fx.params.mix ?? 25) / 300).toFixed(2)}|${(Number(fx.params.mix ?? 25) / 400).toFixed(2)}`);
        break;
      case 'eq':
        parts.push(`equalizer=f=120:t=h:w=200:g=${Number(fx.params.low ?? 0)}`);
        parts.push(`equalizer=f=1000:t=q:w=1:g=${Number(fx.params.mid ?? 0)}`);
        parts.push(`equalizer=f=8000:t=h:w=4000:g=${Number(fx.params.high ?? 0)}`);
        break;
      case 'compressor':
        parts.push(`acompressor=threshold=${Math.pow(10, Number(fx.params.threshold ?? -18) / 20).toFixed(4)}:ratio=${Number(fx.params.ratio ?? 4)}`);
        break;
      case 'pitch':
      case 'voice': {
        const semitones = Number(fx.params.semitones ?? fx.params.pitch ?? 0);
        if (semitones === 0) break;
        const ratio = Math.pow(2, semitones / 12);
        // asetrate shifts pitch and speed together; atempo puts the speed back.
        parts.push(`asetrate=44100*${ratio.toFixed(4)}`, `aresample=44100`, `atempo=${(1 / ratio).toFixed(4)}`);
        break;
      }
    }
  }

  parts.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
  if (clipStart > 0) {
    const ms = Math.round(clipStart * 1000);
    parts.push(`adelay=${ms}|${ms}`);
  }

  return { chain: `[${inputIndex}:a]${parts.join(',')}[${label}]`, label };
}

const mimeFor = (format: ExportFormat): string =>
  ({
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
  })[format];

export { esc };
