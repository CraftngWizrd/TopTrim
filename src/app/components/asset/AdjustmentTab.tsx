import { useEditorStore } from '../../stores/editorStore';
import { Slider } from '../common/Controls';
import { Icon } from '../common/Icon';
import { defaultAdjustments } from '../../../engine/defaults';
import type { GlobalAdjustments } from '../../../types/project';

const ROWS: { key: keyof GlobalAdjustments; label: string; min: number; max: number; bipolar: boolean }[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, bipolar: true },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, bipolar: true },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, bipolar: true },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, bipolar: false },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, bipolar: true },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, bipolar: true },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, bipolar: true },
  { key: 'tint', label: 'Tint', min: -100, max: 100, bipolar: true },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, bipolar: false },
];

/** Global grade, applied above every track. */
export function AdjustmentTab() {
  const adjustments = useEditorStore((s) => s.state.adjustments);
  const update = useEditorStore((s) => s.update);
  const beginGesture = useEditorStore((s) => s.beginGesture);
  const endGesture = useEditorStore((s) => s.endGesture);
  const commit = useEditorStore((s) => s.commit);

  const dirty = ROWS.some((r) => adjustments[r.key] !== 0);

  return (
    <div className="asset-panel">
      <div className="panel-scroll">
        <div className="prop-group">
          <div className="prop-group-title">
            <Icon name="sliders" size={12} />
            Adjustment
          </div>

          {ROWS.map((row) => (
            <Slider
              key={row.key}
              label={row.label}
              value={adjustments[row.key]}
              min={row.min}
              max={row.max}
              defaultValue={0}
              bipolar={row.bipolar}
              onDragStart={beginGesture}
              onDragEnd={() => endGesture(`Adjust ${row.label.toLowerCase()}`)}
              onChange={(v) => update((d) => { d.adjustments[row.key] = v; })}
            />
          ))}

          <div className="prop-actions">
            <button
              className="btn btn-secondary btn-sm"
              style={{ width: '100%' }}
              disabled={!dirty}
              onClick={() => commit('Reset adjustment', (d) => { d.adjustments = defaultAdjustments(); })}
            >
              Reset all
            </button>
          </div>
        </div>

        <div className="library-hint">
          These sit above every track. For per-clip grading, select a clip and use the Color tab on the right.
        </div>
      </div>
    </div>
  );
}
