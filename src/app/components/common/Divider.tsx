import { useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';

/**
 * Resizable panel divider. Pointer capture plus a body-level cursor override
 * keeps the resize cursor pinned even when the pointer outruns the handle.
 */
export function Divider({
  orientation,
  onResize,
  invert = false,
}: {
  orientation: 'vertical' | 'horizontal';
  /** Receives the pointer position along the resize axis, in px from the window edge. */
  onResize(position: number, delta: number): void;
  invert?: boolean;
}) {
  const setDraggingKind = useUIStore((s) => s.setDraggingKind);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const vertical = orientation === 'vertical';
      const start = vertical ? e.clientX : e.clientY;
      setDraggingKind(vertical ? 'col' : 'row');

      const move = (ev: PointerEvent) => {
        const pos = vertical ? ev.clientX : ev.clientY;
        const delta = (pos - start) * (invert ? -1 : 1);
        onResize(pos, delta);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDraggingKind(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [orientation, onResize, invert, setDraggingKind]
  );

  return (
    <div
      className={orientation === 'vertical' ? 'panel-divider-v' : 'panel-divider-h'}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
