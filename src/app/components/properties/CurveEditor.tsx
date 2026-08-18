import { useCallback, useEffect, useRef, useState } from 'react';
import type { BezierPoint, CurvePoint } from '../../../types/project';
import { clamp } from '../../../engine/time';

/**
 * Canvas curve editors.
 *
 * `SpeedCurveEditor` edits a speed-vs-time ramp (y is speed on a log scale,
 * 0.5 == 1×). `ToneCurveEditor` edits a tone curve for colour grading.
 * Both are the same interaction: drag points, double-click to add or remove.
 */

const PAD = 10;

interface EditorProps<T> {
  points: T[];
  onChange(points: T[]): void;
  onCommit?(): void;
  height?: number;
  /** Accent used for the curve stroke. */
  color?: string;
}

function useCurveCanvas(
  points: { x: number; y: number }[],
  onChange: (pts: { x: number; y: number }[]) => void,
  onCommit: (() => void) | undefined,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  allowEdgeXDrag: boolean
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const toCanvas = useCallback((p: { x: number; y: number }, w: number, h: number) => ({
    x: PAD + p.x * (w - PAD * 2),
    y: h - PAD - p.y * (h - PAD * 2),
  }), []);

  const fromCanvas = useCallback((x: number, y: number, w: number, h: number) => ({
    x: clamp((x - PAD) / (w - PAD * 2), 0, 1),
    y: clamp((h - PAD - y) / (h - PAD * 2), 0, 1),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
  }, [draw, points]);

  const hitIndex = (x: number, y: number, w: number, h: number): number => {
    for (let i = 0; i < points.length; i++) {
      const p = toCanvas(points[i], w, h);
      if (Math.hypot(p.x - x, p.y - y) <= 7) return i;
    }
    return -1;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const index = hitIndex(x, y, rect.width, rect.height);

    if (e.detail === 2) {
      // Double-click: remove an interior point, or add one where you clicked.
      if (index > 0 && index < points.length - 1) {
        onChange(points.filter((_, i) => i !== index));
      } else if (index < 0) {
        const p = fromCanvas(x, y, rect.width, rect.height);
        onChange([...points, p].sort((a, b) => a.x - b.x));
      }
      onCommit?.();
      return;
    }

    if (index >= 0) {
      canvas.setPointerCapture(e.pointerId);
      setDragIndex(index);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIndex === null) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const p = fromCanvas(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    const next = points.map((pt, i) => {
      if (i !== dragIndex) return pt;
      // Endpoints stay pinned to x=0 and x=1 unless the caller allows otherwise.
      const isEdge = i === 0 || i === points.length - 1;
      const x = isEdge && !allowEdgeXDrag ? pt.x : clamp(p.x, i === 0 ? 0 : points[i - 1].x + 0.01, i === points.length - 1 ? 1 : points[i + 1].x - 0.01);
      return { ...pt, x, y: p.y };
    });
    onChange(next);
  };

  const onPointerUp = () => {
    if (dragIndex !== null) onCommit?.();
    setDragIndex(null);
  };

  return { canvasRef, onPointerDown, onPointerMove, onPointerUp };
}

/* ------------------------------------------------------------------ *
 * Speed curve
 * ------------------------------------------------------------------ */

export function SpeedCurveEditor({ points, onChange, onCommit, height = 120 }: EditorProps<BezierPoint>) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0A090D';
      ctx.fillRect(0, 0, w, h);

      // Speed gridlines at 0.1× / 1× / 10×.
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (const [label, y] of [['10x', 1], ['1x', 0.5], ['0.1x', 0]] as [string, number][]) {
        const py = h - PAD - y * (h - PAD * 2);
        ctx.beginPath();
        ctx.moveTo(PAD, py);
        ctx.lineTo(w - PAD, py);
        ctx.stroke();
        ctx.fillText(label, 2, py - 2);
      }

      ctx.strokeStyle = '#00E676';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = PAD + p.x * (w - PAD * 2);
        const y = h - PAD - p.y * (h - PAD * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;

      for (const p of points) {
        const x = PAD + p.x * (w - PAD * 2);
        const y = h - PAD - p.y * (h - PAD * 2);
        ctx.fillStyle = '#111113';
        ctx.strokeStyle = '#00E676';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    },
    [points]
  );

  const handlers = useCurveCanvas(points, (p) => onChange(p as BezierPoint[]), onCommit, draw, false);

  return (
    <canvas
      className="curve-canvas"
      style={{ height }}
      ref={handlers.canvasRef}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Tone curve
 * ------------------------------------------------------------------ */

export function ToneCurveEditor({ points, onChange, onCommit, height = 150, color = '#F0EDE8' }: EditorProps<CurvePoint>) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0A090D';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        ctx.beginPath();
        ctx.moveTo(PAD + t * (w - PAD * 2), PAD);
        ctx.lineTo(PAD + t * (w - PAD * 2), h - PAD);
        ctx.moveTo(PAD, PAD + t * (h - PAD * 2));
        ctx.lineTo(w - PAD, PAD + t * (h - PAD * 2));
        ctx.stroke();
      }

      // Identity reference.
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD, h - PAD);
      ctx.lineTo(w - PAD, PAD);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = PAD + p.x * (w - PAD * 2);
        const y = h - PAD - p.y * (h - PAD * 2);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.lineWidth = 1;

      for (const p of points) {
        const x = PAD + p.x * (w - PAD * 2);
        const y = h - PAD - p.y * (h - PAD * 2);
        ctx.fillStyle = '#111113';
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    },
    [points, color]
  );

  const handlers = useCurveCanvas(points, (p) => onChange(p as CurvePoint[]), onCommit, draw, false);

  return (
    <canvas
      className="curve-canvas"
      style={{ height }}
      ref={handlers.canvasRef}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Cubic-bezier easing editor
 * ------------------------------------------------------------------ */

/**
 * Two draggable control points over a unit square, exactly like a CSS
 * `cubic-bezier()`. The vertical axis intentionally allows values outside 0..1
 * so overshoot and anticipation are reachable by dragging, not just by preset.
 */
export function BezierEasingEditor({
  value,
  onChange,
  onCommit,
  height = 168,
}: {
  value: [number, number, number, number];
  onChange(v: [number, number, number, number]): void;
  onCommit?(): void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<0 | 1 | null>(null);

  /** Vertical range shown, so overshoot/anticipate stay on screen. */
  const Y_MIN = -0.6;
  const Y_MAX = 1.6;

  const toCanvas = useCallback(
    (px: number, py: number, w: number, h: number) => ({
      x: PAD + px * (w - PAD * 2),
      y: h - PAD - ((py - Y_MIN) / (Y_MAX - Y_MIN)) * (h - PAD * 2),
    }),
    []
  );

  const fromCanvas = useCallback(
    (cxp: number, cyp: number, w: number, h: number) => ({
      x: clamp((cxp - PAD) / (w - PAD * 2), 0, 1),
      y: clamp(Y_MIN + ((h - PAD - cyp) / (h - PAD * 2)) * (Y_MAX - Y_MIN), Y_MIN, Y_MAX),
    }),
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0A090D';
    ctx.fillRect(0, 0, w, h);

    // The 0 and 1 value lines — the band the animation normally lives in.
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.setLineDash([3, 3]);
    for (const v of [0, 1]) {
      const p = toCanvas(0, v, w, h);
      ctx.beginPath();
      ctx.moveTo(PAD, p.y);
      ctx.lineTo(w - PAD, p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const p0 = toCanvas(0, 0, w, h);
    const p3 = toCanvas(1, 1, w, h);
    const p1 = toCanvas(value[0], value[1], w, h);
    const p2 = toCanvas(value[2], value[3], w, h);

    // Handle arms.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.moveTo(p3.x, p3.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // The curve itself.
    ctx.strokeStyle = '#00E676';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Endpoints, then handles on top.
    for (const p of [p0, p3]) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of [p1, p2]) {
      ctx.fillStyle = '#111113';
      ctx.strokeStyle = '#00E676';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }, [value, toCanvas]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const p1 = toCanvas(value[0], value[1], rect.width, rect.height);
    const p2 = toCanvas(value[2], value[3], rect.width, rect.height);
    const d1 = Math.hypot(p1.x - px, p1.y - py);
    const d2 = Math.hypot(p2.x - px, p2.y - py);

    // Whichever handle is nearer, as long as the click is close to one.
    if (Math.min(d1, d2) > 14) return;
    dragRef.current = d1 <= d2 ? 0 : 1;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current === null) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const p = fromCanvas(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const next: [number, number, number, number] = [...value];
    if (dragRef.current === 0) {
      next[0] = p.x;
      next[1] = p.y;
    } else {
      next[2] = p.x;
      next[3] = p.y;
    }
    onChange(next);
  };

  const onPointerUp = () => {
    if (dragRef.current !== null) onCommit?.();
    dragRef.current = null;
  };

  return (
    <canvas
      className="curve-canvas"
      style={{ height }}
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Colour wheel
 * ------------------------------------------------------------------ */

export function ColorWheel({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: { hue: number; sat: number; lum: number };
  onChange(v: { hue: number; sat: number; lum: number }): void;
  onCommit?(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);

    const move = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const radius = rect.width / 2;
      const dist = Math.min(1, Math.hypot(dx, dy) / radius);
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
      onChange({ ...value, hue: Math.round(angle), sat: Math.round(dist * 100) });
    };

    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onCommit?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const rad = (value.hue - 90) * (Math.PI / 180);
  const r = (value.sat / 100) * 50;

  return (
    <div className="color-wheel">
      <div className="color-wheel-disc" ref={ref} onPointerDown={onPointerDown}>
        <div
          className="color-wheel-knob"
          style={{ left: `${50 + Math.cos(rad) * r}%`, top: `${50 + Math.sin(rad) * r}%` }}
        />
      </div>
      <div className="color-wheel-label">{label}</div>
      <input
        className="color-wheel-lum"
        type="range"
        min={-100}
        max={100}
        value={value.lum}
        onChange={(e) => onChange({ ...value, lum: Number(e.target.value) })}
        onPointerUp={() => onCommit?.()}
        aria-label={`${label} luminance`}
      />
    </div>
  );
}
