import { useMemo, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { usePlatform } from '../../hooks/usePlatform';
import { Icon } from '../common/Icon';
import { formatTimecode } from '../../../engine/time';
import { TEXT_PRESETS } from '../../../engine/libraries';
import { CAPTION_LANGUAGES, captionsToSrt, generateCaptions, importSrt } from '../../services/captions';
import type { WhisperModel } from '../../../workers/whisper.worker';
import { playback } from '../../../engine/playback';

export function CaptionsTab() {
  const platform = usePlatform();
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const clips = useEditorStore((s) => s.state.clips);
  const commit = useEditorStore((s) => s.commit);
  const deleteClips = useEditorStore((s) => s.deleteClips);
  const select = useUIStore((s) => s.select);
  const selection = useUIStore((s) => s.selection);

  const [model, setModel] = useState<WhisperModel>('base');
  const [language, setLanguage] = useState('auto');
  const [wordsPerLine, setWordsPerLine] = useState(6);
  const [presetId, setPresetId] = useState('caption');
  const [busy, setBusy] = useState(false);

  const captions = useMemo(
    () => Object.values(clips).filter((c) => c.kind === 'text' && c.text).sort((a, b) => a.start - b.start),
    [clips]
  );

  const generate = async () => {
    setBusy(true);
    try {
      await generateCaptions({ model, language, wordsPerLine, presetId });
    } finally {
      setBusy(false);
    }
  };

  const exportSrt = async () => {
    const srt = captionsToSrt();
    if (!srt.trim()) return;
    await platform.saveFile(new Blob([srt], { type: 'text/plain' }), {
      defaultFilename: 'captions.srt',
      filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }],
    });
  };

  const importFromFile = async () => {
    const files = await platform.openFile({ accept: '.srt,text/plain' });
    if (files.length === 0) return;
    importSrt(await files[0].text());
  };

  return (
    <div className="asset-panel">
      <div className="panel-scroll">
        <div className="captions-config">
          <div className="section-label">Generate</div>

          <label className="tts-label">Model</label>
          <select className="select" style={{ width: '100%' }} value={model} onChange={(e) => setModel(e.target.value as WhisperModel)}>
            <option value="tiny">Tiny — fastest</option>
            <option value="base">Base — balanced</option>
            <option value="small">Small — most accurate</option>
          </select>

          <label className="tts-label">Language</label>
          <select className="select" style={{ width: '100%' }} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {CAPTION_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>

          <label className="tts-label">Words per caption — {wordsPerLine}</label>
          <input
            className="tts-range"
            type="range"
            min={2}
            max={12}
            step={1}
            value={wordsPerLine}
            onChange={(e) => setWordsPerLine(Number(e.target.value))}
          />

          <label className="tts-label">Style</label>
          <select className="select" style={{ width: '100%' }} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {TEXT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => void generate()} disabled={busy}>
            {busy ? <Icon name="settings" size={14} className="spin" /> : <Icon name="sparkles" size={14} />}
            {busy ? 'Transcribing…' : 'Generate captions'}
          </button>

          <div className="library-hint" style={{ padding: '8px 0 0' }}>
            Whisper runs locally. The model downloads once and the feature is offline after that.
          </div>

          <div className="prop-actions">
            <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => void importFromFile()}>
              <Icon name="import" size={12} />
              Import SRT
            </button>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => void exportSrt()} disabled={captions.length === 0}>
              <Icon name="export" size={12} />
              Export SRT
            </button>
          </div>
        </div>

        <div className="prop-divider" />

        <div className="section-label" style={{ padding: '0 10px 6px' }}>
          {captions.length} caption{captions.length === 1 ? '' : 's'}
        </div>

        {captions.length === 0 ? (
          <div className="library-hint">No captions yet.</div>
        ) : (
          captions.map((c) => (
            <div
              key={c.id}
              className={`caption-row${selection.includes(c.id) ? ' is-selected' : ''}`}
              onClick={() => {
                select([c.id]);
                playback.seek(c.start);
              }}
            >
              <span className="caption-time mono">{formatTimecode(c.start, fps)}</span>
              <input
                className="caption-input"
                value={c.text!.content}
                onChange={(e) =>
                  commit('Edit caption', (d) => {
                    const clip = d.clips[c.id];
                    if (clip?.text) {
                      clip.text.content = e.target.value;
                      clip.name = e.target.value.slice(0, 30);
                    }
                  })
                }
              />
              <button className="icon-btn is-danger" style={{ width: 20, height: 20 }} onClick={(e) => { e.stopPropagation(); deleteClips([c.id]); }} aria-label="Delete caption">
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
