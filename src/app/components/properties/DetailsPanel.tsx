import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { Field, SelectField, Toggle } from '../common/Controls';
import { Icon } from '../common/Icon';
import { ASPECT_PRESETS, FPS_PRESETS, RESOLUTION_PRESETS } from '../../../engine/defaults';
import { formatDuration } from '../../../engine/time';

/** Shown when nothing is selected — the Details panel. */
export function DetailsPanel({ multiSelectCount }: { multiSelectCount: number }) {
  const meta = useEditorStore((s) => s.meta);
  const setMeta = useEditorStore((s) => s.setMeta);
  const durationFrames = useEditorStore((s) => s.durationFrames());
  const clipCount = useEditorStore((s) => Object.keys(s.state.clips).length);

  const [draft, setDraft] = useState<{ width: number; height: number; fps: number } | null>(null);
  const pending = draft ?? { width: meta?.width ?? 1920, height: meta?.height ?? 1080, fps: meta?.fps ?? 30 };
  const dirty = !!draft && (draft.width !== meta?.width || draft.height !== meta?.height || draft.fps !== meta?.fps);

  if (!meta) return null;

  if (multiSelectCount > 1) {
    return (
      <div className="props">
        <div className="panel-head">
          <span className="panel-head-title">{multiSelectCount} clips selected</span>
        </div>
        <div className="library-hint">
          Select a single clip to edit its properties. Timeline actions — move, trim, split, delete — still apply to the
          whole selection.
        </div>
      </div>
    );
  }

  return (
    <div className="props">
      <div className="panel-head">
        <Icon name="info" size={13} />
        <span className="panel-head-title">Details</span>
      </div>

      <div className="panel-scroll">
        <div className="prop-group">
          <Field label="Name">
            <input
              className="input"
              style={{ width: '100%' }}
              value={meta.name}
              onChange={(e) => setMeta({ name: e.target.value })}
            />
          </Field>

          <SelectField
            label="Aspect ratio"
            value={currentAspect(pending.width, pending.height)}
            options={ASPECT_PRESETS.map((p) => ({ label: p.label, value: p.value }))}
            onChange={(value) => {
              const preset = ASPECT_PRESETS.find((p) => p.value === value);
              if (!preset?.ratio) return;
              const base = Math.max(pending.width, pending.height);
              const [w, h] = preset.ratio >= 1 ? [base, Math.round(base / preset.ratio)] : [Math.round(base * preset.ratio), base];
              setDraft({ ...pending, width: even(w), height: even(h) });
            }}
          />

          <SelectField
            label="Resolution"
            value={`${pending.width}x${pending.height}`}
            options={[
              ...RESOLUTION_PRESETS.map((r) => ({ label: r.label, value: `${r.width}x${r.height}` })),
              ...(RESOLUTION_PRESETS.some((r) => r.width === pending.width && r.height === pending.height)
                ? []
                : [{ label: `${pending.width}×${pending.height}  Custom`, value: `${pending.width}x${pending.height}` }]),
            ]}
            onChange={(value) => {
              const [w, h] = String(value).split('x').map(Number);
              setDraft({ ...pending, width: w, height: h });
            }}
          />

          <SelectField
            label="Frame rate"
            value={pending.fps}
            options={FPS_PRESETS.map((f) => ({ label: `${f}fps`, value: f }))}
            onChange={(fps) => setDraft({ ...pending, fps })}
          />

          <Toggle label="Arrange layers" checked onChange={() => {}} />
          <Toggle label="Proxy" checked={false} onChange={() => {}} />

          <div className="prop-actions">
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: 'auto' }}
              disabled={!dirty}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!dirty}
              onClick={() => {
                if (draft) setMeta(draft);
                setDraft(null);
              }}
            >
              Modify
            </button>
          </div>
        </div>

        <div className="prop-group">
          <div className="prop-group-title">Project</div>
          <div className="detail-row">
            <span>Duration</span>
            <span className="mono">{formatDuration(durationFrames, meta.fps)}</span>
          </div>
          <div className="detail-row">
            <span>Clips</span>
            <span className="mono">{clipCount}</span>
          </div>
          <div className="detail-row">
            <span>Watermark</span>
            <span className="mono" style={{ color: 'var(--accent)' }}>
              None
            </span>
          </div>
          <div className="detail-row">
            <span>Export cap</span>
            <span className="mono" style={{ color: 'var(--accent)' }}>
              None
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

function currentAspect(w: number, h: number): string {
  const ratio = w / h;
  const match = ASPECT_PRESETS.find((p) => p.ratio && Math.abs(p.ratio - ratio) < 0.02);
  return match?.value ?? 'original';
}
