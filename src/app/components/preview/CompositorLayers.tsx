import { useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import type { Clip, ColorGrade, GlobalAdjustments, Transform } from '../../../types/project';
import { resolveClipAt } from '../../../engine/keyframes';
import { layerTransformCss, naturalLayerSize } from '../../../engine/layerGeometry';
import { stickerById, stickerDataUrl } from '../../../engine/libraries';
import { effectCss } from '../../../engine/effects';
import { playback } from '../../../engine/playback';
import { transitionStyles } from '../../../engine/transitionCss';

/**
 * Composites everything that is not the video element itself: images, text and
 * stickers, plus the transform/grade applied to the active video.
 *
 * React renders the layer *structure* only — it re-renders when clips change,
 * never per frame. A single rAF loop writes styles straight to the DOM nodes so
 * keyframed transforms animate during playback with zero React work.
 */
export function CompositorLayers({
  frame,
  scale,
  projectWidth,
  projectHeight,
}: {
  frame: number;
  scale: number;
  projectWidth: number;
  projectHeight: number;
}) {
  const state = useEditorStore((s) => s.state);
  const selection = useUIStore((s) => s.selection);
  const hostRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  /** Visual clips that this component owns, back to front. */
  const layers = useMemo(() => {
    const order = new Map(state.tracks.map((t, i) => [t.id, state.tracks.length - i]));
    return Object.values(state.clips)
      .filter((c) => c.kind === 'image' || c.kind === 'text' || c.kind === 'sticker')
      .filter((c) => {
        const track = state.tracks.find((t) => t.id === c.trackId);
        return c.enabled && track && !track.hidden;
      })
      .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  }, [state.clips, state.tracks]);

  const videoGrade = useMemo(() => {
    const order = new Map(state.tracks.map((t, i) => [t.id, state.tracks.length - i]));
    return Object.values(state.clips)
      .filter((c) => c.kind === 'video')
      // Same visibility test the engine composition uses. Without it a hidden
      // overlay-track video stayed in this list, shadowed the real active clip
      // (find() picks the topmost match), and the preview went black.
      .filter((c) => {
        const track = state.tracks.find((t) => t.id === c.trackId);
        return c.enabled && track && !track.hidden;
      })
      .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0));
  }, [state.clips, state.tracks]);

  /* ---------- per-frame style pass (no React) ---------- */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const f = playback.currentFrame;

      for (const clip of layers) {
        const node = nodes.current.get(clip.id);
        if (!node) continue;
        const live = f >= clip.start && f < clip.start + clip.duration;
        node.style.display = live ? 'block' : 'none';
        if (!live) continue;
        applyLayerStyle(node, clip, f, scale, projectWidth, projectHeight, state.adjustments);
      }

      // The <video> elements get the same treatment.
      //
      // There are two of them (an A/B pair), and during a transition BOTH are
      // on screen showing different clips. So each is styled from whichever
      // clip it is actually holding — `dataset.clipId`, set by the engine —
      // rather than from a single "active" clip, and the transition's own
      // blend is layered on top of that clip's transform and grade.
      const host = hostRef.current?.parentElement;
      if (host) {
        const trans = playback.currentTransition();
        const active = videoGrade.find((c) => f >= c.start && f < c.start + c.duration);
        const videos = host.querySelectorAll<HTMLVideoElement>('.preview-video');

        for (const v of videos) {
          const heldId = v.dataset.clipId;
          const role = !trans ? null : heldId === trans.inClipId ? 'in' : heldId === trans.outClipId ? 'out' : null;

          // Only two things are ever on screen: the clip the engine made
          // active, and — during a transition — its partner. The other element
          // is preloading the next cut and must stay hidden, or the upcoming
          // clip flashes over the current one.
          const visible = role !== null || (!!active && heldId === active.id);
          const clip = role ? videoGrade.find((c) => c.id === heldId) ?? null : active ?? null;
          if (!clip || !visible) {
            v.style.opacity = '0';
            v.style.filter = '';
            v.style.transform = '';
            v.style.clipPath = '';
            continue;
          }

          const { transform, color } = resolveClipAt(clip, f);
          // The <video> already fills the canvas via inset:0, so it must NOT
          // take the -50% centring pull — and its translation is in project
          // pixels, so it scales by `scale` exactly like every other layer.
          // Passing 1 here made the video move at a different rate to its own
          // selection handles.
          const base = layerTransformCss(transform, scale, false);
          const grade = gradeToFilter(color, clip, state.adjustments);
          const crop = cropToClipPath(transform);

          if (role) {
            const st = transitionStyles(trans!.transitionId, trans!.t)[role === 'in' ? 'incoming' : 'outgoing'];
            // The transition composes with the clip's own look rather than
            // replacing it, so grading does not pop off across the seam.
            v.style.transform = st.transform ? `${base} ${st.transform}` : base;
            v.style.opacity = String((transform.opacity / 100) * st.opacity);
            v.style.filter = st.filter ? `${grade} ${st.filter}` : grade;
            // A transition shape replaces the crop; a crop only survives when
            // the transition does not need the clip-path itself.
            v.style.clipPath = st.clipPath || crop;
            // Hinged transitions (cube, fold, page turn) pivot on an edge.
            v.style.transformOrigin = st.transformOrigin;
          } else {
            v.style.transform = base;
            v.style.opacity = String(transform.opacity / 100);
            v.style.filter = grade;
            v.style.clipPath = crop;
            v.style.transformOrigin = '';
          }
          v.style.mixBlendMode = transform.blendMode === 'normal' ? 'normal' : transform.blendMode;
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layers, videoGrade, scale, projectWidth, projectHeight, state.adjustments]);

  return (
    <div className="compositor" ref={hostRef}>
      {layers.map((clip) => (
        <div
          key={clip.id}
          className={`comp-layer${selection.includes(clip.id) ? ' is-selected' : ''}`}
          ref={(el) => {
            if (el) nodes.current.set(clip.id, el);
            else nodes.current.delete(clip.id);
          }}
          // Lets the selection overlay measure text layers, which have no
          // intrinsic project-space size.
          data-clip-id={clip.id}
          data-frame={frame}
        >
          <LayerContent clip={clip} scale={scale} />
        </div>
      ))}
    </div>
  );
}

function LayerContent({ clip, scale }: { clip: Clip; scale: number }) {
  const assets = useEditorStore((s) => s.state.assets);

  if (clip.kind === 'image') {
    const asset = clip.assetId ? assets[clip.assetId] : null;
    return asset ? <img className="comp-image" src={asset.url} alt="" draggable={false} /> : null;
  }

  if (clip.kind === 'sticker') {
    const sticker = clip.stickerId ? stickerById(clip.stickerId) : null;
    return sticker ? <img className="comp-sticker" src={stickerDataUrl(sticker)} alt="" draggable={false} /> : null;
  }

  const t = clip.text;
  if (!t) return null;

  const style: React.CSSProperties = {
    fontFamily: `'${t.fontFamily}', var(--font-body)`,
    fontSize: t.fontSize * scale,
    fontWeight: t.fontWeight,
    color: t.color,
    textAlign: t.align,
    letterSpacing: t.letterSpacing * scale,
    lineHeight: t.lineHeight,
    WebkitTextStroke: t.outline.enabled ? `${t.outline.width * scale}px ${t.outline.color}` : undefined,
    textShadow: t.shadow.enabled
      ? `${t.shadow.x * scale}px ${t.shadow.y * scale}px ${t.shadow.blur * scale}px ${t.shadow.color}`
      : undefined,
    background: t.background.enabled ? t.background.color : undefined,
    padding: t.background.enabled ? `${t.background.padding * 0.35 * scale}px ${t.background.padding * scale}px` : undefined,
    borderRadius: t.background.enabled ? t.background.radius * scale : undefined,
    ...(t.gradient.enabled
      ? {
          backgroundImage: `linear-gradient(${t.gradient.angle}deg, ${t.gradient.from}, ${t.gradient.to})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }
      : {}),
  };

  return (
    <div className="comp-text" style={style}>
      {t.content.split('\n').map((line, i) => (
        <div key={i}>{line || ' '}</div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Style maths
 * ------------------------------------------------------------------ */

function applyLayerStyle(
  node: HTMLDivElement,
  clip: Clip,
  frame: number,
  scale: number,
  projectWidth: number,
  projectHeight: number,
  adjustments: GlobalAdjustments
) {
  const { transform, color } = resolveClipAt(clip, frame);
  node.style.left = '50%';
  node.style.top = '50%';
  // Layer divs are anchored at the centre, so they take the -50% pull.
  node.style.transform = layerTransformCss(transform, scale, true);
  node.style.opacity = String(transform.opacity / 100);
  node.style.filter = gradeToFilter(color, clip, adjustments);
  node.style.mixBlendMode = transform.blendMode === 'normal' ? 'normal' : transform.blendMode;

  if (clip.kind !== 'text') {
    // Natural size comes from the shared geometry module so the selection
    // handles land on exactly this box. Text sizes itself to its glyphs.
    const natural = naturalLayerSize(clip.kind, projectWidth, projectHeight);
    node.style.width = `${natural.w * scale}px`;
    node.style.height = `${natural.h * scale}px`;
  }
}

function cropToClipPath(t: Transform): string {
  const { left, top, right, bottom } = t.crop;
  if (!left && !top && !right && !bottom) return '';
  return `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`;
}

/**
 * Grade -> CSS filter.
 *
 * This is the real-time approximation the preview uses; export runs the same
 * values through ffmpeg's colour filters, which are the authority. Values that
 * CSS cannot express (curves, wheels, HSL bands, LUTs) are applied at export
 * only until the WebGL grading pass lands.
 */
function gradeToFilter(color: ColorGrade, clip: Clip, adjustments: GlobalAdjustments): string {
  const exposure = color.exposure + adjustments.exposure;
  const contrast = color.contrast + adjustments.contrast;
  const saturation = color.saturation + adjustments.saturation;
  const temperature = color.temperature + adjustments.temperature;

  const filters: string[] = [];
  if (exposure) filters.push(`brightness(${(1 + exposure / 150).toFixed(3)})`);
  if (contrast) filters.push(`contrast(${(1 + contrast / 130).toFixed(3)})`);
  if (saturation || color.vibrance) filters.push(`saturate(${(1 + (saturation + color.vibrance * 0.6) / 110).toFixed(3)})`);
  if (temperature) filters.push(`sepia(${Math.min(0.6, Math.abs(temperature) / 220).toFixed(3)})`);
  if (color.tint) filters.push(`hue-rotate(${(color.tint / 6).toFixed(1)}deg)`);

  // Effects preview through the shared CSS builders, so the whole library
  // participates rather than the seven that used to be hardcoded here.
  for (const inst of clip.effects) {
    if (!inst.enabled) continue;
    const params = Object.fromEntries(Object.entries(inst.params).map(([k, v]) => [k, Number(v)]));
    const css = effectCss(inst.effectId, params);
    if (css) filters.push(css);
  }

  return filters.join(' ');
}
