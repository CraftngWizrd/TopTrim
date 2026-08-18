import { useCallback, useMemo, useState } from 'react';
import type { Clip, HslRange } from '../../../types/project';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../common/Icon';
import { ColorField, Field, IconButton, SelectField, Segmented, Slider, Toggle } from '../common/Controls';
import { ColorWheel, SpeedCurveEditor, ToneCurveEditor } from './CurveEditor';
import { CategoryKeyframe } from './CategoryKeyframe';
import { getPath, hasKeyframeAt } from '../../../engine/keyframes';
import { SPEED_CURVE_PRESETS, DEFAULT_SPEED_CURVE } from '../../../engine/keyframes';
import { defaultColorGrade, defaultTransform } from '../../../engine/defaults';
import { effectById } from '../../../engine/effects';
import { transitionById } from '../../../engine/transitions';
import { ANIMATION_PRESETS, animationsForSlot, VOICE_PRESETS } from '../../../engine/libraries';
import { denoiseAudio, denoiseVideo, detectBeats, isolateVocals, opticalFlow, revertOp, stabilize, upscale } from '../../services/aiOps';
import { hasFilters } from '../../../engine/ffmpegCapabilities';
import { formatDuration } from '../../../engine/time';

const TABS: Record<string, { id: string; label: string }[]> = {
  video: [
    { id: 'basic', label: 'Basic' },
    { id: 'color', label: 'Color' },
    { id: 'speed', label: 'Speed' },
    { id: 'audio', label: 'Audio' },
    { id: 'ai', label: 'AI' },
    { id: 'animation', label: 'Animation' },
  ],
  image: [
    { id: 'basic', label: 'Basic' },
    { id: 'color', label: 'Color' },
    { id: 'ai', label: 'AI' },
    { id: 'animation', label: 'Animation' },
  ],
  audio: [
    { id: 'basic', label: 'Basic' },
    { id: 'effects', label: 'Effects' },
    { id: 'ai', label: 'AI' },
  ],
  text: [
    { id: 'basic', label: 'Basic' },
    { id: 'style', label: 'Style' },
    { id: 'animation', label: 'Animation' },
  ],
  sticker: [
    { id: 'basic', label: 'Basic' },
    { id: 'animation', label: 'Animation' },
  ],
  effect: [{ id: 'basic', label: 'Basic' }],
};

export function ClipProperties({ clip, frame }: { clip: Clip; frame: number }) {
  const tabs = TABS[clip.kind] ?? TABS.video;
  const propertyTab = useUIStore((s) => s.propertyTab);
  const setPropertyTab = useUIStore((s) => s.setPropertyTab);
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const tab = tabs.some((t) => t.id === propertyTab) ? propertyTab : tabs[0].id;

  const editor = useEditorStore();

  /** Live edit that does not push history until the gesture ends. */
  const set = useCallback(
    (path: string, value: number) => editor.setClipProperty(clip.id, path, value, frame),
    [editor, clip.id, frame]
  );

  const kf = useCallback(
    (path: string) => ({
      active: hasKeyframeAt(clip.keyframes, path, frame),
      onToggle: () => editor.toggleKeyframe(clip.id, path, frame),
    }),
    [clip.keyframes, clip.id, editor, frame]
  );

  const gesture = useMemo(
    () => ({ onDragStart: editor.beginGesture, onDragEnd: () => editor.endGesture('Edit property') }),
    [editor]
  );

  return (
    <div className="props">
      <div className="panel-head">
        <Icon name={iconFor(clip.kind)} size={13} />
        <span className="panel-head-title" title={clip.name}>
          {clip.name}
        </span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {formatDuration(clip.duration, fps)}
        </span>
      </div>

      <div className="subtabs">
        {tabs.map((t) => (
          <button key={t.id} className={`subtab${tab === t.id ? ' is-active' : ''}`} onClick={() => setPropertyTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-scroll">
        {tab === 'basic' && (clip.kind === 'text' ? <TextBasic clip={clip} /> : clip.kind === 'audio' ? <AudioBasic clip={clip} frame={frame} kf={kf} set={set} gesture={gesture} /> : <TransformBasic clip={clip} frame={frame} kf={kf} set={set} gesture={gesture} />)}
        {tab === 'color' && <ColorTab clip={clip} frame={frame} kf={kf} set={set} gesture={gesture} />}
        {tab === 'speed' && <SpeedTab clip={clip} />}
        {tab === 'audio' && <AudioBasic clip={clip} frame={frame} kf={kf} set={set} gesture={gesture} />}
        {tab === 'effects' && <AudioEffectsTab clip={clip} />}
        {tab === 'ai' && <AiTab clip={clip} />}
        {tab === 'animation' && <AnimationTab clip={clip} />}
        {tab === 'style' && <TextStyle clip={clip} />}

        <EffectStack clip={clip} />
      </div>
    </div>
  );
}

const iconFor = (kind: string) =>
  kind === 'audio' ? 'music' : kind === 'text' ? 'type' : kind === 'sticker' ? 'star' : kind === 'image' ? 'image' : 'video';

type KfFn = (path: string) => { active: boolean; onToggle(): void };
type SetFn = (path: string, value: number) => void;
type Gesture = { onDragStart(): void; onDragEnd(): void };

/* ------------------------------------------------------------------ *
 * Basic — transform
 * ------------------------------------------------------------------ */

function TransformBasic({ clip, frame, kf, set, gesture }: { clip: Clip; frame: number; kf: KfFn; set: SetFn; gesture: Gesture }) {
  const editor = useEditorStore();
  const meta = useEditorStore((s) => s.meta);
  const cropMode = useUIStore((s) => s.cropMode);
  const toggleCropMode = useUIStore((s) => s.toggleCropMode);
  const w = meta?.width ?? 1920;
  const h = meta?.height ?? 1080;

  // Non-uniform scale is worth calling out: it is easy to do by accident with
  // an edge handle and hard to spot once done.
  const stretched = clip.transform.scaleX !== 100 || clip.transform.scaleY !== 100;

  const align = (dx: number | null, dy: number | null) =>
    editor.commit('Align', (d) => {
      const c = d.clips[clip.id];
      if (!c) return;
      if (dx !== null) c.transform.x = dx;
      if (dy !== null) c.transform.y = dy;
    });

  return (
    <>
      <div className="prop-group">
        <div className="prop-group-title">
          Position &amp; size
          <CategoryKeyframe clip={clip} frame={frame} category="transform" />
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', height: 18 }}
            onClick={() => editor.commit('Reset transform', (d) => { const c = d.clips[clip.id]; if (c) c.transform = defaultTransform(); })}
          >
            Reset
          </button>
        </div>

        <div className="align-row">
          <IconButton icon="align-left" title="Align left" onClick={() => align(-w / 4, null)} size={22} iconSize={13} />
          <IconButton icon="align-center-h" title="Centre horizontally" onClick={() => align(0, null)} size={22} iconSize={13} />
          <IconButton icon="align-right" title="Align right" onClick={() => align(w / 4, null)} size={22} iconSize={13} />
          <IconButton icon="align-top" title="Align top" onClick={() => align(null, -h / 4)} size={22} iconSize={13} />
          <IconButton icon="align-center-v" title="Centre vertically" onClick={() => align(null, 0)} size={22} iconSize={13} />
          <IconButton icon="align-bottom" title="Align bottom" onClick={() => align(null, h / 4)} size={22} iconSize={13} />
        </div>

        <Slider label="Position X" value={clip.transform.x} min={-w} max={w} defaultValue={0} bipolar {...gesture} onChange={(v) => set('transform.x', v)} keyframe={kf('transform.x')} />
        <Slider label="Position Y" value={clip.transform.y} min={-h} max={h} defaultValue={0} bipolar {...gesture} onChange={(v) => set('transform.y', v)} keyframe={kf('transform.y')} />
        <Slider label="Scale" value={clip.transform.scale} min={1} max={400} unit="%" defaultValue={100} {...gesture} onChange={(v) => set('transform.scale', v)} keyframe={kf('transform.scale')} />
        {/*
          Width/Height expose scaleX/scaleY. Dragging an edge handle on the
          canvas stretches one axis, and without these the stretch was invisible
          in the panel and could only be undone by resetting every property.
          Double-click either label to snap that axis back to 100%.
        */}
        <Slider label="Width" value={clip.transform.scaleX} min={1} max={400} unit="%" defaultValue={100} {...gesture} onChange={(v) => set('transform.scaleX', v)} keyframe={kf('transform.scaleX')} />
        <Slider label="Height" value={clip.transform.scaleY} min={1} max={400} unit="%" defaultValue={100} {...gesture} onChange={(v) => set('transform.scaleY', v)} keyframe={kf('transform.scaleY')} />
        {stretched && (
          <div className="ctl-row">
            <div className="ctl-label" />
            <button
              className="btn btn-secondary btn-sm"
              style={{ flex: 1 }}
              onClick={() =>
                editor.commit('Reset stretch', (d) => {
                  const c = d.clips[clip.id];
                  if (!c) return;
                  c.transform.scaleX = 100;
                  c.transform.scaleY = 100;
                })
              }
              title="Return width and height to 100%, keeping Scale"
            >
              Reset stretch
            </button>
          </div>
        )}
        <Slider label="Rotation" value={clip.transform.rotation} min={-180} max={180} unit="°" defaultValue={0} bipolar {...gesture} onChange={(v) => set('transform.rotation', v)} keyframe={kf('transform.rotation')} />
        <Slider label="Opacity" value={clip.transform.opacity} min={0} max={100} unit="%" defaultValue={100} {...gesture} onChange={(v) => set('transform.opacity', v)} keyframe={kf('transform.opacity')} />

        <div className="prop-divider" />

        <div className="ctl-row">
          <div className="ctl-label">Flip</div>
          <button className={`btn btn-secondary btn-sm${clip.transform.flipH ? ' is-on' : ''}`} onClick={() => editor.commit('Flip', (d) => { const c = d.clips[clip.id]; if (c) c.transform.flipH = !c.transform.flipH; })}>
            <Icon name="flip-h" size={12} />
            Horizontal
          </button>
          <button className={`btn btn-secondary btn-sm${clip.transform.flipV ? ' is-on' : ''}`} onClick={() => editor.commit('Flip', (d) => { const c = d.clips[clip.id]; if (c) c.transform.flipV = !c.transform.flipV; })}>
            <Icon name="flip-v" size={12} />
            Vertical
          </button>
        </div>

        <SelectField
          label="Blend mode"
          value={clip.transform.blendMode}
          options={['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map((m) => ({ label: m.replace('-', ' '), value: m }))}
          onChange={(blendMode) => editor.commit('Blend mode', (d) => { const c = d.clips[clip.id]; if (c) c.transform.blendMode = blendMode as Clip['transform']['blendMode']; })}
        />
      </div>

      <div className="prop-group">
        <div className="prop-group-title">
          Crop
          <CategoryKeyframe clip={clip} frame={frame} category="crop" />
          <button
            className={`btn btn-ghost btn-sm${cropMode ? ' is-on' : ''}`}
            style={{ marginLeft: 'auto', height: 18 }}
            onClick={toggleCropMode}
            title="Drag the canvas handles to crop instead of resize"
          >
            <Icon name="crop" size={11} />
            {cropMode ? 'Done' : 'On canvas'}
          </button>
        </div>
        <Slider label="Left" value={clip.transform.crop.left * 100} min={0} max={49} unit="%" defaultValue={0} {...gesture} onChange={(v) => set('transform.crop.left', v / 100)} />
        <Slider label="Right" value={clip.transform.crop.right * 100} min={0} max={49} unit="%" defaultValue={0} {...gesture} onChange={(v) => set('transform.crop.right', v / 100)} />
        <Slider label="Top" value={clip.transform.crop.top * 100} min={0} max={49} unit="%" defaultValue={0} {...gesture} onChange={(v) => set('transform.crop.top', v / 100)} />
        <Slider label="Bottom" value={clip.transform.crop.bottom * 100} min={0} max={49} unit="%" defaultValue={0} {...gesture} onChange={(v) => set('transform.crop.bottom', v / 100)} />
        {cropMode && (
          <div className="library-hint" style={{ padding: '6px 0 0' }}>
            Canvas handles are cropping. Drag an edge or corner in the preview and these values follow.
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Color
 * ------------------------------------------------------------------ */

const HSL_RANGES: HslRange[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta'];
const HSL_SWATCH: Record<HslRange, string> = {
  red: '#ff4d4d', orange: '#ff9f43', yellow: '#ffe14d', green: '#4dff88',
  cyan: '#4de1ff', blue: '#4d7dff', magenta: '#e14dff',
};

function ColorTab({ clip, frame, kf, set, gesture }: { clip: Clip; frame: number; kf: KfFn; set: SetFn; gesture: Gesture }) {
  const editor = useEditorStore();
  const sub = useUIStore((s) => s.colorSubTab);
  const setSub = useUIStore((s) => s.setColorSubTab);
  const [hslRange, setHslRange] = useState<HslRange>('red');
  const [curveChannel, setCurveChannel] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');

  const basics: [string, string, number, number][] = [
    ['Exposure', 'color.exposure', -100, 100],
    ['Contrast', 'color.contrast', -100, 100],
    ['Highlights', 'color.highlights', -100, 100],
    ['Shadows', 'color.shadows', -100, 100],
    ['Whites', 'color.whites', -100, 100],
    ['Blacks', 'color.blacks', -100, 100],
    ['Saturation', 'color.saturation', -100, 100],
    ['Vibrance', 'color.vibrance', -100, 100],
    ['Temperature', 'color.temperature', -100, 100],
    ['Tint', 'color.tint', -100, 100],
    ['Sharpen', 'color.sharpen', 0, 100],
    ['Clarity', 'color.clarity', -100, 100],
    ['Vignette', 'color.vignette', 0, 100],
  ];

  return (
    <>
      <div className="subtabs" style={{ borderTop: 'none' }}>
        {['basic', 'curves', 'wheels', 'hsl', 'lut'].map((id) => (
          <button key={id} className={`subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>
            {id === 'hsl' || id === 'lut' ? id.toUpperCase() : id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      <div className="prop-group">
        {sub === 'basic' && (
          <div className="prop-group-title">
            Colour
            <CategoryKeyframe clip={clip} frame={frame} category="color" />
          </div>
        )}
        {sub === 'basic' &&
          basics.map(([label, path, min, max]) => (
            <Slider
              key={path}
              label={label}
              value={getPath(clip, path) ?? 0}
              min={min}
              max={max}
              defaultValue={0}
              bipolar={min < 0}
              {...gesture}
              onChange={(v) => set(path, v)}
              keyframe={kf(path)}
            />
          ))}

        {sub === 'curves' && (
          <>
            <Segmented<'rgb' | 'r' | 'g' | 'b'>
              full
              value={curveChannel}
              options={[
                { label: 'RGB', value: 'rgb' },
                { label: 'R', value: 'r' },
                { label: 'G', value: 'g' },
                { label: 'B', value: 'b' },
              ]}
              onChange={setCurveChannel}
            />
            <div style={{ marginTop: 8 }}>
              <ToneCurveEditor
                points={clip.color.curves[curveChannel]}
                color={{ rgb: '#F0EDE8', r: '#ff5252', g: '#00e676', b: '#4d7dff' }[curveChannel]}
                onChange={(points) => editor.update((d) => { const c = d.clips[clip.id]; if (c) c.color.curves[curveChannel] = points; })}
                onCommit={() => editor.commit('Edit curve', () => {})}
              />
            </div>
            <div className="library-hint" style={{ padding: '6px 0 0' }}>
              Drag points to reshape. Double-click to add or remove one.
            </div>
          </>
        )}

        {sub === 'wheels' && (
          <div className="wheel-row">
            {(['lift', 'gamma', 'gain'] as const).map((which) => (
              <ColorWheel
                key={which}
                label={which[0].toUpperCase() + which.slice(1)}
                value={clip.color.wheels[which]}
                onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c) c.color.wheels[which] = v; })}
                onCommit={() => editor.commit('Colour wheel', () => {})}
              />
            ))}
          </div>
        )}

        {sub === 'hsl' && (
          <>
            <div className="hsl-row">
              {HSL_RANGES.map((r) => (
                <button
                  key={r}
                  className={`hsl-swatch${hslRange === r ? ' is-active' : ''}`}
                  style={{ background: HSL_SWATCH[r] }}
                  onClick={() => setHslRange(r)}
                  aria-label={r}
                />
              ))}
            </div>
            {(['hue', 'sat', 'lum'] as const).map((k) => (
              <Slider
                key={k}
                label={k === 'sat' ? 'Saturation' : k === 'lum' ? 'Luminance' : 'Hue'}
                value={clip.color.hsl[hslRange][k]}
                min={-100}
                max={100}
                defaultValue={0}
                bipolar
                {...gesture}
                onChange={(v) => set(`color.hsl.${hslRange}.${k}`, v)}
              />
            ))}
          </>
        )}

        {sub === 'lut' && (
          <>
            <div className="library-hint" style={{ padding: '0 0 8px' }}>
              Load a .cube LUT to apply it at export via ffmpeg&apos;s <span className="mono">lut3d</span> filter.
            </div>
            <Slider
              label="Intensity"
              value={clip.color.lut.intensity}
              min={0}
              max={100}
              unit="%"
              defaultValue={100}
              {...gesture}
              onChange={(v) => set('color.lut.intensity', v)}
            />
            <div className="prop-actions">
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} disabled>
                Import .cube
              </button>
            </div>
          </>
        )}

        <div className="prop-actions">
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            onClick={() => editor.commit('Reset colour', (d) => { const c = d.clips[clip.id]; if (c) c.color = defaultColorGrade(); })}
          >
            Reset colour
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Speed
 * ------------------------------------------------------------------ */

function SpeedTab({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const mode = clip.speedCurve ? 'curve' : 'normal';

  return (
    <div className="prop-group">
      <Segmented
        full
        value={mode}
        options={[
          { label: 'Normal', value: 'normal' as const },
          { label: 'Curve', value: 'curve' as const },
        ]}
        onChange={(next) =>
          editor.commit('Speed mode', (d) => {
            const c = d.clips[clip.id];
            if (!c) return;
            c.speedCurve = next === 'curve' ? [...DEFAULT_SPEED_CURVE] : null;
          })
        }
      />

      <div style={{ height: 8 }} />

      {mode === 'normal' ? (
        <Slider
          label="Speed"
          value={clip.speed}
          min={0.1}
          max={10}
          step={0.05}
          precision={2}
          unit="×"
          defaultValue={1}
          onDragStart={editor.beginGesture}
          onDragEnd={() => editor.endGesture('Change speed')}
          onChange={(speed) =>
            editor.update((d) => {
              const c = d.clips[clip.id];
              if (!c) return;
              // Keep the same source range on screen when speed changes.
              const sourceFrames = c.duration * c.speed;
              c.speed = speed;
              c.duration = Math.max(1, Math.round(sourceFrames / speed));
            })
          }
        />
      ) : (
        <>
          <SpeedCurveEditor
            points={clip.speedCurve ?? DEFAULT_SPEED_CURVE}
            onChange={(points) => editor.update((d) => { const c = d.clips[clip.id]; if (c) c.speedCurve = points; })}
            onCommit={() => editor.commit('Edit speed curve', () => {})}
          />
          <div className="preset-chips">
            {Object.keys(SPEED_CURVE_PRESETS).map((key) => (
              <button
                key={key}
                className="chip"
                onClick={() => editor.commit('Speed preset', (d) => { const c = d.clips[clip.id]; if (c) c.speedCurve = structuredClone(SPEED_CURVE_PRESETS[key]); })}
              >
                {key.replace('-', ' ')}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="prop-divider" />
      <Toggle label="Pitch correction" checked={clip.pitchCorrection} onChange={(v) => editor.patchClip(clip.id, { pitchCorrection: v })} />
      <Toggle label="Optical flow" checked={clip.opticalFlow} onChange={(v) => editor.patchClip(clip.id, { opticalFlow: v })} />
      <Toggle label="Reverse" checked={clip.reversed} onChange={(v) => editor.patchClip(clip.id, { reversed: v })} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Audio
 * ------------------------------------------------------------------ */

function AudioBasic({ clip, frame, kf, set, gesture }: { clip: Clip; frame: number; kf: KfFn; set: SetFn; gesture: Gesture }) {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const editor = useEditorStore();

  return (
    <div className="prop-group">
      <div className="prop-group-title">
        Audio
        <CategoryKeyframe clip={clip} frame={frame} category="audio" />
      </div>
      <Slider label="Volume" value={clip.audio.volumeDb} min={-60} max={12} unit=" dB" defaultValue={0} bipolar {...gesture} onChange={(v) => set('audio.volumeDb', v)} keyframe={kf('audio.volumeDb')} />
      <Slider label="Pan" value={clip.audio.pan} min={-100} max={100} defaultValue={0} bipolar {...gesture} onChange={(v) => set('audio.pan', v)} keyframe={kf('audio.pan')} />
      <Slider label="Fade in" value={clip.audio.fadeInFrames} min={0} max={Math.floor(clip.duration / 2)} unit="f" defaultValue={0} {...gesture} onChange={(v) => set('audio.fadeInFrames', v)} />
      <Slider label="Fade out" value={clip.audio.fadeOutFrames} min={0} max={Math.floor(clip.duration / 2)} unit="f" defaultValue={0} {...gesture} onChange={(v) => set('audio.fadeOutFrames', v)} />
      <Toggle label="Mute" checked={clip.audio.muted} onChange={(v) => editor.commit('Mute', (d) => { const c = d.clips[clip.id]; if (c) c.audio.muted = v; })} />
      <div className="detail-row">
        <span>Fade in</span>
        <span className="mono">{formatDuration(clip.audio.fadeInFrames, fps)}</span>
      </div>
    </div>
  );
}

function AudioEffectsTab({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const [voice, setVoice] = useState('none');

  const effects: { kind: 'reverb' | 'echo' | 'eq' | 'compressor' | 'pitch'; label: string; params: [string, number, number, number][] }[] = [
    { kind: 'reverb', label: 'Reverb', params: [['mix', 0, 100, 25], ['decay', 0, 100, 40]] },
    { kind: 'echo', label: 'Echo', params: [['delay', 20, 1000, 250], ['feedback', 0, 90, 35]] },
    { kind: 'eq', label: 'EQ', params: [['low', -20, 20, 0], ['mid', -20, 20, 0], ['high', -20, 20, 0]] },
    { kind: 'compressor', label: 'Compressor', params: [['threshold', -60, 0, -18], ['ratio', 1, 20, 4]] },
    { kind: 'pitch', label: 'Pitch', params: [['semitones', -12, 12, 0]] },
  ];

  const toggle = (kind: string, defaults: Record<string, number>) =>
    editor.commit('Audio effect', (d) => {
      const c = d.clips[clip.id];
      if (!c) return;
      const index = c.audio.effects.findIndex((e) => e.kind === kind);
      if (index >= 0) c.audio.effects.splice(index, 1);
      else c.audio.effects.push({ id: `${kind}-${Date.now()}`, kind: kind as never, enabled: true, params: defaults });
    });

  return (
    <div className="prop-group">
      <div className="prop-group-title">Effects</div>

      {effects.map((fx) => {
        const inst = clip.audio.effects.find((e) => e.kind === fx.kind);
        const defaults = Object.fromEntries(fx.params.map(([k, , , d]) => [k, d]));
        return (
          <div key={fx.kind} className="fx-block">
            <div className="fx-head">
              <span>{fx.label}</span>
              <Toggle checked={!!inst} onChange={() => toggle(fx.kind, defaults)} />
            </div>
            {inst &&
              fx.params.map(([key, min, max, def]) => (
                <Slider
                  key={key}
                  label={key[0].toUpperCase() + key.slice(1)}
                  value={Number(inst.params[key] ?? def)}
                  min={min}
                  max={max}
                  defaultValue={def}
                  bipolar={min < 0}
                  onDragStart={editor.beginGesture}
                  onDragEnd={() => editor.endGesture('Audio effect')}
                  onChange={(v) =>
                    editor.update((d) => {
                      const c = d.clips[clip.id];
                      const target = c?.audio.effects.find((e) => e.id === inst.id);
                      if (target) target.params[key] = v;
                    })
                  }
                />
              ))}
          </div>
        );
      })}

      <div className="prop-divider" />
      <div className="prop-group-title">Voice changer</div>
      <SelectField
        label="Preset"
        value={voice}
        options={VOICE_PRESETS.map((v) => ({ label: v.name, value: v.id }))}
        onChange={(id) => {
          setVoice(id);
          const preset = VOICE_PRESETS.find((v) => v.id === id)!;
          editor.commit('Voice changer', (d) => {
            const c = d.clips[clip.id];
            if (!c) return;
            c.audio.effects = c.audio.effects.filter((e) => e.kind !== 'voice');
            if (id !== 'none') {
              c.audio.effects.push({
                id: `voice-${Date.now()}`,
                kind: 'voice',
                enabled: true,
                params: { preset: id, pitch: preset.pitch, formant: preset.formant },
              });
            }
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * AI
 * ------------------------------------------------------------------ */

function AiTab({ clip }: { clip: Clip }) {
  const assets = useEditorStore((s) => s.state.assets);
  const editor = useEditorStore();
  const asset = clip.assetId ? assets[clip.assetId] : undefined;
  const [strength, setStrength] = useState(50);
  const [targetFps, setTargetFps] = useState(60);
  const isAudio = clip.kind === 'audio';

  const applied = new Map((clip.appliedOps ?? []).map((o) => [o.id, o]));
  const revert = (id: string) => () => revertOp(clip.id, id as never);

  if (!asset) return <div className="library-hint">This clip has no media source.</div>;

  const chromaOn = clip.effects.some((e) => e.effectId === 'chroma-key');
  const realStabiliser = hasFilters('vidstabdetect', 'vidstabtransform');

  return (
    <div className="prop-group">
      {!isAudio && (
        <>
          {/*
            Grouped by what the operation is FOR, in the order a shot is
            normally worked on: fix the footage, then change its motion, then
            change its size, then separate subject from background.
          */}
          <AiGroup title="Repair" hint="Rewrites the clip's media. Each pass can be reverted.">
            <AiRow
              icon="stabilize"
              title="Stabilise"
              body={
                realStabiliser
                  ? 'Two-pass vidstab: measures camera motion across the whole clip, then smooths the trajectory and warps each frame. Corrects rotation and scale, not just shake.'
                  : 'Single-pass deshake: estimates per-block camera motion and counter-translates it, mirroring the exposed edges.'
              }
              action="Run"
              onRun={() => void stabilize(clip, asset, strength)}
              applied={applied.get('stabilize')}
              onRevert={revert('stabilize')}
            >
              <Slider label="Strength" value={strength} min={0} max={100} defaultValue={50} onChange={setStrength} />
            </AiRow>

            <AiRow
              icon="noise"
              title="Noise reduction"
              body="Temporal and spatial denoise with hqdn3d. Best on low-light footage with visible grain."
              action="Run"
              onRun={() => void denoiseVideo(clip, asset, strength)}
              applied={applied.get('denoise')}
              onRevert={revert('denoise')}
            />
          </AiGroup>

          <AiGroup title="Motion">
            <AiRow
              icon="speed"
              title="Optical flow"
              body="Generates in-between frames so slow motion stays smooth on any source. Slow: every frame is interpolated."
              action="Run"
              onRun={() => void opticalFlow(clip, asset, targetFps)}
              applied={applied.get('optical-flow')}
              onRevert={revert('optical-flow')}
            >
              <SelectField<number>
                label="Target fps"
                value={targetFps}
                options={[30, 48, 60, 120].map((f) => ({ label: `${f}fps`, value: f }))}
                onChange={setTargetFps}
              />
            </AiRow>
          </AiGroup>

          <AiGroup title="Resolution">
            <AiRow
              icon="zoom-in"
              title="Upscale"
              body="Lanczos scaling with edge sharpening. 4× on HD footage produces a very large file."
              action="2×"
              onRun={() => void upscale(clip, asset, 2)}
              secondaryAction="4×"
              onSecondary={() => void upscale(clip, asset, 4)}
              applied={applied.get('upscale')}
              onRevert={revert('upscale')}
            />
          </AiGroup>

          <AiGroup title="Cutout" hint="Non-destructive — stored on the clip and applied at export.">
            <AiRow
              icon="palette"
              title="Chroma key"
              body="Green-screen removal. Colour and tolerance live in the Effects tab once added."
              action={chromaOn ? 'Remove' : 'Add'}
              applied={chromaOn ? { label: 'Chroma key', at: 0 } : undefined}
              onRun={() =>
                editor.commit('Chroma key', (d) => {
                  const c = d.clips[clip.id];
                  if (!c) return;
                  const index = c.effects.findIndex((e) => e.effectId === 'chroma-key');
                  if (index >= 0) c.effects.splice(index, 1);
                  else
                    c.effects.push({
                      id: `chroma-${Date.now()}`,
                      effectId: 'chroma-key',
                      enabled: true,
                      params: { color: '#00ff00', similarity: 30, smoothness: 10, spill: 20 },
                    });
                })
              }
            />
            <div className="library-hint" style={{ padding: '2px 0 0' }}>
              Background removal, smart cutout and auto-reframe need the MediaPipe segmentation model, which is not
              wired up yet — they are absent rather than shown as buttons that do nothing.
            </div>
          </AiGroup>
        </>
      )}

      {isAudio && (
        <>
          <AiGroup title="Repair" hint="Rewrites the clip's media. Each pass can be reverted.">
            <AiRow
              icon="noise"
              title="Noise reduction"
              body="Spectral gate that removes steady background hiss and hum, then trims off the extremes."
              action="Run"
              onRun={() => void denoiseAudio(clip, asset, strength)}
              applied={applied.get('denoise-audio')}
              onRevert={revert('denoise-audio')}
            >
              <Slider label="Strength" value={strength} min={0} max={100} defaultValue={50} onChange={setStrength} />
            </AiRow>
          </AiGroup>

          <AiGroup title="Separation">
            <AiRow
              icon="mic"
              title="Isolate vocals"
              body="Centre-channel extraction. Works on ordinary stereo mixes; does nothing useful on a mono source."
              action="Vocals"
              onRun={() => void isolateVocals(clip, asset, 'vocals')}
              secondaryAction="Instrumental"
              onSecondary={() => void isolateVocals(clip, asset, 'instrumental')}
              applied={applied.get('isolate-vocals')}
              onRevert={revert('isolate-vocals')}
            />
          </AiGroup>

          <AiGroup title="Rhythm" hint="Analyses only — the clip's media is left untouched.">
            <AiRow
              icon="waveform"
              title="Beat sync"
              body="Finds the tempo grid and marks every beat on the timeline so cuts can snap to them."
              action="Detect"
              onRun={() => void detectBeats(asset)}
            />
          </AiGroup>
        </>
      )}
    </div>
  );
}

/** A labelled band of related operations, with an optional note on what they do to the clip. */
function AiGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="ai-group">
      <div className="ai-group-head">
        <span className="ai-group-title">{title}</span>
        {hint && <span className="ai-group-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function AiRow({
  icon,
  title,
  body,
  action,
  onRun,
  secondaryAction,
  onSecondary,
  applied,
  onRevert,
  children,
}: {
  icon: string;
  title: string;
  body: string;
  action: string;
  onRun(): void;
  secondaryAction?: string;
  onSecondary?(): void;
  /** Set when this pass is already baked into the clip's media. */
  applied?: { label: string; at: number };
  onRevert?(): void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`ai-row is-stacked${applied ? ' is-applied' : ''}`}>
      <div className="ai-row-head">
        <div className="ai-row-icon">
          <Icon name={icon} size={14} />
        </div>
        <div className="ai-row-text">
          <div className="ai-row-title">
            {title}
            {applied && (
              <span className="ai-applied-chip">
                <Icon name="check" size={9} />
                Applied
              </span>
            )}
          </div>
          <div className="ai-row-body">
            {applied ? `Baked into this clip's media ${relativeAgo(applied.at)}. Running it again stacks on top.` : body}
          </div>
        </div>
      </div>

      {children && <div style={{ marginTop: 8 }}>{children}</div>}

      <div className="prop-actions">
        {applied && onRevert && (
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onRevert} title="Point the clip back at the original source">
            Revert
          </button>
        )}
        {secondaryAction && !applied && (
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onSecondary}>
            {secondaryAction}
          </button>
        )}
        <button className={`btn btn-sm ${applied ? 'btn-secondary' : 'btn-primary'}`} style={{ flex: 1 }} onClick={onRun}>
          {applied ? 'Re-apply' : action}
        </button>
      </div>
    </div>
  );
}

function relativeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/* ------------------------------------------------------------------ *
 * Animation
 * ------------------------------------------------------------------ */

function AnimationTab({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const [slot, setSlot] = useState<'in' | 'out' | 'loop'>('in');
  const presets = animationsForSlot(slot);
  const current = clip.animations[slot];

  const apply = (presetId: string) => {
    const preset = ANIMATION_PRESETS.find((p) => p.id === presetId)!;
    editor.commit(`Animation: ${preset.name}`, (d) => {
      const c = d.clips[clip.id];
      if (!c) return;

      if (c.animations[slot]?.presetId === presetId) {
        delete c.animations[slot];
        for (const path of Object.keys(preset.tracks)) delete c.keyframes[path];
        return;
      }

      c.animations[slot] = { presetId, durationFrames: preset.defaultFrames };
      const span = Math.min(preset.defaultFrames, c.duration);
      const base = slot === 'out' ? c.start + c.duration - span : c.start;

      for (const [path, keys] of Object.entries(preset.tracks)) {
        c.keyframes[path] = keys.map((k, i) => ({
          id: `${presetId}-${path}-${i}`,
          frame: Math.round(base + k.t * span),
          value: k.v,
          easing: 'ease-in-out' as const,
        }));
      }
    });
  };

  return (
    <div className="prop-group">
      <Segmented<'in' | 'out' | 'loop'>
        full
        value={slot}
        options={[
          { label: 'In', value: 'in' },
          { label: 'Out', value: 'out' },
          { label: 'Loop', value: 'loop' },
        ]}
        onChange={setSlot}
      />

      <div className="anim-grid">
        {presets.map((p) => (
          <button key={p.id} className={`anim-tile${current?.presetId === p.id ? ' is-active' : ''}`} onClick={() => apply(p.id)}>
            <div className="anim-preview">
              <span />
            </div>
            <span className="lib-name">{p.name}</span>
          </button>
        ))}
      </div>

      {current && (
        <Slider
          label="Duration"
          value={current.durationFrames}
          min={2}
          max={Math.max(4, clip.duration)}
          unit="f"
          defaultValue={ANIMATION_PRESETS.find((p) => p.id === current.presetId)?.defaultFrames ?? 15}
          onDragStart={editor.beginGesture}
          onDragEnd={() => editor.endGesture('Animation duration')}
          onChange={(v) =>
            editor.update((d) => {
              const c = d.clips[clip.id];
              const anim = c?.animations[slot];
              if (!c || !anim) return;
              const preset = ANIMATION_PRESETS.find((p) => p.id === anim.presetId);
              if (!preset) return;
              anim.durationFrames = v;
              const span = Math.min(v, c.duration);
              const base = slot === 'out' ? c.start + c.duration - span : c.start;
              for (const [path, keys] of Object.entries(preset.tracks)) {
                c.keyframes[path] = keys.map((k, i) => ({
                  id: `${anim.presetId}-${path}-${i}`,
                  frame: Math.round(base + k.t * span),
                  value: k.v,
                  easing: 'ease-in-out' as const,
                }));
              }
            })
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

const FONTS = ['Outfit', 'DM Sans', 'JetBrains Mono', 'Georgia', 'Impact', 'Courier New', 'Arial', 'Times New Roman'];

function TextBasic({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const t = clip.text;
  if (!t) return null;

  const patch = (fn: (text: NonNullable<Clip['text']>) => void, label = 'Edit text') =>
    editor.commit(label, (d) => {
      const c = d.clips[clip.id];
      if (c?.text) fn(c.text);
    });

  return (
    <div className="prop-group">
      <textarea
        className="input tts-textarea"
        rows={3}
        value={t.content}
        onChange={(e) =>
          patch((text) => {
            text.content = e.target.value;
          })
        }
      />

      <div style={{ height: 8 }} />

      <SelectField label="Font" value={t.fontFamily} options={FONTS.map((f) => ({ label: f, value: f }))} onChange={(fontFamily) => patch((x) => { x.fontFamily = fontFamily; })} />
      <Slider label="Size" value={t.fontSize} min={8} max={300} defaultValue={64} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Font size')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.fontSize = v; })} />
      <SelectField label="Weight" value={t.fontWeight} options={[300, 400, 500, 600, 700, 800].map((w) => ({ label: String(w), value: w }))} onChange={(fontWeight) => patch((x) => { x.fontWeight = fontWeight; })} />
      <ColorField label="Colour" value={t.color} onChange={(color) => patch((x) => { x.color = color; })} />
      <Field label="Align">
        <Segmented
          full
          value={t.align}
          options={[
            { label: '', icon: 'align-left', value: 'left' as const },
            { label: '', icon: 'align-center-h', value: 'center' as const },
            { label: '', icon: 'align-right', value: 'right' as const },
          ]}
          onChange={(align) => patch((x) => { x.align = align; })}
        />
      </Field>
      <Slider label="Letter sp." value={t.letterSpacing} min={-10} max={40} defaultValue={0} bipolar onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Letter spacing')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.letterSpacing = v; })} />
      <Slider label="Line height" value={t.lineHeight} min={0.6} max={3} step={0.05} precision={2} defaultValue={1.2} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Line height')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.lineHeight = v; })} />
    </div>
  );
}

function TextStyle({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const t = clip.text;
  if (!t) return null;

  const patch = (fn: (text: NonNullable<Clip['text']>) => void) =>
    editor.commit('Text style', (d) => {
      const c = d.clips[clip.id];
      if (c?.text) fn(c.text);
    });

  return (
    <div className="prop-group">
      <div className="fx-block">
        <div className="fx-head">
          <span>Outline</span>
          <Toggle checked={t.outline.enabled} onChange={(v) => patch((x) => { x.outline.enabled = v; })} />
        </div>
        {t.outline.enabled && (
          <>
            <ColorField label="Colour" value={t.outline.color} onChange={(color) => patch((x) => { x.outline.color = color; })} />
            <Slider label="Width" value={t.outline.width} min={0} max={24} defaultValue={4} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Outline')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.outline.width = v; })} />
          </>
        )}
      </div>

      <div className="fx-block">
        <div className="fx-head">
          <span>Shadow</span>
          <Toggle checked={t.shadow.enabled} onChange={(v) => patch((x) => { x.shadow.enabled = v; })} />
        </div>
        {t.shadow.enabled && (
          <>
            <Slider label="Offset X" value={t.shadow.x} min={-40} max={40} defaultValue={0} bipolar onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Shadow')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.shadow.x = v; })} />
            <Slider label="Offset Y" value={t.shadow.y} min={-40} max={40} defaultValue={4} bipolar onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Shadow')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.shadow.y = v; })} />
            <Slider label="Blur" value={t.shadow.blur} min={0} max={60} defaultValue={8} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Shadow')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.shadow.blur = v; })} />
          </>
        )}
      </div>

      <div className="fx-block">
        <div className="fx-head">
          <span>Background</span>
          <Toggle checked={t.background.enabled} onChange={(v) => patch((x) => { x.background.enabled = v; })} />
        </div>
        {t.background.enabled && (
          <>
            <ColorField label="Colour" value={t.background.color} onChange={(color) => patch((x) => { x.background.color = color; })} />
            <Slider label="Padding" value={t.background.padding} min={0} max={80} defaultValue={16} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Background')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.background.padding = v; })} />
            <Slider label="Radius" value={t.background.radius} min={0} max={40} defaultValue={6} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Background')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.background.radius = v; })} />
          </>
        )}
      </div>

      <div className="fx-block">
        <div className="fx-head">
          <span>Gradient fill</span>
          <Toggle checked={t.gradient.enabled} onChange={(v) => patch((x) => { x.gradient.enabled = v; })} />
        </div>
        {t.gradient.enabled && (
          <>
            <ColorField label="From" value={t.gradient.from} onChange={(from) => patch((x) => { x.gradient.from = from; })} />
            <ColorField label="To" value={t.gradient.to} onChange={(to) => patch((x) => { x.gradient.to = to; })} />
            <Slider label="Angle" value={t.gradient.angle} min={0} max={360} unit="°" defaultValue={90} onDragStart={editor.beginGesture} onDragEnd={() => editor.endGesture('Gradient')} onChange={(v) => editor.update((d) => { const c = d.clips[clip.id]; if (c?.text) c.text.gradient.angle = v; })} />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Applied effects + transitions
 * ------------------------------------------------------------------ */

function EffectStack({ clip }: { clip: Clip }) {
  const editor = useEditorStore();
  const setAssetTab = useUIStore((s) => s.setAssetTab);
  const hasAny = clip.effects.length > 0 || clip.transitionIn || clip.transitionOut;
  if (!hasAny) return null;

  return (
    <div className="prop-group">
      <div className="prop-group-title">Applied</div>

      {clip.effects.map((inst) => {
        const def = effectById(inst.effectId);
        return (
          <div key={inst.id} className="fx-block">
            <div className="fx-head">
              <span>{def?.name ?? inst.effectId}</span>
              <Toggle
                checked={inst.enabled}
                onChange={(v) =>
                  editor.commit('Toggle effect', (d) => {
                    const target = d.clips[clip.id]?.effects.find((e) => e.id === inst.id);
                    if (target) target.enabled = v;
                  })
                }
              />
              <button
                className="icon-btn is-danger"
                style={{ width: 18, height: 18 }}
                onClick={() =>
                  editor.commit('Remove effect', (d) => {
                    const c = d.clips[clip.id];
                    if (c) c.effects = c.effects.filter((e) => e.id !== inst.id);
                  })
                }
                aria-label="Remove effect"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
            {def?.params.map((p) => (
              <Slider
                key={p.key}
                label={p.label}
                value={Number(inst.params[p.key] ?? p.default)}
                min={p.min}
                max={p.max}
                step={p.step}
                unit={p.unit}
                defaultValue={p.default}
                onDragStart={editor.beginGesture}
                onDragEnd={() => editor.endGesture('Effect parameter')}
                onChange={(v) =>
                  editor.update((d) => {
                    const target = d.clips[clip.id]?.effects.find((e) => e.id === inst.id);
                    if (target) target.params[p.key] = v;
                  })
                }
              />
            ))}
          </div>
        );
      })}

      {(['transitionIn', 'transitionOut'] as const).map((key) => {
        const inst = clip[key];
        if (!inst) return null;
        const def = transitionById(inst.transitionId);
        return (
          <div key={key} className="fx-block">
            <div className="fx-head">
              <span>{def?.name ?? inst.transitionId} {key === 'transitionIn' ? '(in)' : '(out)'}</span>
              <button
                className="icon-btn is-danger"
                style={{ width: 18, height: 18, marginLeft: 'auto' }}
                onClick={() => editor.commit('Remove transition', (d) => { const c = d.clips[clip.id]; if (c) c[key] = null; })}
                aria-label="Remove transition"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
            <Slider
              label="Duration"
              value={inst.durationFrames}
              min={2}
              max={Math.max(4, Math.floor(clip.duration / 2))}
              unit="f"
              defaultValue={def?.defaultFrames ?? 20}
              onDragStart={editor.beginGesture}
              onDragEnd={() => editor.endGesture('Transition duration')}
              onChange={(v) =>
                editor.update((d) => {
                  const target = d.clips[clip.id]?.[key];
                  if (target) target.durationFrames = v;
                })
              }
            />
          </div>
        );
      })}

      <div className="prop-actions">
        <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => setAssetTab('effects')}>
          Browse effects
        </button>
      </div>
    </div>
  );
}
