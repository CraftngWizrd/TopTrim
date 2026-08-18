import { useEffect, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../common/Icon';
import { TEXT_PRESETS } from '../../../engine/libraries';
import { defaultTextProps } from '../../../engine/defaults';
import { playback } from '../../../engine/playback';
import { addGeneratedAudio, listVoices, speakOnly } from '../../services/generatedAudio';

export function TextTab() {
  const [sub, setSub] = useState<'templates' | 'tts'>('templates');

  return (
    <div className="asset-panel">
      <div className="subtabs">
        <button className={`subtab${sub === 'templates' ? ' is-active' : ''}`} onClick={() => setSub('templates')}>
          Templates
        </button>
        <button className={`subtab${sub === 'tts' ? ' is-active' : ''}`} onClick={() => setSub('tts')}>
          Text to speech
        </button>
      </div>

      <div className="panel-scroll">{sub === 'templates' ? <TemplatesPane /> : <TtsPane />}</div>
    </div>
  );
}

function TemplatesPane() {
  const commit = useEditorStore((s) => s.commit);
  const addTextClip = useEditorStore((s) => s.addTextClip);
  const select = useUIStore((s) => s.select);
  const setPropertyTab = useUIStore((s) => s.setPropertyTab);

  const add = (presetId: string) => {
    const preset = TEXT_PRESETS.find((p) => p.id === presetId)!;
    const clipId = addTextClip(playback.currentFrame, 'Your text here');
    if (!clipId) return;
    commit(`Add ${preset.name} text`, (d) => {
      const c = d.clips[clipId];
      if (c) c.text = { ...defaultTextProps('Your text here'), ...preset.patch };
    });
    select([clipId]);
    setPropertyTab('basic');
  };

  return (
    <>
      <div className="library-hint">Click a style to add a text clip at the playhead.</div>
      <div className="text-preset-grid">
        {TEXT_PRESETS.map((p) => (
          <button key={p.id} className="text-preset" onClick={() => add(p.id)} title={p.name}>
            <div className="text-preset-canvas">
              <span style={p.preview}>Aa</span>
            </div>
            <span className="lib-name">{p.name}</span>
          </button>
        ))}
      </div>

      <div className="prop-divider" />
      <div style={{ padding: '0 10px 12px' }}>
        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => useUIStore.getState().setAssetTab('captions')}>
          <Icon name="captions" size={14} />
          Auto captions
        </button>
      </div>
    </>
  );
}

function TtsPane() {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const addClip = useEditorStore((s) => s.addClipFromAsset);
  const setJob = useUIStore((s) => s.setJob);
  const clearJob = useUIStore((s) => s.clearJob);

  const [text, setText] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState('');
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => {
      const list = listVoices();
      setVoices(list);
      if (list.length && !voiceName) setVoiceName(list[0].name);
    };
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, [voiceName]);

  const voice = voices.find((v) => v.name === voiceName);

  const preview = () => {
    if (!text.trim()) return;
    void speakOnly(text, voice, rate);
  };

  /**
   * The Web Speech API gives no direct audio tap, so capture goes through
   * MediaRecorder on a display-capture stream. The user is told exactly that
   * rather than being surprised by a share prompt.
   */
  const addToTimeline = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setJob({
      id: 'tts',
      label: 'Text to speech',
      detail: 'Choose "This tab" and enable "Share audio" in the prompt',
      progress: -1,
    });
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('No audio was shared — re-run and tick "Share audio".');
      }
      const audioOnly = new MediaStream(audioTracks);
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(audioOnly);
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType }));
        };
      });

      rec.start(200);
      await speakOnly(text, voice, rate);
      // Trailing pad so the last syllable is not clipped.
      await new Promise((r) => setTimeout(r, 350));
      rec.stop();

      const blob = await done;
      const asset = await addGeneratedAudio(text.slice(0, 24) || 'Speech', blob, fps);
      addClip(asset.id, null, playback.currentFrame);
      clearJob('tts');
    } catch (err) {
      setJob({ id: 'tts', label: 'Text to speech', detail: '', progress: 1, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tts-pane">
      <textarea
        className="input tts-textarea"
        placeholder="Type what you want spoken…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
      />

      <label className="tts-label">Voice</label>
      <select className="select" style={{ width: '100%' }} value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
        {voices.length === 0 && <option>No voices available</option>}
        {voices.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name} — {v.lang}
          </option>
        ))}
      </select>

      <label className="tts-label">Rate — {rate.toFixed(2)}×</label>
      <input
        className="tts-range"
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={rate}
        onChange={(e) => setRate(Number(e.target.value))}
      />

      <div className="prop-actions">
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={preview} disabled={!text.trim()}>
          <Icon name="play" size={13} />
          Preview
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void addToTimeline()} disabled={!text.trim() || busy}>
          <Icon name="plus" size={13} />
          Add clip
        </button>
      </div>

      <div className="library-hint" style={{ paddingLeft: 0, paddingRight: 0 }}>
        Preview speaks straight to your speakers. Adding a clip records that speech, which needs a one-time screen-share
        prompt — pick this window and tick “Share audio”.
      </div>
    </div>
  );
}
