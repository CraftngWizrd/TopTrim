import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { usePlatform } from '../hooks/usePlatform';
import { Icon } from './common/Icon';
import { IconButton } from './common/Controls';
import { WindowControls } from './common/WindowControls';
import { Wordmark } from './common/Wordmark';
import { MEDIA_ACCEPT, importFiles } from '../../engine/media';
import { closeToHome, newProject, saveCurrentProject } from '../services/projects';

export function TitleBar() {
  const meta = useEditorStore((s) => s.meta);
  const setMeta = useEditorStore((s) => s.setMeta);
  const openModal = useUIStore((s) => s.openModal);

  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const commitName = () => {
    const name = draft.trim();
    if (name && name !== meta?.name) setMeta({ name });
    setEditingName(false);
  };

  return (
    <div className="titlebar drag-region">
      {/*
        These containers cover the bar edge to edge, and -webkit-app-region is
        not inherited, so the bar's own `drag` never reaches them. base.css
        pushes `drag` down to descendants and exempts the controls; see the
        drag-region block there.
      */}
      <div className="titlebar-brand">
        <Wordmark size={13} showMark />
      </div>

      <MainMenu open={menuOpen} setOpen={setMenuOpen} />

      <div className="titlebar-center">
        {editingName ? (
          <input
            className="titlebar-name-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
          />
        ) : (
          <button
            className="titlebar-name"
            onClick={() => {
              setDraft(meta?.name ?? '');
              setEditingName(true);
            }}
            title="Click to rename"
          >
            {meta?.name ?? 'Untitled project'}
          </button>
        )}
        <SyncStatus />
      </div>

      <div className="titlebar-right">
        <IconButton icon="layers" title="Layout" onClick={() => openModal('settings')} />
        <IconButton icon="keyboard" title="Keyboard shortcuts" shortcut="?" onClick={() => openModal('shortcuts')} />
        <button className="btn btn-primary btn-sm" style={{ height: 24 }} onClick={() => openModal('export')}>
          Export
        </button>
      </div>

      {/* Rightmost, as Windows places them. */}
      <WindowControls />
    </div>
  );
}

/** "Saved · 2s ago" / "Saving…" / "Unsaved changes" */
function SyncStatus() {
  const dirty = useEditorStore((s) => s.dirty);
  const saving = useEditorStore((s) => s.saving);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  let text: string;
  if (saving) text = 'Saving…';
  else if (dirty) text = 'Unsaved changes';
  else if (lastSavedAt) text = `Saved · ${ago(lastSavedAt)}`;
  else text = 'Saved';

  return <span className="titlebar-sync">· {text}</span>;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function MainMenu({ open, setOpen }: { open: boolean; setOpen(v: boolean): void }) {
  const platform = usePlatform();
  const openModal = useUIStore((s) => s.openModal);
  const editor = useEditorStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, setOpen]);

  const items: { label: string; shortcut?: string; onSelect(): void; separator?: boolean }[] = [
    // Saves first, so leaving never loses the last few seconds of work.
    { label: 'Back to projects', shortcut: 'Ctrl+O', onSelect: () => void closeToHome() },
    { label: '', separator: true, onSelect: () => {} },
    { label: 'New project', shortcut: 'Ctrl+N', onSelect: () => void newProject() },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: () => void saveCurrentProject() },
    { label: '', separator: true, onSelect: () => {} },
    {
      label: 'Import media…',
      shortcut: 'Ctrl+I',
      onSelect: async () => {
        const files = await platform.openFile({ accept: MEDIA_ACCEPT, multiple: true });
        if (files.length === 0) return;
        const fps = editor.meta?.fps ?? 30;
        const { assets } = await importFiles(files, platform, fps);
        editor.addAssets(assets);
      },
    },
    { label: 'Export…', shortcut: 'Ctrl+E', onSelect: () => openModal('export') },
    { label: '', separator: true, onSelect: () => {} },
    { label: 'Settings', onSelect: () => openModal('settings') },
    { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => openModal('shortcuts') },
    { label: 'About TopTrim', onSelect: () => openModal('about') },
  ];

  return (
    <div className="titlebar-menu" ref={ref}>
      <button className={`titlebar-menu-btn${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)}>
        Menu
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="context-menu" style={{ position: 'absolute', left: 0, top: 26, minWidth: 210 }}>
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="context-sep" />
            ) : (
              <div
                key={i}
                className="context-item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="context-shortcut">{item.shortcut}</span>}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
