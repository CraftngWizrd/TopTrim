import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Icon, KeyframeDiamond } from './Icon';
import { clamp } from '../../../engine/time';

/* ------------------------------------------------------------------ *
 * Slider — the workhorse of the properties panel.
 * Drag the track, drag the label to scrub, double-click to reset,
 * type an exact value, and keyframe it from the diamond on the right.
 * ------------------------------------------------------------------ */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Double-click the label resets to this. */
  defaultValue?: number;
  /** Centre-origin fill, for bipolar values like temperature. */
  bipolar?: boolean;
  disabled?: boolean;
  precision?: number;
  onChange(value: number): void;
  /** Called once when a drag starts / ends, so the store can bracket one undo step. */
  onDragStart?(): void;
  onDragEnd?(): void;
  keyframe?: { active: boolean; onToggle(): void };
}

export const Slider = memo(function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  defaultValue,
  bipolar = false,
  disabled = false,
  precision = 0,
  onChange,
  onDragStart,
  onDragEnd,
  keyframe,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const pct = ((value - min) / (max - min)) * 100;
  const zeroPct = ((0 - min) / (max - min)) * 100;

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = min + t * (max - min);
      return clamp(Math.round(raw / step) * step, min, max);
    },
    [min, max, step, value]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      onDragStart?.();
      onChange(valueFromClientX(e.clientX));

      const move = (ev: PointerEvent) => onChange(valueFromClientX(ev.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        onDragEnd?.();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [disabled, onChange, onDragEnd, onDragStart, valueFromClientX]
  );

  /** Scrub by dragging the label — 1px = 1 step, ×0.2 with Shift for fine control. */
  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      const startX = e.clientX;
      const startValue = value;
      onDragStart?.();

      const move = (ev: PointerEvent) => {
        const scale = ev.shiftKey ? 0.2 : 1;
        const next = startValue + (ev.clientX - startX) * step * scale;
        onChange(clamp(Math.round(next / step) * step, min, max));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        onDragEnd?.();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [disabled, max, min, onChange, onDragEnd, onDragStart, step, value]
  );

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isNaN(n)) {
      onDragStart?.();
      onChange(clamp(n, min, max));
      onDragEnd?.();
    }
    setEditing(false);
  };

  const display = precision > 0 ? value.toFixed(precision) : String(Math.round(value));

  return (
    <div className={`ctl-row${disabled ? ' is-disabled' : ''}`}>
      <div
        className="ctl-label property-slider"
        onPointerDown={startScrub}
        onDoubleClick={() => {
          if (defaultValue === undefined) return;
          onDragStart?.();
          onChange(defaultValue);
          onDragEnd?.();
        }}
        title={defaultValue !== undefined ? 'Drag to scrub · double-click to reset' : 'Drag to scrub'}
      >
        {label}
      </div>

      <div ref={trackRef} className="ctl-track property-slider" onPointerDown={startDrag}>
        <div className="ctl-track-bg" />
        <div
          className="ctl-track-fill"
          style={
            bipolar
              ? { left: `${Math.min(pct, zeroPct)}%`, width: `${Math.abs(pct - zeroPct)}%` }
              : { left: 0, width: `${pct}%` }
          }
        />
        <div className="ctl-thumb" style={{ left: `${pct}%` }} />
      </div>

      {editing ? (
        <input
          className="input input-num property-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          className="ctl-value mono"
          onClick={() => {
            setDraft(display);
            setEditing(true);
          }}
        >
          {display}
          {unit}
        </button>
      )}

      {keyframe && (
        <button
          className="kf-diamond ctl-kf"
          onClick={keyframe.onToggle}
          title={keyframe.active ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
        >
          <KeyframeDiamond active={keyframe.active} />
        </button>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Toggle
 * ------------------------------------------------------------------ */

export const Toggle = memo(function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label?: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className={`ctl-row ctl-toggle-row${disabled ? ' is-disabled' : ''}`}>
      {label && <div className="ctl-label">{label}</div>}
      <button
        className={`ctl-toggle${checked ? ' is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span className="ctl-toggle-knob" />
      </button>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Select
 * ------------------------------------------------------------------ */

export const Field = memo(function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ctl-row">
      <div className="ctl-label">{label}</div>
      <div className="ctl-field">{children}</div>
    </div>
  );
});

// Not memoised: React.memo erases the generic signature, which would collapse
// every call site's `value`/`onChange` to `string | number`.
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange(v: T): void;
}) {
  return (
    <Field label={label}>
      <select
        className="select"
        style={{ width: '100%' }}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented control
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
}: {
  value: T;
  options: { label: string; value: T; icon?: string; title?: string }[];
  onChange(v: T): void;
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? ' is-full' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          title={o.title ?? o.label}
          className={`segmented-item${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Icon button with tooltip
 * ------------------------------------------------------------------ */

export const IconButton = memo(function IconButton({
  icon,
  title,
  shortcut,
  onClick,
  active,
  disabled,
  danger,
  size = 24,
  iconSize = 15,
  className = '',
}: {
  icon: string;
  title: string;
  shortcut?: string;
  onClick?(e: React.MouseEvent): void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  size?: number;
  iconSize?: number;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  const show = () => {
    if (disabled) return;
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setTip({ x: r.left + r.width / 2, y: r.bottom + 6 });
    }, 420);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => hide, []);

  return (
    <>
      <button
        ref={ref}
        className={`icon-btn${active ? ' is-active' : ''}${danger ? ' is-danger' : ''} ${className}`}
        style={{ width: size, height: size }}
        onClick={onClick}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerDown={hide}
        disabled={disabled}
        aria-label={title}
        aria-pressed={active}
      >
        <Icon name={icon} size={iconSize} />
      </button>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y, transform: 'translateX(-50%)' }}>
          {title}
          {shortcut && <span className="tooltip-key">{shortcut}</span>}
        </div>
      )}
    </>
  );
});

/* ------------------------------------------------------------------ *
 * Colour swatch + picker
 * ------------------------------------------------------------------ */

export const ColorField = memo(function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <Field label={label}>
      <div className="color-field">
        <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
        <span className="mono">{toHex(value).toUpperCase()}</span>
      </div>
    </Field>
  );
});

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i.exec(color);
  if (!m) return '#ffffff';
  const hex = (n: string) => Math.round(Number(n)).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

/* ------------------------------------------------------------------ *
 * Empty state
 * ------------------------------------------------------------------ */

export const EmptyState = memo(function EmptyState({
  icon,
  title,
  hint,
  children,
}: {
  icon: string;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={26} />
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children}
    </div>
  );
});
