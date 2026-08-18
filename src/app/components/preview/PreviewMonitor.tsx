import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../common/Icon';
import { IconButton } from '../common/Controls';
import { useContextMenu } from '../common/ContextMenu';
import { playback, type Composition, type PlaybackClip } from '../../../engine/playback';
import { formatTimecode } from '../../../engine/time';
import { ASPECT_PRESETS } from '../../../engine/defaults';
import { CompositorLayers } from './CompositorLayers';
import { SelectionOverlay } from './SelectionOverlay';

export function PreviewMonitor() {
  const meta = useEditorStore((s) => s.meta);
  const state = useEditorStore((s) => s.state);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playing = useUIStore((s) => s.playing);
  const setPlaying = useUIStore((s) => s.setPlaying);
  const volume = useUIStore((s) => s.volume);
  const muted = useUIStore((s) => s.muted);
  const setVolume = useUIStore((s) => s.setVolume);
  const toggleMute = useUIStore((s) => s.toggleMute);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreenPreview);
  const fullscreen = useUIStore((s) => s.fullscreenPreview);

  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState(0);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const contextMenu = useContextMenu();

  const fps = meta?.fps ?? 30;
  const projectW = meta?.width ?? 1920;
  const projectH = meta?.height ?? 1080;

  /* ---------- engine wiring ---------- */

  useEffect(() => {
    playback.attachVideos(videoA.current, videoB.current);
    playback.attachTimecode(timecodeRef.current);
    return () => playback.attachVideos(null, null);
  }, []);

  useEffect(() => playback.onFrame(setFrame), []);

  useEffect(
    () =>
      playback.onPlayStateChange((v) => {
        setPlaying(v);
        // Park the store's playhead where playback stopped; during playback the
        // store is intentionally left alone so nothing re-renders.
        if (!v) setPlayhead(playback.currentFrame);
      }),
    [setPlaying, setPlayhead]
  );

  useEffect(() => playback.setVolume(volume, muted), [volume, muted]);
  useEffect(() => playback.setLoop(state.loop), [state.loop]);

  /** Translate the timeline into the flat clip list the engine plays. */
  const composition = useMemo<Composition>(() => {
    const trackIndex = new Map(state.tracks.map((t, i) => [t.id, state.tracks.length - i]));
    const visual: PlaybackClip[] = [];
    const audio: PlaybackClip[] = [];

    for (const clip of Object.values(state.clips)) {
      const track = state.tracks.find((t) => t.id === clip.trackId);
      if (!track || track.hidden || !clip.enabled) continue;
      const asset = clip.assetId ? state.assets[clip.assetId] : undefined;
      if (!asset) continue;

      const entry: PlaybackClip = {
        id: clip.id,
        kind: clip.kind === 'image' ? 'image' : clip.kind === 'audio' ? 'audio' : 'video',
        url: asset.url,
        start: clip.start,
        duration: clip.duration,
        inPoint: clip.inPoint,
        speed: clip.speed,
        reversed: clip.reversed,
        muted: clip.audio.muted || track.muted,
        volume: dbToLinear(clip.audio.volumeDb + track.volumeDb),
        layer: trackIndex.get(clip.trackId) ?? 0,
        trackId: clip.trackId,
        transitionOut: clip.transitionOut
          ? { transitionId: clip.transitionOut.transitionId, durationFrames: clip.transitionOut.durationFrames }
          : null,
      };

      if (entry.kind === 'audio') audio.push(entry);
      else visual.push(entry);
    }

    return { fps, durationFrames: computeEnd(state.clips), visual, audio };
  }, [state, fps]);

  useEffect(() => playback.setComposition(composition), [composition]);

  /* ---------- stage sizing ---------- */

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!stageSize.w || !stageSize.h) return { w: 0, h: 0, scale: 1 };
    const scale = Math.min(stageSize.w / projectW, stageSize.h / projectH);
    return { w: projectW * scale, h: projectH * scale, scale };
  }, [stageSize, projectW, projectH]);

  const isEmpty = composition.visual.length === 0 && composition.audio.length === 0;

  const monitorMenu = contextMenu([
    { label: 'Fit to window', onSelect: () => {} },
    { label: fullscreen ? 'Exit fullscreen' : 'Fullscreen preview', shortcut: 'F', onSelect: toggleFullscreen },
    { separator: true },
    { label: 'Go to start', shortcut: 'Home', onSelect: () => playback.goToStart() },
    { label: 'Go to end', shortcut: 'End', onSelect: () => playback.goToEnd() },
  ]);

  const onAspectChange = useCallback(
    (value: string) => {
      const preset = ASPECT_PRESETS.find((p) => p.value === value);
      if (!preset?.ratio || !meta) return;
      // Keep the long edge, derive the short one, and stay on even numbers so
      // every encoder accepts the result.
      const base = Math.max(meta.width, meta.height);
      const [w, h] = preset.ratio >= 1 ? [base, Math.round(base / preset.ratio)] : [Math.round(base * preset.ratio), base];
      useEditorStore.getState().setMeta({ width: even(w), height: even(h) });
    },
    [meta]
  );

  return (
    <div className="preview" onContextMenu={monitorMenu}>
      <div className="preview-topbar">
        <span ref={timecodeRef} className="preview-timecode mono">
          {formatTimecode(frame, fps)}
        </span>
        <span className="preview-duration mono">/ {formatTimecode(composition.durationFrames, fps)}</span>
        <div style={{ flex: 1 }} />
        <IconButton icon="more" title="Preview options" onClick={(e) => monitorMenu(e)} />
      </div>

      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-canvas"
          style={{ width: fit.w || undefined, height: fit.h || undefined }}
        >
          <video ref={videoA} className="preview-video" playsInline muted={false} />
          <video ref={videoB} className="preview-video" playsInline muted />
          <CompositorLayers frame={frame} scale={fit.scale} projectWidth={projectW} projectHeight={projectH} />
          <SelectionOverlay frame={frame} scale={fit.scale} projectWidth={projectW} projectHeight={projectH} />

          {isEmpty && (
            <div className="preview-empty">
              <Icon name="film" size={26} />
              <span>Drag media here to start editing</span>
            </div>
          )}
        </div>
      </div>

      <div className="preview-transport">
        <div className="transport-left">
          <IconButton icon={muted || volume === 0 ? 'volume-mute' : 'volume'} title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
          <input
            className="volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
          />
        </div>

        <div className="transport-center">
          <IconButton icon="skip-start" title="Go to start" shortcut="Home" onClick={() => playback.goToStart()} size={28} iconSize={14} />
          <IconButton icon="rewind" title="Rewind" shortcut="J" onClick={() => playback.shuttle(-2)} size={28} iconSize={14} />
          <IconButton icon="step-back" title="Frame back" shortcut="←" onClick={() => playback.step(-1)} size={28} iconSize={14} />
          <button
            className="transport-play"
            onClick={() => {
              playback.resetRate();
              playback.toggle();
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <Icon name={playing ? 'pause' : 'play'} size={15} />
          </button>
          <IconButton icon="step-forward" title="Frame forward" shortcut="→" onClick={() => playback.step(1)} size={28} iconSize={14} />
          <IconButton icon="forward" title="Fast forward" shortcut="L" onClick={() => playback.shuttle(2)} size={28} iconSize={14} />
          <IconButton icon="skip-end" title="Go to end" shortcut="End" onClick={() => playback.goToEnd()} size={28} iconSize={14} />
        </div>

        <div className="transport-right">
          <IconButton icon="fit" title="Fit to window" onClick={() => {}} />
          <select
            className="select select-sm"
            value={currentAspect(projectW, projectH)}
            onChange={(e) => onAspectChange(e.target.value)}
            aria-label="Aspect ratio"
          >
            {ASPECT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <IconButton icon="fullscreen" title="Fullscreen preview" shortcut="F" onClick={toggleFullscreen} active={fullscreen} />
        </div>
      </div>
    </div>
  );
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);
const dbToLinear = (db: number) => Math.pow(10, db / 20);

function computeEnd(clips: Record<string, { start: number; duration: number }>): number {
  let max = 0;
  for (const c of Object.values(clips)) max = Math.max(max, c.start + c.duration);
  return max;
}

function currentAspect(w: number, h: number): string {
  const ratio = w / h;
  const match = ASPECT_PRESETS.find((p) => p.ratio && Math.abs(p.ratio - ratio) < 0.02);
  return match?.value ?? 'original';
}
