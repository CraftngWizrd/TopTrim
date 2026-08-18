import { useCallback, useMemo, useRef } from 'react';
import type { Clip } from '../../../types/project';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { resolveClipAt } from '../../../engine/keyframes';
import {
  applyScale,
  cropOffsetScreen,
  layerScreenSize,
  selectionBoxTransformCss,
} from '../../../engine/layerGeometry';
import { clamp } from '../../../engine/time';

/**
 * Direct manipulation on the preview canvas: drag to move, corners and edges to
 * resize, and a handle above the box to rotate.
 *
 * Everything writes through the same store paths the properties panel uses, so
 * a drag here and a slider there produce identical results — and both land as
 * one undo step because the gesture is bracketed.
 *
 * Holding Shift while resizing a corner keeps the aspect ratio; Alt resizes
 * about the centre.
 */

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'body';

const HANDLES: { id: HandleId; x: number; y: number; className: string }[] = [
  { id: 'nw', x: 0, y: 0, className: 'selection-handle-corner' },
  { id: 'n', x: 0.5, y: 0, className: 'selection-handle-edge-h' },
  { id: 'ne', x: 1, y: 0, className: 'selection-handle-corner-alt' },
  { id: 'e', x: 1, y: 0.5, className: 'selection-handle-edge-v' },
  { id: 'se', x: 1, y: 1, className: 'selection-handle-corner' },
  { id: 's', x: 0.5, y: 1, className: 'selection-handle-edge-h' },
  { id: 'sw', x: 0, y: 1, className: 'selection-handle-corner-alt' },
  { id: 'w', x: 0, y: 0.5, className: 'selection-handle-edge-v' },
];

export function SelectionOverlay({
  frame,
  scale,
  projectWidth,
  projectHeight,
}: {
  /** Current playhead frame — keyframed transforms follow it. */
  frame: number;
  /** Project pixels -> screen pixels. */
  scale: number;
  projectWidth: number;
  projectHeight: number;
}) {
  const selection = useUIStore((s) => s.selection);
  const cropMode = useUIStore((s) => s.cropMode);
  const clips = useEditorStore((s) => s.state.clips);
  const editor = useEditorStore();
  const dragging = useRef(false);

  const clip: Clip | null = selection.length === 1 ? clips[selection[0]] ?? null : null;
  const live = !!clip && frame >= clip.start && frame < clip.start + clip.duration;
  const transform = useMemo(() => (clip ? resolveClipAt(clip, frame).transform : null), [clip, frame]);

  const beginEdit = useCallback(() => {
    if (dragging.current) return;
    dragging.current = true;
    editor.beginGesture();
  }, [editor]);

  const endEdit = useCallback(
    (label: string) => {
      if (!dragging.current) return;
      dragging.current = false;
      editor.endGesture(label);
      useUIStore.getState().setDraggingKind(null);
    },
    [editor]
  );

  const startDrag = useCallback(
    (handle: HandleId) => (e: React.PointerEvent) => {
      if (!clip || !transform || scale <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;

      // Untransformed size in PROJECT pixels, captured once. Measuring at 100%
      // and dividing out the fit scale handles text (DOM-measured) and stickers
      // (a fraction of the frame) with the same code path as video.
      const naturalScreen = layerScreenSize(
        clip,
        { ...transform, scale: 100, scaleX: 100, scaleY: 100 },
        scale,
        projectWidth,
        projectHeight
      );
      const naturalProject = { w: naturalScreen.w / scale, h: naturalScreen.h / scale };

      const origin = {
        x: transform.x,
        y: transform.y,
        scale: transform.scale,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        rotation: transform.rotation,
        crop: { ...transform.crop },
      };

      // Screen centre of the box, needed for rotation maths.
      const rect = (e.currentTarget as HTMLElement).closest('.preview-canvas')!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 + origin.x * scale;
      const cy = rect.top + rect.height / 2 + origin.y * scale;
      const startAngle = Math.atan2(startY - cy, startX - cx);

      beginEdit();
      useUIStore.getState().setDraggingKind(handle === 'body' ? 'clip' : 'trim');

      const move = (ev: PointerEvent) => {
        // Work in project pixels so the result is resolution-independent.
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;

        editor.update((d) => {
          const c = d.clips[clip.id];
          if (!c) return;

          if (handle === 'body') {
            c.transform.x = Math.round(origin.x + dx);
            c.transform.y = Math.round(origin.y + dy);
            return;
          }

          /*
           * Crop mode: the handles trim the picture instead of resizing it,
           * writing straight into transform.crop.* so the Crop sliders in the
           * properties panel move with the drag. Previously the canvas only
           * ever changed scale, which is why the crop values never budged.
           */
          if (cropMode) {
            const box = applyScale(naturalProject, origin);
            // Pointer delta as a fraction of the layer's own size.
            const fx = box.w > 0 ? dx / box.w : 0;
            const fy = box.h > 0 ? dy / box.h : 0;
            const crop = { ...origin.crop };

            // Opposite edges may never meet: leave at least 2% of the picture.
            if (handle.includes('w')) crop.left = clamp(origin.crop.left + fx, 0, 0.98 - origin.crop.right);
            if (handle.includes('e')) crop.right = clamp(origin.crop.right - fx, 0, 0.98 - origin.crop.left);
            if (handle.includes('n')) crop.top = clamp(origin.crop.top + fy, 0, 0.98 - origin.crop.bottom);
            if (handle.includes('s')) crop.bottom = clamp(origin.crop.bottom - fy, 0, 0.98 - origin.crop.top);

            c.transform.crop = crop;
            return;
          }

          if (handle === 'rotate') {
            const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
            let deg = origin.rotation + ((angle - startAngle) * 180) / Math.PI;
            // Shift snaps to 15° increments.
            if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
            c.transform.rotation = Math.round(((deg + 540) % 360) - 180);
            return;
          }

          const boxW = naturalProject.w * (origin.scale / 100) * (origin.scaleX / 100);
          const boxH = naturalProject.h * (origin.scale / 100) * (origin.scaleY / 100);

          const pullsRight = handle.includes('e');
          const pullsLeft = handle.includes('w');
          const pullsDown = handle.includes('s');
          const pullsUp = handle.includes('n');

          // How much the box grows on each axis, in project pixels.
          const growX = pullsRight ? dx : pullsLeft ? -dx : 0;
          const growY = pullsDown ? dy : pullsUp ? -dy : 0;

          const isCorner = (pullsLeft || pullsRight) && (pullsUp || pullsDown);
          // Corners keep the aspect ratio unless Shift is held; edges never do.
          const uniform = isCorner && !ev.shiftKey;

          if (uniform) {
            const ratio = clamp(1 + (growX / Math.max(boxW, 1) + growY / Math.max(boxH, 1)) / 2, 0.02, 40);
            c.transform.scale = clamp(Math.round(origin.scale * ratio), 1, 4000);
            c.transform.scaleX = origin.scaleX;
            c.transform.scaleY = origin.scaleY;
          } else {
            if (pullsLeft || pullsRight) {
              c.transform.scaleX = clamp(Math.round(origin.scaleX * (1 + growX / Math.max(boxW, 1))), 1, 4000);
            }
            if (pullsUp || pullsDown) {
              c.transform.scaleY = clamp(Math.round(origin.scaleY * (1 + growY / Math.max(boxH, 1))), 1, 4000);
            }
          }

          // Alt resizes about the centre; otherwise the opposite edge stays put,
          // which means the centre has to move by half the growth.
          if (!ev.altKey) {
            const newW = naturalProject.w * (c.transform.scale / 100) * (c.transform.scaleX / 100);
            const newH = naturalProject.h * (c.transform.scale / 100) * (c.transform.scaleY / 100);
            c.transform.x = Math.round(origin.x + ((newW - boxW) / 2) * (pullsRight ? 1 : pullsLeft ? -1 : 0));
            c.transform.y = Math.round(origin.y + ((newH - boxH) / 2) * (pullsDown ? 1 : pullsUp ? -1 : 0));
          }
        });
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        endEdit(
          handle === 'body'
            ? 'Move layer'
            : handle === 'rotate'
              ? 'Rotate layer'
              : cropMode
                ? 'Crop layer'
                : 'Resize layer'
        );
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [beginEdit, clip, cropMode, editor, endEdit, projectHeight, projectWidth, scale, transform]
  );

  if (!clip || !transform || !live || scale <= 0) return null;

  // Same geometry the compositor used to place the content itself.
  const screen = layerScreenSize(clip, transform, scale, projectWidth, projectHeight);
  const cropShift = cropOffsetScreen(clip, transform, scale, projectWidth, projectHeight);

  const style: React.CSSProperties = {
    width: screen.w,
    height: screen.h,
    // An uneven crop moves the visible centre; the box follows it so the
    // handles stay on the picture rather than out in the trimmed-away area.
    transform: `${selectionBoxTransformCss(transform, scale)} translate(${-cropShift.x}px, ${-cropShift.y}px)`,
  };

  return (
    <div className={`selection-box${cropMode ? ' is-crop' : ''}`} style={style} onPointerDown={startDrag('body')}>
      <div className="selection-outline" />
      {cropMode && <div className="selection-thirds" />}

      {/* Rotation is a transform, not a crop, so it is hidden in crop mode. */}
      {!cropMode && (
        <>
          <div className="selection-rotate-arm" />
          <div
            className="selection-handle selection-handle-rotate"
            style={{ left: '50%', top: -26 }}
            onPointerDown={startDrag('rotate')}
            title="Drag to rotate · hold Shift for 15° steps"
          />
        </>
      )}

      {HANDLES.map((h) => (
        <div
          key={h.id}
          className={`selection-handle ${h.className}`}
          style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
          onPointerDown={startDrag(h.id)}
          title={
            cropMode
              ? 'Drag to crop this edge'
              : h.id.length === 2
                ? 'Drag to resize · Shift for free ratio · Alt from centre'
                : 'Drag to stretch this edge'
          }
        />
      ))}

      <div className="selection-readout mono">
        {cropMode
          ? `crop ${Math.round(transform.crop.left * 100)}/${Math.round(transform.crop.right * 100)}/${Math.round(transform.crop.top * 100)}/${Math.round(transform.crop.bottom * 100)}%`
          : `${Math.round(transform.scale)}% · ${Math.round(transform.rotation)}°`}
      </div>
    </div>
  );
}
