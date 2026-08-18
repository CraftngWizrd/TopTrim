import type { Clip, ClipKind, Transform } from '../types/project';

/**
 * Single source of truth for where a layer sits on the preview canvas.
 *
 * The compositor (which positions the real video/image/text elements) and the
 * selection overlay (which draws the handles) MUST agree exactly, or the
 * handles float away from the content they claim to control. Both read their
 * geometry from here so they cannot drift apart again.
 *
 * TWO COORDINATE SPACES, and the difference is the whole point:
 *
 *   project px — what `transform.x/y` and clip sizes are stored in. Resolution
 *                independent, identical to what the export pipeline uses.
 *   screen px  — what the DOM needs. `fitScale` converts: the preview canvas is
 *                the project frame scaled down to fit the monitor area.
 *
 * A translation of `transform.x` project pixels is `transform.x * fitScale`
 * screen pixels. Getting that conversion wrong on one side and not the other is
 * exactly how the handles end up moving at a different rate to the video.
 */

/** Stickers are drawn at a fraction of the frame, matching the export rasteriser. */
export const STICKER_FRACTION = 0.3;

export interface Size {
  w: number;
  h: number;
}

/** Untransformed size of a layer, in PROJECT pixels. */
export function naturalLayerSize(kind: ClipKind, projectWidth: number, projectHeight: number): Size {
  if (kind === 'sticker') {
    const s = Math.min(projectWidth, projectHeight) * STICKER_FRACTION;
    return { w: s, h: s };
  }
  // Video and images fill the frame; the export pipeline scales from the same
  // baseline, so 100% here means 100% there.
  return { w: projectWidth, h: projectHeight };
}

/**
 * Apply the clip's scale to a natural size. Flips do not change the box.
 * Takes only the scale fields so a drag's captured origin can be passed
 * directly without reconstructing a whole Transform.
 */
export type ScaleFields = Pick<Transform, 'scale' | 'scaleX' | 'scaleY'>;
export type CropFields = Pick<Transform, 'crop'>;

export function applyScale(natural: Size, t: ScaleFields): Size {
  return {
    w: natural.w * (t.scale / 100) * (t.scaleX / 100),
    h: natural.h * (t.scale / 100) * (t.scaleY / 100),
  };
}

/** Fraction of the frame still visible after cropping, per axis. */
export function cropFactor(t: CropFields): Size {
  return {
    w: Math.max(0.01, 1 - t.crop.left - t.crop.right),
    h: Math.max(0.01, 1 - t.crop.top - t.crop.bottom),
  };
}

/**
 * Where the cropped content's centre sits relative to the layer's centre, in
 * project pixels. Cropping unevenly (say only from the left) moves the visible
 * middle, and the handles have to follow it or they drift off the picture.
 */
export function cropCentreOffset(natural: Size, t: ScaleFields & CropFields): { x: number; y: number } {
  const scaled = applyScale(natural, t);
  return {
    x: ((t.crop.left - t.crop.right) / 2) * scaled.w,
    y: ((t.crop.top - t.crop.bottom) / 2) * scaled.h,
  };
}

/**
 * On-screen box of a layer, in SCREEN pixels.
 *
 * Text has no intrinsic project-space size — it is whatever the glyphs measure —
 * so its untransformed box is read from the live DOM node instead. `offsetWidth`
 * is used rather than `getBoundingClientRect` because the latter returns the
 * post-transform bounding box, which would compound the scale we are about to
 * apply.
 */
export function layerScreenSize(
  clip: Clip,
  transform: Transform,
  fitScale: number,
  projectWidth: number,
  projectHeight: number
): Size {
  if (clip.kind === 'text') {
    const node = document.querySelector<HTMLElement>(`.comp-layer[data-clip-id="${clip.id}"]`);
    const base: Size = node
      ? { w: node.offsetWidth, h: node.offsetHeight }
      : { w: projectWidth * fitScale, h: projectHeight * fitScale };
    const scaled = applyScale(base, transform);
    return scaled;
  }

  const natural = naturalLayerSize(clip.kind, projectWidth, projectHeight);
  const scaled = applyScale(natural, transform);
  // The box must track the VISIBLE picture, not the uncropped source, or the
  // handles sit out in the cropped-away area.
  const crop = cropFactor(transform);
  return { w: scaled.w * crop.w * fitScale, h: scaled.h * crop.h * fitScale };
}

/** Screen-space offset of the selection box caused by an uneven crop. */
export function cropOffsetScreen(
  clip: Clip,
  transform: Transform,
  fitScale: number,
  projectWidth: number,
  projectHeight: number
): { x: number; y: number } {
  if (clip.kind === 'text' || clip.kind === 'sticker') return { x: 0, y: 0 };
  const natural = naturalLayerSize(clip.kind, projectWidth, projectHeight);
  const offset = cropCentreOffset(natural, transform);
  return { x: offset.x * fitScale, y: offset.y * fitScale };
}

/**
 * CSS transform for a layer.
 *
 * `centered` is true for elements anchored at `left:50%; top:50%` (the
 * compositor's absolutely-positioned layer divs and the selection box), which
 * need the -50% pull to sit on their own centre. It is false for the <video>
 * elements, which already fill the canvas via `inset: 0` — giving those the
 * -50% shifts them half a frame up and left, which is a constant, very visible
 * offset.
 */
export function layerTransformCss(t: Transform, fitScale: number, centered: boolean): string {
  const parts: string[] = [];
  if (centered) parts.push('translate(-50%, -50%)');
  parts.push(`translate(${t.x * fitScale}px, ${t.y * fitScale}px)`);
  parts.push(`rotate(${t.rotation}deg)`);
  parts.push(
    `scale(${(t.scale / 100) * (t.scaleX / 100) * (t.flipH ? -1 : 1)}, ${(t.scale / 100) * (t.scaleY / 100) * (t.flipV ? -1 : 1)})`
  );
  return parts.join(' ');
}

/**
 * Transform for the selection box.
 *
 * The box's width/height already include the scale, so it must NOT also apply
 * `scale()` — doing both would square the factor. Flips are ignored too: a
 * mirrored clip still has handles the right way round.
 */
export function selectionBoxTransformCss(t: Transform, fitScale: number): string {
  return `translate(-50%, -50%) translate(${t.x * fitScale}px, ${t.y * fitScale}px) rotate(${t.rotation}deg)`;
}
