import { useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { useMediaImport } from '../../hooks/useMediaImport';
import { Icon } from '../common/Icon';
import { formatDuration } from '../../../engine/time';
import { SOUND_EFFECTS, renderSfx, type SfxKind } from '../../../engine/libraries';
import { addGeneratedAudio, VoiceRecorder } from '../../services/generatedAudio';
import { playback } from '../../../engine/playback';

type SubTab = 'music' | 'sfx' | 'extracted';

export function AudioTab() {
  const [sub, setSub] = useState<SubTab>('sfx');

  return (
    <div className="asset-panel">
      <div className="subtabs">
        {(
          [
            ['music', 'Music'],
            ['sfx', 'Sound effects'],
            ['extracted', 'Extracted'],
          ] as [SubTab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>

      <VoiceoverBar />

      <div className="panel-scroll">
        {sub === 'music' && <MusicPane />}
        {sub === 'sfx' && <SfxPane />}
        {sub === 'extracted' && <ExtractedPane />}
      </div>
    </div>
  );
}

function MusicPane() {
  const { pickAndImport } = useMediaImport();
  const assets = useEditorStore((s) => s.state.assets);
  const music = useMemo(() => Object.values(assets).filter((a) => a.kind === 'audio' && !a.hash.startsWith('generated:')), [assets]);

  return (
    <>
      <div className="library-hint">
        No music library ships with TopTrim — bundling audio would mean shipping licensed files. Import your own tracks
        here and they stay in the project.
      </div>
      <div style={{ padding: '0 8px 8px' }}>
        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => void pickAndImport()}>
          <Icon name="import" size={14} />
          Import music
        </button>
      </div>
      {music.map((a) => (
        <AudioRow key={a.id} assetId={a.id} name={a.name} durationFrames={a.durationFrames} url={a.url} />
      ))}
    </>
  );
}

function SfxPane() {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const addClip = useEditorStore((s) => s.addClipFromAsset);
  const select = useUIStore((s) => s.select);
  const [busy, setBusy] = useState<SfxKind | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const generate = async (kind: SfxKind, seconds: number, andAdd: boolean) => {
    setBusy(kind);
    try {
      const blob = await renderSfx(kind, seconds);
      if (!andAdd) {
        previewRef.current?.pause();
        const el = new Audio(URL.createObjectURL(blob));
        previewRef.current = el;
        void el.play();
        return;
      }
      const name = SOUND_EFFECTS.find((s) => s.id === kind)?.name ?? kind;
      const asset = await addGeneratedAudio(name, blob, fps);
      const clipId = addClip(asset.id, null, playback.currentFrame);
      if (clipId) select([clipId]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="library-hint">Synthesised on demand with the Web Audio API — nothing to download.</div>
      {SOUND_EFFECTS.map((s) => (
        <div key={s.id} className="audio-row">
          <button className="audio-play" onClick={() => void generate(s.id, s.seconds, false)} aria-label={`Preview ${s.name}`}>
            {busy === s.id ? <Icon name="settings" size={13} className="spin" /> : <Icon name="play" size={12} />}
          </button>
          <div className="audio-row-text">
            <div className="audio-row-name">{s.name}</div>
            <div className="audio-row-sub mono">{s.seconds.toFixed(2)}s</div>
          </div>
          <button className="audio-add" onClick={() => void generate(s.id, s.seconds, true)} aria-label={`Add ${s.name}`}>
            <Icon name="plus" size={13} />
          </button>
        </div>
      ))}
    </>
  );
}

function ExtractedPane() {
  const assets = useEditorStore((s) => s.state.assets);
  const clips = useEditorStore((s) => s.state.clips);
  const detachAudio = useEditorStore((s) => s.detachAudio);
  const generated = useMemo(() => Object.values(assets).filter((a) => a.kind === 'audio'), [assets]);
  const videoClips = useMemo(() => Object.values(clips).filter((c) => c.kind === 'video'), [clips]);

  return (
    <>
      {videoClips.length > 0 && (
        <>
          <div className="section-label" style={{ padding: '10px 10px 4px', margin: 0 }}>
            Detach from video
          </div>
          {videoClips.map((c) => (
            <div key={c.id} className="audio-row">
              <div className="audio-row-icon">
                <Icon name="video" size={13} />
              </div>
              <div className="audio-row-text">
                <div className="audio-row-name">{c.name}</div>
                <div className="audio-row-sub">{c.linkedClipId ? 'Audio detached' : 'Audio attached'}</div>
              </div>
              <button className="audio-add" disabled={!!c.linkedClipId} onClick={() => detachAudio(c.id)} aria-label="Detach audio">
                <Icon name="scissors" size={13} />
              </button>
            </div>
          ))}
        </>
      )}

      <div className="section-label" style={{ padding: '10px 10px 4px', margin: 0 }}>
        Audio in project
      </div>
      {generated.length === 0 ? (
        <div className="library-hint">No audio assets yet.</div>
      ) : (
        generated.map((a) => <AudioRow key={a.id} assetId={a.id} name={a.name} durationFrames={a.durationFrames} url={a.url} />)
      )}
    </>
  );
}

function AudioRow({
  assetId,
  name,
  durationFrames,
  url,
}: {
  assetId: string;
  name: string;
  durationFrames: number;
  url: string;
}) {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const addClip = useEditorStore((s) => s.addClipFromAsset);
  const select = useUIStore((s) => s.select);
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (!ref.current) {
      ref.current = new Audio(url);
      ref.current.onended = () => setPlaying(false);
    }
    if (playing) {
      ref.current.pause();
      setPlaying(false);
    } else {
      void ref.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="audio-row">
      <button className="audio-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={12} />
      </button>
      <div className="audio-row-text">
        <div className="audio-row-name" title={name}>
          {name}
        </div>
        <div className="audio-row-sub mono">{formatDuration(durationFrames, fps)}</div>
      </div>
      <button
        className="audio-add"
        onClick={() => {
          const clipId = addClip(assetId, null, playback.currentFrame);
          if (clipId) select([clipId]);
        }}
        aria-label="Add to timeline"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

function VoiceoverBar() {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const addClip = useEditorStore((s) => s.addClipFromAsset);
  const setJob = useUIStore((s) => s.setJob);
  const clearJob = useUIStore((s) => s.clearJob);
  const recorder = useRef(new VoiceRecorder());
  const [recording, setRecording] = useState(false);

  const toggle = async () => {
    if (!recording) {
      try {
        await recorder.current.start();
        setRecording(true);
        setJob({ id: 'voiceover', label: 'Recording voiceover', detail: 'Click again to stop', progress: -1 });
      } catch (err) {
        setJob({ id: 'voiceover', label: 'Microphone unavailable', detail: '', progress: 1, error: (err as Error).message });
      }
      return;
    }

    setRecording(false);
    try {
      const blob = await recorder.current.stop();
      const asset = await addGeneratedAudio('Voiceover', blob, fps);
      addClip(asset.id, null, playback.currentFrame);
      clearJob('voiceover');
    } catch (err) {
      setJob({ id: 'voiceover', label: 'Recording failed', detail: '', progress: 1, error: (err as Error).message });
    }
  };

  return (
    <div className="voiceover-bar">
      <button className={`btn ${recording ? 'btn-primary' : 'btn-secondary'}`} style={{ width: '100%' }} onClick={() => void toggle()}>
        <Icon name={recording ? 'pause' : 'mic'} size={14} />
        {recording ? 'Stop recording' : 'Record voiceover'}
      </button>
    </div>
  );
}
