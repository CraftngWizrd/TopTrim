import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaAsset } from '../../../types/project';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore, type MediaSubNav } from '../../stores/uiStore';
import { useMediaImport } from '../../hooks/useMediaImport';
import { useContextMenu } from '../common/ContextMenu';
import { Icon } from '../common/Icon';
import { formatDuration } from '../../../engine/time';
import { formatBytes } from '../../../engine/media';
import { frameList, getFrameAt, onStoryboardUpdate } from '../../../engine/storyboard';
import { playback } from '../../../engine/playback';

const SUB_NAV: { id: MediaSubNav; label: string; badge?: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'yours', label: 'Yours' },
  { id: 'generate', label: 'Generate', badge: 'AI' },
  { id: 'library', label: 'Library' },
];

export function MediaTab() {
  const assets = useEditorStore((s) => s.state.assets);
  const subNav = useUIStore((s) => s.mediaSubNav);
  const setSubNav = useUIStore((s) => s.setMediaSubNav);
  const { pickAndImport, importDropped } = useMediaImport();
  const [dropping, setDropping] = useState(false);
  const [query, setQuery] = useState('');
  const depth = useRef(0);

  const list = useMemo(() => {
    const all = Object.values(assets).sort((a, b) => b.importedAt - a.importedAt);
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
    if (subNav === 'library') return filtered.filter((a) => a.kind === 'audio');
    return filtered;
  }, [assets, query, subNav]);

  return (
    <div
      className={`asset-panel${dropping ? ' is-drop' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        if (e.dataTransfer.types.includes('Files')) setDropping(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        if (--depth.current <= 0) {
          depth.current = 0;
          setDropping(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDropping(false);
        void importDropped(e.dataTransfer);
      }}
    >
      <button className="import-btn" onClick={() => void pickAndImport()}>
        <Icon name="plus" size={15} />
        Import
      </button>

      <div className="media-subnav">
        {SUB_NAV.map((s) => (
          <button
            key={s.id}
            className={`media-subnav-item${subNav === s.id ? ' is-active' : ''}`}
            onClick={() => setSubNav(s.id)}
          >
            <span>{s.label}</span>
            {s.badge && <span className="ai-badge">{s.badge}</span>}
          </button>
        ))}
      </div>

      {subNav === 'generate' ? (
        <GeneratePane />
      ) : (
        <>
          {Object.keys(assets).length > 0 && (
            <div className="media-search">
              <Icon name="search" size={12} />
              <input placeholder="Search media" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}

          <div className="panel-scroll">
            {list.length === 0 ? (
              <MediaEmptyState onImport={() => void pickAndImport()} />
            ) : (
              <div className="media-grid">
                {list.map((asset) => (
                  <MediaCard key={asset.id} asset={asset} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {dropping && (
        <div className="asset-dropzone">
          <Icon name="import" size={22} />
          <span>Drop to import</span>
        </div>
      )}
    </div>
  );
}

function MediaEmptyState({ onImport }: { onImport(): void }) {
  return (
    <div className="media-empty">
      <div className="media-empty-drop" onClick={onImport}>
        <Icon name="import" size={26} />
        <div className="media-empty-title">Drag media here</div>
        <div className="media-empty-hint">or click to browse</div>
      </div>

      <div className="media-empty-label">No media? Create with:</div>
      <div className="media-empty-cards">
        <button className="media-create-card" onClick={() => useUIStore.getState().setMediaSubNav('generate')}>
          <Icon name="sparkles" size={16} />
          <span>Generate</span>
        </button>
        <button className="media-create-card" onClick={() => useUIStore.getState().setAssetTab('audio')}>
          <Icon name="mic" size={16} />
          <span>Record</span>
        </button>
        <button className="media-create-card" onClick={onImport}>
          <Icon name="folder" size={16} />
          <span>Import</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Hover scrub cycles through frames already cached by the storyboard extractor
 * at 8 fps — no additional decoding, which is why it is instant.
 */
function MediaCard({ asset }: { asset: MediaAsset }) {
  const fps = useEditorStore((s) => s.meta?.fps ?? 30);
  const addClip = useEditorStore((s) => s.addClipFromAsset);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const select = useUIStore((s) => s.select);
  const contextMenu = useContextMenu();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovering, setHovering] = useState(false);
  const [, forceRepaint] = useState(0);

  useEffect(() => onStoryboardUpdate(() => forceRepaint((n) => n + 1)), []);

  // Static poster.
  useEffect(() => {
    if (hovering) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bmp = getFrameAt(asset.hash, asset.durationFrames / fps / 2);
    paint(canvas, bmp);
  }, [asset.hash, asset.durationFrames, fps, hovering]);

  // Scrub loop.
  useEffect(() => {
    if (!hovering) return;
    const frames = frameList(asset.hash);
    if (frames.length === 0) return;
    let i = 0;
    const timer = window.setInterval(() => {
      paint(canvasRef.current, frames[i % frames.length]);
      i++;
    }, 125);
    return () => window.clearInterval(timer);
  }, [hovering, asset.hash]);

  const add = () => {
    const clipId = addClip(asset.id, null, playback.currentFrame);
    if (clipId) select([clipId]);
  };

  const menu = contextMenu([
    { label: 'Add to timeline', shortcut: 'Enter', onSelect: add },
    { label: 'Add at playhead', onSelect: add },
    { separator: true },
    { label: 'Remove from project', danger: true, onSelect: () => removeAsset(asset.id) },
  ]);

  return (
    <div
      className="media-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-toptrim-asset', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={add}
      onContextMenu={menu}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      title={`${asset.name}\n${formatBytes(asset.size)}`}
    >
      <div className="media-thumb">
        {asset.kind === 'image' ? (
          <img src={asset.url} alt="" draggable={false} />
        ) : (
          <canvas ref={canvasRef} width={162} height={92} />
        )}
        {asset.kind === 'audio' && (
          <div className="media-thumb-audio">
            <Icon name="waveform" size={20} />
          </div>
        )}
        <span className="media-duration mono">{formatDuration(asset.durationFrames, fps)}</span>
        <button
          className="media-add"
          onClick={(e) => {
            e.stopPropagation();
            add();
          }}
          aria-label="Add to timeline"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      <div className="media-name" title={asset.name}>
        {asset.name}
      </div>
    </div>
  );
}

function paint(canvas: HTMLCanvasElement | null, bmp: ImageBitmap | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!bmp) return;
  // Cover fit — the card is 16:9 and sources rarely are.
  const scale = Math.max(canvas.width / bmp.width, canvas.height / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function GeneratePane() {
  return (
    <div className="panel-scroll">
      <div className="generate-pane">
        <div className="generate-head">
          <Icon name="sparkles" size={18} />
          <div>
            <div className="generate-title">Generate</div>
            <div className="generate-sub">Everything here runs on this machine.</div>
          </div>
        </div>

        <GenerateRow
          icon="mic"
          title="Text to speech"
          body="Type a script, pick a voice, and add the result to the timeline as an audio clip."
          action="Open"
          onAction={() => useUIStore.getState().setAssetTab('text')}
        />
        <GenerateRow
          icon="captions"
          title="Auto captions"
          body="Transcribe the timeline with Whisper and lay the result out as styled caption clips."
          action="Open"
          onAction={() => useUIStore.getState().setAssetTab('captions')}
        />
        <GenerateRow
          icon="music"
          title="Sound effects"
          body="Synthesised whooshes, risers, impacts and pops — generated on demand, no download."
          action="Open"
          onAction={() => useUIStore.getState().setAssetTab('audio')}
        />
      </div>
    </div>
  );
}

function GenerateRow({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  body: string;
  action: string;
  onAction(): void;
}) {
  return (
    <div className="ai-row">
      <div className="ai-row-icon">
        <Icon name={icon} size={15} />
      </div>
      <div className="ai-row-text">
        <div className="ai-row-title">{title}</div>
        <div className="ai-row-body">{body}</div>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
