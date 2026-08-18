import { useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { Icon } from '../common/Icon';
import { BezierEasingEditor } from './CurveEditor';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { playback } from '../../../engine/playback';
import { formatTimecode } from '../../../engine/time';
import { EASING_PRESETS, bezierFor, keyframeFrames } from '../../../engine/keyframes';
import type { EasingKind } from '../../../types/project';

/**
 * Keyframe editor, opened by right-clicking a clip or a keyframe on the
 * timeline — the conventional placement, where the keyframes actually are.
 *
 * Left: every animated property and its keyframes. Right: the easing that
 * leaves the selected keyframe, as presets or a custom cubic-bezier you can
 * drag. Easing belongs to the OUTGOING keyframe: it shapes the segment between
 * that keyframe and the next, which is why the last keyframe on a property has
 * nothing to edit.
 */
export function KeyframeEditorModal({ onClose }: { onClose(): void }) {
  const target = useUIStore((s) => s.keyframeTarget);
  const clips = useEditorStore((s) => s.state.clips);
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const setEasing = useEditorStore((s) => s.setKeyframeEasing);
  const editor = useEditorStore();

  const clip = target ? clips[target.clipId] : null;

  const paths = useMemo(
    () => (clip ? Object.keys(clip.keyframes).filter((p) => clip.keyframes[p].length > 0).sort() : []),
    [clip]
  );

  const [path, setPath] = useState<string | null>(target?.path ?? paths[0] ?? null);
  const activePath = path && paths.includes(path) ? path : (paths[0] ?? null);

  const list = activePath && clip ? clip.keyframes[activePath] : [];
  const [frame, setFrame] = useState<number | null>(target?.frame ?? null);
  const activeFrame = frame !== null && list.some((k) => k.frame === frame) ? frame : (list[0]?.frame ?? null);

  const kf = list.find((k) => k.frame === activeFrame) ?? null;
  const isLast = !!kf && list.indexOf(kf) === list.length - 1;
  const bezier = kf ? bezierFor(kf) : ([0.25, 0.1, 0.25, 1] as [number, number, number, number]);

  if (!clip) {
    return (
      <Modal title="Keyframes" onClose={onClose} width={560}>
        <div className="library-hint">That clip no longer exists.</div>
      </Modal>
    );
  }

  const apply = (easing: EasingKind, b?: [number, number, number, number], allOnPath = false) => {
    if (activeFrame === null || !activePath) return;
    if (allOnPath) {
      editor.commit('Keyframe easing', (d) => {
        const c = d.clips[clip.id];
        for (const k of c?.keyframes[activePath] ?? []) {
          k.easing = easing;
          if (easing === 'bezier') k.bezier = b ?? bezier;
          else delete k.bezier;
        }
      });
      return;
    }
    setEasing(clip.id, activeFrame, easing, b, activePath);
  };

  return (
    <Modal
      title={`Keyframes — ${clip.name}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button
            className="btn btn-secondary"
            disabled={activeFrame === null}
            onClick={() => activeFrame !== null && playback.seek(activeFrame)}
          >
            Go to keyframe
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {paths.length === 0 ? (
        <div className="library-hint" style={{ padding: '18px 0' }}>
          This clip has no keyframes yet. Add one from a property&apos;s diamond in the right panel, or from the group
          diamond in a section header, then come back here to shape its easing.
        </div>
      ) : (
        <div className="kfe">
          <div className="kfe-side">
            <div className="section-label">Animated</div>
            {paths.map((p) => (
              <button
                key={p}
                className={`kfe-path${activePath === p ? ' is-active' : ''}`}
                onClick={() => {
                  setPath(p);
                  setFrame(null);
                }}
              >
                <span className="kfe-path-name">{prettyPath(p)}</span>
                <span className="kfe-path-count mono">{clip.keyframes[p].length}</span>
              </button>
            ))}

            <div className="section-label" style={{ marginTop: 12 }}>
              Keyframes
            </div>
            <div className="kfe-frames">
              {list.map((k, i) => (
                <button
                  key={k.id}
                  className={`kfe-frame${activeFrame === k.frame ? ' is-active' : ''}`}
                  onClick={() => setFrame(k.frame)}
                  title={`${formatTimecode(k.frame, fps)} — value ${k.value.toFixed(2)}`}
                >
                  <Icon name="effect" size={9} />
                  <span className="mono">{formatTimecode(k.frame, fps).slice(3)}</span>
                  {i === list.length - 1 && <span className="kfe-last">end</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="kfe-main">
            {isLast ? (
              <div className="library-hint" style={{ padding: '10px 0' }}>
                This is the last keyframe on {prettyPath(activePath ?? '')}, so there is no segment after it to ease.
                Select an earlier keyframe to shape the curve leading out of it.
              </div>
            ) : (
              <>
                <BezierEasingEditor
                  value={bezier}
                  onChange={(v) => apply('bezier', v)}
                  onCommit={() => {}}
                />
                <div className="kfe-readout mono">
                  cubic-bezier({bezier.map((n) => n.toFixed(2)).join(', ')})
                </div>
              </>
            )}

            <div className="section-label" style={{ marginTop: 12 }}>
              Presets
            </div>
            <div className="kfe-presets">
              {EASING_PRESETS.map((preset) => {
                const selected =
                  kf?.easing === preset.easing &&
                  (preset.easing !== 'bezier' || JSON.stringify(kf?.bezier) === JSON.stringify(preset.bezier));
                return (
                  <button
                    key={preset.id}
                    className={`kfe-preset${selected ? ' is-active' : ''}`}
                    disabled={isLast}
                    onClick={() => apply(preset.easing, preset.bezier)}
                    title={preset.name}
                  >
                    <EasingSpark preset={preset.id} bezier={preset.bezier} easing={preset.easing} />
                    <span>{preset.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="prop-actions">
              <button
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
                disabled={!kf}
                onClick={() => kf && apply(kf.easing, kf.bezier, true)}
              >
                Apply to all on this property
              </button>
              <button
                className="btn btn-danger btn-sm"
                disabled={activeFrame === null}
                onClick={() => {
                  if (activeFrame === null) return;
                  editor.deleteKeyframesAt(clip.id, activeFrame);
                  setFrame(null);
                }}
              >
                Delete keyframe
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Tiny inline preview of a preset's shape. */
function EasingSpark({
  preset,
  bezier,
  easing,
}: {
  preset: string;
  bezier?: [number, number, number, number];
  easing: EasingKind;
}) {
  const b = bezier ?? bezierFor({ id: preset, frame: 0, value: 0, easing } as never);
  // Drawn in a 34x18 box with headroom so overshoot stays visible.
  const x = (v: number) => 2 + v * 30;
  const y = (v: number) => 16 - ((v + 0.4) / 1.8) * 14;
  return (
    <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
      <path
        d={`M ${x(0)} ${y(0)} C ${x(b[0])} ${y(b[1])}, ${x(b[2])} ${y(b[3])}, ${x(1)} ${y(1)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** `transform.scale` -> `Scale`, `color.temperature` -> `Colour · Temperature`. */
function prettyPath(path: string): string {
  const parts = path.split('.');
  const leaf = parts[parts.length - 1];
  const label = leaf
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
  if (parts[0] === 'color') return `Colour · ${label}`;
  if (parts[0] === 'audio') return `Audio · ${label}`;
  if (parts[1] === 'crop') return `Crop · ${label}`;
  return label;
}

export { keyframeFrames };
