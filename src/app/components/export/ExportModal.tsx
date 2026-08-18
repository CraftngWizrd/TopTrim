import { useMemo, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Icon } from '../common/Icon';
import { SelectField, Toggle } from '../common/Controls';
import { useEditorStore } from '../../stores/editorStore';
import { formatDuration } from '../../../engine/time';
import { FPS_PRESETS, RESOLUTION_PRESETS } from '../../../engine/defaults';
import {
  PLATFORM_PRESETS,
  cancelNativeExport,
  runExport,
  type ExportFormat,
  type ExportProgress,
  type ExportSettings,
  type Quality,
} from '../../services/export';

/** "18s elapsed · ~42s left" — the estimate appears once it is worth trusting. */
function exportStats(value: number, startedAt: number): string {
  if (!startedAt) return '';
  const elapsed = (Date.now() - startedAt) / 1000;
  const fmt = (s: number) =>
    s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  const parts = [`${fmt(elapsed)} elapsed`];
  if (value > 0.05 && value < 1) parts.push(`~${fmt(elapsed / value - elapsed)} left`);
  return parts.join(' · ');
}

const FORMATS: { label: string; value: ExportFormat }[] = [
  { label: 'MP4  H.264', value: 'mp4' },
  { label: 'WebM  VP9', value: 'webm' },
  { label: 'GIF', value: 'gif' },
  { label: 'MP3  audio only', value: 'mp3' },
  { label: 'WAV  audio only', value: 'wav' },
];

export function ExportModal({ onClose }: { onClose(): void }) {
  const meta = useEditorStore((s) => s.meta);
  const durationFrames = useEditorStore((s) => s.durationFrames());

  const [preset, setPreset] = useState('custom');
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    width: meta?.width ?? 1920,
    height: meta?.height ?? 1080,
    fps: meta?.fps ?? 30,
    quality: 'high',
    audioBitrate: 192,
    applyEffects: true,
    burnCaptions: true,
    audioOnly: false,
  });

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ path: string | null; error?: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const logLines = useRef<string[]>([]);
  const startedAt = useRef(0);

  const busy = progress !== null && result === null;
  const audioOnlyFormat = settings.format === 'mp3' || settings.format === 'wav';

  const patch = (p: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...p }));

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PLATFORM_PRESETS.find((x) => x.id === id);
    if (p && id !== 'custom') patch({ width: p.width, height: p.height, fps: p.fps, format: p.format });
  };

  const estimate = useMemo(() => {
    const seconds = durationFrames / (meta?.fps ?? 30);
    const bitrateMbps = settings.quality === 'high' ? 12 : settings.quality === 'medium' ? 7 : 3.5;
    const pixelScale = (settings.width * settings.height) / (1920 * 1080);
    const mb = ((bitrateMbps * pixelScale * seconds) / 8) * 1.05;
    return mb < 1 ? '<1 MB' : `~${Math.round(mb)} MB`;
  }, [durationFrames, meta?.fps, settings.quality, settings.width, settings.height]);

  const start = async () => {
    logLines.current = [];
    setResult(null);
    startedAt.current = Date.now();
    setProgress({ stage: 'Preparing', detail: '', value: -1 });

    const outcome = await runExport({ ...settings, audioOnly: settings.audioOnly || audioOnlyFormat }, (p) => {
      if (p.log) {
        logLines.current = [...logLines.current.slice(-60), p.log];
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        return;
      }
      setProgress(p);
    });

    setResult({ path: outcome.savedPath, error: outcome.error });
  };

  return (
    <Modal
      title="Export"
      onClose={busy ? () => {} : onClose}
      width={460}
      footer={
        result ? (
          <>
            <button className="btn btn-secondary" onClick={() => setResult(null)}>
              Export again
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (!busy) return onClose();
                // Native renders are killed by PID; the WASM path has to be torn
                // down instead, since it cannot be interrupted mid-encode.
                void cancelNativeExport().then((stopped) => {
                  if (!stopped) {
                    void import('../../../engine/ffmpegHost').then((m) => m.ffmpegHost.terminate());
                  }
                });
                setResult({ path: null, error: 'Export cancelled.' });
              }}
            >
              {busy ? 'Stop export' : 'Cancel'}
            </button>
            <button className="btn btn-primary" onClick={() => void start()} disabled={busy || durationFrames === 0}>
              {busy ? 'Exporting…' : 'Export'}
              {!busy && <Icon name="arrow-right" size={13} />}
            </button>
          </>
        )
      }
    >
      <div className="export-banner">
        <Icon name="check" size={13} />
        No watermark · no resolution cap · nothing leaves this machine
      </div>

      <div className="export-grid">
        <SelectField
          label="Platform"
          value={preset}
          options={PLATFORM_PRESETS.map((p) => ({ label: p.label, value: p.id }))}
          onChange={applyPreset}
        />
        <SelectField
          label="Format"
          value={settings.format}
          options={FORMATS}
          onChange={(format) => {
            setPreset('custom');
            patch({ format });
          }}
        />
        <SelectField
          label="Resolution"
          value={`${settings.width}x${settings.height}`}
          options={[
            ...RESOLUTION_PRESETS.map((r) => ({ label: r.label, value: `${r.width}x${r.height}` })),
            ...(RESOLUTION_PRESETS.some((r) => r.width === settings.width && r.height === settings.height)
              ? []
              : [{ label: `${settings.width}×${settings.height}  Custom`, value: `${settings.width}x${settings.height}` }]),
          ]}
          onChange={(value) => {
            const [w, h] = String(value).split('x').map(Number);
            setPreset('custom');
            patch({ width: w, height: h });
          }}
        />
        <SelectField
          label="Frame rate"
          value={settings.fps}
          options={FPS_PRESETS.map((f) => ({ label: `${f}fps`, value: f }))}
          onChange={(fps) => {
            setPreset('custom');
            patch({ fps });
          }}
        />

        <div className="ctl-row" style={{ height: 'auto', alignItems: 'flex-start' }}>
          <div className="ctl-label" style={{ paddingTop: 6 }}>
            Quality
          </div>
          <div className="export-quality" style={{ flex: 1 }}>
            {(['high', 'medium', 'web'] as Quality[]).map((q) => (
              <button
                key={q}
                className={`export-quality-btn${settings.quality === q ? ' is-active' : ''}`}
                onClick={() => patch({ quality: q })}
              >
                {q[0].toUpperCase() + q.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <SelectField
          label="Audio"
          value={settings.audioBitrate}
          options={[128, 192, 256, 320].map((b) => ({ label: `AAC ${b}kbps`, value: b }))}
          onChange={(audioBitrate) => patch({ audioBitrate })}
        />

        <div className="export-checks">
          <Toggle label="Apply effects" checked={settings.applyEffects} onChange={(applyEffects) => patch({ applyEffects })} />
          <Toggle label="Burn captions" checked={settings.burnCaptions} onChange={(burnCaptions) => patch({ burnCaptions })} />
          <Toggle
            label="Audio only"
            checked={settings.audioOnly || audioOnlyFormat}
            onChange={(audioOnly) => patch({ audioOnly })}
            disabled={audioOnlyFormat}
          />
        </div>

        <div className="detail-row" style={{ marginTop: 8 }}>
          <span>Duration</span>
          <span className="mono">{formatDuration(durationFrames, meta?.fps ?? 30)}</span>
        </div>
        <div className="detail-row">
          <span>Estimated size</span>
          <span className="mono">{estimate}</span>
        </div>
      </div>

      {progress && !result && (
        <div className="export-progress">
          <div className="export-progress-head">
            <Icon name="settings" size={13} className="spin" />
            <span>{progress.stage}</span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>
              {progress.value >= 0 ? `${Math.round(progress.value * 100)}%` : ''}
            </span>
          </div>
          <div className="job-detail">{progress.detail}</div>
          <div className={`job-bar${progress.value < 0 ? ' is-indeterminate' : ''}`}>
            <div className="job-bar-fill" style={progress.value >= 0 ? { width: `${progress.value * 100}%` } : undefined} />
          </div>
          <div className="job-foot">
            <span className="job-stats mono">{exportStats(progress.value, startedAt.current)}</span>
          </div>
          {logLines.current.length > 0 && (
            <div className="export-log" ref={logRef}>
              {logLines.current.join('\n')}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="export-progress">
          <div className="export-progress-head">
            <Icon
              name={result.error ? 'info' : 'check'}
              size={13}
              style={{ color: result.error ? 'var(--danger)' : 'var(--accent)' }}
            />
            <span>{result.error ? 'Export failed' : result.path ? 'Export complete' : 'Export cancelled'}</span>
          </div>
          <div className={`job-detail${result.error ? ' job-error' : ''}`}>
            {result.error ?? (result.path ? result.path : 'No file was written.')}
          </div>
        </div>
      )}
    </Modal>
  );
}
