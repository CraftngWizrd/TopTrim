import { useCallback, useRef, useState } from 'react';

/**
 * A real scrollbar: a thumb whose LENGTH shows how much of the timeline is on
 * screen and whose POSITION shows where you are.
 *
 * A range input cannot express the first of those — it is a point on a scale,
 * so it tells you nothing about how much you are looking at. Dragging a thumb
 * sized to the viewport is also what every other timeline does, so it needs no
 * explaining.
 */
export function TimelineScrollbar({
  orientation,
  scroll,
  viewport,
  content,
  onScroll,
}: {
  orientation: 'horizontal' | 'vertical';
  /** Current scroll offset in content pixels. */
  scroll: number;
  /** Visible size along the scroll axis, in pixels. */
  viewport: number;
  /** Total scrollable size along that axis, in pixels. */
  content: number;
  onScroll(next: number): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const horizontal = orientation === 'horizontal';
  const maxScroll = Math.max(0, content - viewport);

  /**
   * Held state is tracked here rather than with CSS :active.
   * pointerdown is bound to the TRACK (so clicking the gutter jumps), which
   * means :active never lands on the thumb — that is why the highlight was
   * green only some of the time. A body-level class was no better: it lit up
   * both scrollbars at once.
   */
  const [held, setHeld] = useState(false);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      const track = trackRef.current;
      if (!track || maxScroll <= 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = track.getBoundingClientRect();
      const trackLength = horizontal ? rect.width : rect.height;
      const thumbLength = Math.max(28, (viewport / content) * trackLength);
      const travel = Math.max(1, trackLength - thumbLength);

      const pointer = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
      const thumbStart = (scroll / maxScroll) * travel;

      // Clicking the track jumps so the thumb centres on the click; clicking the
      // thumb itself grabs it where you touched it.
      const grabOffset =
        pointer >= thumbStart && pointer <= thumbStart + thumbLength ? pointer - thumbStart : thumbLength / 2;

      const apply = (position: number) => {
        const next = ((position - grabOffset) / travel) * maxScroll;
        onScroll(Math.max(0, Math.min(maxScroll, next)));
      };
      apply(pointer);

      const move = (ev: PointerEvent) => {
        const p = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        apply(p);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-scrollbar-drag');
        setHeld(false);
      };
      document.body.classList.add('is-scrollbar-drag');
      setHeld(true);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [content, horizontal, maxScroll, onScroll, scroll, viewport]
  );

  // Nothing to scroll: keep the gutter so the layout does not jump, hide the thumb.
  const ratio = content > 0 ? Math.min(1, viewport / content) : 1;
  const thumbPct = ratio * 100;
  const positionPct = maxScroll > 0 ? (scroll / maxScroll) * (100 - thumbPct) : 0;

  return (
    <div
      ref={trackRef}
      className={`tl-sb tl-sb-${orientation}`}
      onPointerDown={startDrag}
      role="scrollbar"
      aria-orientation={orientation}
      aria-valuenow={Math.round(maxScroll > 0 ? (scroll / maxScroll) * 100 : 0)}
    >
      {maxScroll > 0 && (
        <div
          className={`tl-sb-thumb${held ? ' is-held' : ''}`}
          style={
            horizontal
              ? { left: `${positionPct}%`, width: `${thumbPct}%` }
              : { top: `${positionPct}%`, height: `${thumbPct}%` }
          }
        />
      )}
    </div>
  );
}
