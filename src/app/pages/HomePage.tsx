import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectMeta } from '../../types/project';
import type { PlatformFile } from '../../platform/types';
import { usePlatform } from '../hooks/usePlatform';
import { useUIStore, type ContextMenuEntry } from '../stores/uiStore';
import { Icon } from '../components/common/Icon';
import { WindowControls } from '../components/common/WindowControls';
import { LogoMark, Wordmark } from '../components/common/Wordmark';
import { useContextMenu } from '../components/common/ContextMenu';
import { Modal } from '../components/common/Modal';
import { formatDuration } from '../../engine/time';
import { MEDIA_ACCEPT } from '../../engine/media';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  newProject,
  newProjectFromFiles,
  openProject,
  renameProject,
} from '../services/projects';

type SortKey = 'recent' | 'name' | 'duration';

export function HomePage() {
  const platform = usePlatform();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const contextMenu = useContextMenu();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await listProjects());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    platform.setTitle('TopTrim');
    void refresh();
  }, [platform, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    const sorted = [...matched];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'duration') sorted.sort((a, b) => b.durationFrames / (b.fps || 30) - a.durationFrames / (a.fps || 30));
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [projects, query, sort]);

  /* ---------------- actions ---------------- */

  const handleNew = async () => {
    setBusy('Creating project…');
    try {
      await newProject();
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async () => {
    const files = await platform.openFile({ accept: MEDIA_ACCEPT, multiple: true });
    if (files.length === 0) return;
    setBusy('Importing…');
    try {
      await newProjectFromFiles(files);
    } finally {
      setBusy(null);
    }
  };

  const handleOpen = async (p: ProjectMeta) => {
    setBusy('Opening…');
    try {
      await openProject(p.id);
    } finally {
      setBusy(null);
    }
  };

  /* ---------------- drag and drop ---------------- */

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDropActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDropActive(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);

    const files = Array.from(e.dataTransfer.files) as PlatformFile[];
    if (files.length === 0) return;
    for (const f of files) {
      const p = platform.getLocalPath(f);
      if (p) f.localPath = p;
    }
    setBusy('Importing…');
    try {
      await newProjectFromFiles(files);
    } finally {
      setBusy(null);
    }
  };

  // Annotated so `separator: true` narrows to the literal rather than boolean.
  const menuItems = (p: ProjectMeta): ContextMenuEntry[] => [
      { label: 'Open', onSelect: () => void handleOpen(p) },
      { label: 'Rename…', onSelect: () => setRenaming(p) },
      {
        label: 'Duplicate',
        onSelect: async () => {
          await duplicateProject(p.id);
          void refresh();
        },
      },
      { separator: true },
      {
        label: 'Reveal in file manager',
        disabled: !p.thumbnailPath,
        onSelect: () => p.thumbnailPath && void platform.revealFile(p.thumbnailPath),
      },
      { separator: true },
      {
        label: 'Delete',
        danger: true,
        onSelect: async () => {
          await deleteProject(p.id);
          void refresh();
        },
      },
    ];

  return (
    <div
      className={`home${dropActive ? ' is-drop' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Opposing corner accents in the app's two colours. */}
      <div className="home-corner is-tl" aria-hidden="true" />
      <div className="home-corner is-br" aria-hidden="true" />

      <div className="home-titlebar drag-region">
        <WindowControls />
      </div>

      <div className="home-scroll scroll-y">
        <header className="home-header">
          <LogoMark size={64} />
          <div className="home-wordmark">
            <Wordmark size={32} />
          </div>
          <div className="home-tagline">A free video editor. No watermark, no account, nothing leaves this machine.</div>

          <div className="home-badges">
            <span className="home-badge">
              <Icon name="check" size={10} />
              No watermark
            </span>
            <span className="home-badge">
              <Icon name="check" size={10} />
              No account
            </span>
            <span className="home-badge">
              <Icon name="check" size={10} />
              Runs offline
            </span>
          </div>

          <div className="home-actions">
            <button className="btn btn-primary" onClick={handleNew} style={{ height: 34, padding: '0 18px' }}>
              <Icon name="plus" size={14} />
              New project
            </button>
            <button className="btn btn-secondary" onClick={handleImport} style={{ height: 34, padding: '0 18px' }}>
              <Icon name="import" size={14} />
              Import a video
            </button>
          </div>
        </header>

        <div className="home-toolbar">
          <span className="section-label" style={{ margin: 0 }}>
            {query ? 'Results' : 'Your projects'}
          </span>
          {projects.length > 0 && <span className="home-count">{filtered.length}</span>}

          <div className="home-search">
            <Icon name="search" size={13} />
            <input
              className="home-search-input"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={11} />
              </button>
            )}
          </div>

          <select
            className="select home-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort projects"
          >
            <option value="recent">Last edited</option>
            <option value="name">Name</option>
            <option value="duration">Duration</option>
          </select>
        </div>

        <section className="home-section">
          {loading ? (
            <div className="home-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="project-card is-skeleton">
                  <div className="project-thumb shimmer" />
                  <div className="project-meta">
                    <div className="skeleton-line" style={{ width: '60%' }} />
                    <div className="skeleton-line" style={{ width: '35%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="home-empty">
              <Icon name="film" size={30} />
              <div className="home-empty-title">
                {query ? 'No projects match that search' : 'No projects yet'}
              </div>
              <div className="home-empty-hint">
                {query ? 'Try a different name.' : 'Drop a video anywhere on this screen, or start from scratch.'}
              </div>
              {!query && (
                <div className="home-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" onClick={handleNew}>
                    <Icon name="plus" size={14} />
                    New project
                  </button>
                  <button className="btn btn-secondary" onClick={handleImport}>
                    <Icon name="import" size={14} />
                    Import a video
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="home-grid">
              {/* Primary action sits with the work rather than only in the header. */}
              {!query && (
                <button className="project-new" onClick={handleNew}>
                  <span className="project-new-icon">
                    <Icon name="plus" size={16} />
                  </span>
                  New project
                </button>
              )}
              {filtered.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => void handleOpen(p)} menuItems={menuItems(p)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {dropActive && (
        <div className="home-dropzone">
          <Icon name="import" size={32} />
          <div>Drop to start a new project</div>
        </div>
      )}

      {busy && (
        <div className="home-busy">
          <Icon name="settings" size={16} className="spin" />
          <span>{busy}</span>
        </div>
      )}

      {renaming && (
        <RenameModal
          project={renaming}
          onClose={() => setRenaming(null)}
          onDone={async (name) => {
            await renameProject(renaming.id, name);
            setRenaming(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  menuItems,
}: {
  project: ProjectMeta;
  onOpen(): void;
  menuItems: ContextMenuEntry[];
}) {
  const platform = usePlatform();
  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const [thumb, setThumb] = useState<string | null>(null);

  // Same menu from either route: right-click anywhere on the card, or the
  // explicit button. Right-click alone is not discoverable enough to be the
  // only way to rename or delete a project.
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, menuItems);
  };

  const openMenuFromButton = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Anchor under the button rather than at the pointer, so it lands in the
    // same place however the button was activated.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu(r.right - 4, r.bottom + 4, menuItems);
  };

  // A cover that fails to decode must not leave a broken-image glyph sitting on
  // the card forever: fall back to the placeholder, and allow one retry, since
  // the usual cause is transient (the file was being rewritten as we read it).
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    retried.current = false;
    if (project.thumbnailPath) {
      void platform.getObjectUrl(project.thumbnailPath).then((u) => {
        // `updatedAt` changes every time the cover is re-rendered, so this both
        // busts the cache on a genuine change and keeps the URL stable otherwise.
        if (alive) setThumb(`${u}?v=${project.updatedAt}`);
      });
    } else {
      setThumb(null);
    }
    return () => {
      alive = false;
    };
  }, [platform, project.thumbnailPath, project.updatedAt]);

  const onThumbError = () => {
    if (!retried.current && thumb) {
      retried.current = true;
      setThumb(`${thumb.split('?')[0]}?r=${Date.now()}`);
      return;
    }
    setFailed(true);
  };

  return (
    <div className="project-card" onDoubleClick={onOpen} onContextMenu={openMenu} tabIndex={0}>
      <div className="project-thumb">
        {thumb && !failed ? (
          <img src={thumb} alt="" draggable={false} onError={onThumbError} />
        ) : (
          <div className="project-thumb-empty">
            <Icon name="film" size={22} />
          </div>
        )}

        <span className="project-ratio mono">{aspectLabel(project.width, project.height)}</span>
        <span className="project-duration mono">{formatDuration(project.durationFrames, project.fps || 30)}</span>

        <button className="project-open" onClick={onOpen}>
          <Icon name="play" size={12} />
          Open
        </button>
      </div>
      <div className="project-meta">
        <div className="project-name-row">
          <div className="project-name" title={project.name}>
            {project.name}
          </div>
          <button className="project-menu-btn" onClick={openMenuFromButton} aria-label={`Options for ${project.name}`} title="Options">
            <Icon name="more" size={14} />
          </button>
        </div>
        <div className="project-sub">
          <span>{project.height}p</span>
          <span className="project-dot">·</span>
          <span>{project.fps || 30}fps</span>
          <span className="project-dot">·</span>
          <span>{relativeTime(project.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function RenameModal({
  project,
  onClose,
  onDone,
}: {
  project: ProjectMeta;
  onClose(): void;
  onDone(name: string): void;
}) {
  const [name, setName] = useState(project.name);
  return (
    <Modal
      title="Rename project"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onDone(name.trim() || project.name)}>
            Rename
          </button>
        </>
      }
    >
      <input
        className="input"
        style={{ width: '100%' }}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onDone(name.trim() || project.name)}
      />
    </Modal>
  );
}

/** Nearest common ratio, so a 1918x1080 project still reads as 16:9. */
function aspectLabel(width: number, height: number): string {
  const ratio = width / height;
  const known: [string, number][] = [
    ['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1],
    ['4:3', 4 / 3], ['4:5', 4 / 5], ['21:9', 21 / 9],
  ];
  let best = known[0];
  for (const entry of known) {
    if (Math.abs(entry[1] - ratio) < Math.abs(best[1] - ratio)) best = entry;
  }
  return Math.abs(best[1] - ratio) < 0.06 ? best[0] : `${width}×${height}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
