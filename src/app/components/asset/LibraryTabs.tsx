import { useMemo, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../common/Icon';
import { EFFECTS, EFFECT_CATEGORIES, isExportOnly, type EffectDef } from '../../../engine/effects';
import { TRANSITIONS, TRANSITION_CATEGORIES, type TransitionDef } from '../../../engine/transitions';
import { FILTERS, FILTER_CATEGORIES, STICKERS, STICKER_CATEGORIES, stickerDataUrl, type FilterDef, type StickerDef } from '../../../engine/libraries';
import { createClip, defaultColorGrade, id as newId } from '../../../engine/defaults';
import { playback } from '../../../engine/playback';
import { findJunctions } from '../../../engine/junctions';
import { DND_EFFECT, DND_FILTER, DND_TRANSITION } from '../../../engine/dragTypes';

/* ------------------------------------------------------------------ *
 * Shared scaffolding
 * ------------------------------------------------------------------ */

function LibraryShell({
  categories,
  category,
  setCategory,
  query,
  setQuery,
  placeholder,
  children,
  hint,
}: {
  categories: { id: string; label: string }[];
  category: string;
  setCategory(c: string): void;
  query: string;
  setQuery(q: string): void;
  placeholder: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="asset-panel">
      <div className="media-search" style={{ marginTop: 8 }}>
        <Icon name="search" size={12} />
        <input placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="chips">
        {categories.map((c) => (
          <button key={c.id} className={`chip${category === c.id ? ' is-active' : ''}`} onClick={() => setCategory(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {hint && <div className="library-hint">{hint}</div>}
      <div className="panel-scroll">{children}</div>
    </div>
  );
}

/**
 * Library tile.
 *
 * Draggable as well as clickable: dropping is the direct way to say WHERE
 * something goes — a transition onto a specific seam, an effect onto a specific
 * clip — which clicking cannot express without a prior selection.
 */
/**
 * Build the image dragged under the cursor.
 *
 * Without this the browser snapshots the drag source itself, and because the
 * tiles sit in a tight grid that snapshot picked up whatever was painted
 * behind and above it — so dragging one transition showed two. A purpose-built
 * node is also just clearer: a small chip naming what is being dropped.
 *
 * The node has to be in the document when setDragImage reads it, and gone
 * immediately afterwards; the browser has already rasterised it by the time
 * the timeout fires.
 */
function setLibraryDragImage(e: React.DragEvent, name: string, swatch: [string, string]) {
  const chip = document.createElement('div');
  chip.className = 'lib-drag-chip';
  chip.style.setProperty('--sw-a', swatch[0]);
  chip.style.setProperty('--sw-b', swatch[1]);

  const dot = document.createElement('span');
  dot.className = 'lib-drag-chip-dot';
  const label = document.createElement('span');
  label.textContent = name;
  chip.append(dot, label);

  document.body.appendChild(chip);
  const r = chip.getBoundingClientRect();
  // Anchor under the pointer rather than at a corner, so the chip tracks the
  // drop point the timeline is highlighting.
  e.dataTransfer.setDragImage(chip, r.width / 2, r.height / 2);
  window.setTimeout(() => chip.remove(), 0);
}

function SwatchTile({
  name,
  swatch,
  selected,
  onClick,
  dragType,
  dragId,
  variant = 'effect',
  hint,
  badge,
  children,
}: {
  name: string;
  swatch: [string, string];
  selected?: boolean;
  onClick(): void;
  dragType?: string;
  dragId?: string;
  variant?: 'effect' | 'transition' | 'filter';
  hint?: string;
  /** Corner tag, e.g. for effects that only appear in the exported file. */
  badge?: string;
  children?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <button
      className={`lib-tile${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`}
      onClick={onClick}
      title={hint ? `${name} — ${hint}` : name}
      draggable={!!dragType}
      onDragStart={(e) => {
        if (!dragType || !dragId) return;
        e.dataTransfer.setData(dragType, dragId);
        e.dataTransfer.effectAllowed = 'copy';
        setLibraryDragImage(e, name, swatch);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div
        className={`lib-thumb lib-thumb-${variant}`}
        style={{ ['--sw-a' as string]: swatch[0], ['--sw-b' as string]: swatch[1] }}
      >
        {children}
        {badge && <span className="lib-badge">{badge}</span>}
        <span className="lib-play">
          <Icon name="play" size={11} />
        </span>
      </div>
      <span className="lib-name">{name}</span>
    </button>
  );
}

/** Groups a library into labelled sections instead of one undifferentiated wall. */
function GroupedGrid<T extends { id: string; name: string; category: string }>({
  items,
  categories,
  activeCategory,
  render,
}: {
  items: T[];
  categories: { id: string; label: string }[];
  activeCategory: string;
  render(item: T): React.ReactNode;
}) {
  // With a category selected there is nothing to group by, so show a flat grid.
  if (activeCategory !== 'all') {
    return <div className="lib-grid">{items.map(render)}</div>;
  }
  return (
    <>
      {categories
        .filter((c) => c.id !== 'all')
        .map((cat) => {
          const group = items.filter((i) => i.category === cat.id);
          if (group.length === 0) return null;
          return (
            <section key={cat.id} className="lib-group">
              <div className="lib-group-head">
                <span>{cat.label}</span>
                <span className="lib-group-count mono">{group.length}</span>
              </div>
              <div className="lib-grid">{group.map(render)}</div>
            </section>
          );
        })}
    </>
  );
}

function useSelectedClip() {
  const selection = useUIStore((s) => s.selection);
  const clips = useEditorStore((s) => s.state.clips);
  return selection.length === 1 ? clips[selection[0]] : null;
}

function NoSelectionHint({ what }: { what: string }) {
  return <div className="library-hint">Select a clip on the timeline to apply {what}.</div>;
}

/* ------------------------------------------------------------------ *
 * Effects
 * ------------------------------------------------------------------ */

export function EffectsTab() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const clip = useSelectedClip();
  const addEffect = useEditorStore((s) => s.addEffect);
  const commit = useEditorStore((s) => s.commit);

  const list = useMemo(() => filterList(EFFECTS, category, query), [category, query]);

  const toggle = (def: EffectDef) => {
    if (!clip) return;
    // Clicking an applied effect removes it; dropping always adds.
    if (clip.effects.some((x) => x.effectId === def.id)) {
      commit(`Remove ${def.name}`, (d) => {
        const c = d.clips[clip.id];
        if (c) c.effects = c.effects.filter((e) => e.effectId !== def.id);
      });
      return;
    }
    addEffect(clip.id, def.id);
  };

  return (
    <LibraryShell
      categories={EFFECT_CATEGORIES}
      category={category}
      setCategory={setCategory}
      query={query}
      setQuery={setQuery}
      placeholder="Search effects"
      hint={clip ? 'Click to apply to the selected clip, or drag onto any clip.' : 'Drag an effect onto a clip on the timeline.'}
    >
      <GroupedGrid
        items={list}
        categories={EFFECT_CATEGORIES}
        activeCategory={category}
        render={(e) => (
          <SwatchTile
            key={e.id}
            name={e.name}
            swatch={e.swatch}
            selected={!!clip?.effects.some((x) => x.effectId === e.id)}
            onClick={() => toggle(e)}
            dragType={DND_EFFECT}
            dragId={e.id}
            hint={isExportOnly(e.id) ? 'drag onto a clip · shows on export' : 'drag onto a clip'}
            badge={isExportOnly(e.id) ? 'EXPORT' : undefined}
          />
        )}
      />
    </LibraryShell>
  );
}

/* ------------------------------------------------------------------ *
 * Transitions
 * ------------------------------------------------------------------ */

export function TransitionsTab() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const state = useEditorStore((s) => s.state);
  const applyTransition = useEditorStore((s) => s.applyTransition);
  const clip = useSelectedClip();

  const list = useMemo(() => filterList(TRANSITIONS, category, query), [category, query]);
  // A transition needs a seam, so surface how many exist rather than letting
  // the user click into nothing.
  const junctions = useMemo(() => findJunctions(state), [state]);

  const applyToNearestSeam = (def: TransitionDef) => {
    // Prefer a seam on the selected clip; otherwise the first one on the timeline.
    const preferred =
      junctions.find((j) => j.leftClipId === clip?.id || j.rightClipId === clip?.id) ?? junctions[0];
    if (!preferred) return;
    applyTransition(preferred.leftClipId, preferred.rightClipId, def.id);
  };

  const appliedIds = new Set(
    Object.values(state.clips)
      .map((c) => c.transitionOut?.transitionId)
      .filter(Boolean) as string[]
  );

  return (
    <LibraryShell
      categories={TRANSITION_CATEGORIES}
      category={category}
      setCategory={setCategory}
      query={query}
      setQuery={setQuery}
      placeholder="Search transitions"
      hint={
        junctions.length === 0
          ? 'A transition needs two clips that touch. Butt two clips together on a track, then drop one on the seam.'
          : `Drag onto the join between two clips. ${junctions.length} ${junctions.length === 1 ? 'seam' : 'seams'} on this timeline.`
      }
    >
      <GroupedGrid
        items={list}
        categories={TRANSITION_CATEGORIES}
        activeCategory={category}
        render={(t) => (
          <SwatchTile
            key={t.id}
            name={t.name}
            swatch={t.swatch}
            variant="transition"
            selected={appliedIds.has(t.id)}
            onClick={() => applyToNearestSeam(t)}
            dragType={DND_TRANSITION}
            dragId={t.id}
            hint="drag onto a join between two clips"
          >
            <span className="lib-split" />
          </SwatchTile>
        )}
      />
    </LibraryShell>
  );
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

export function FiltersTab() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const clip = useSelectedClip();
  const commit = useEditorStore((s) => s.commit);
  const applyFilter = useEditorStore((s) => s.applyFilter);
  const [applied, setApplied] = useState<string | null>(null);

  const list = useMemo(() => filterList(FILTERS, category, query), [category, query]);

  const apply = (def: FilterDef) => {
    if (!clip) return;
    setApplied(def.id);
    applyFilter(clip.id, def.id);
  };

  return (
    <LibraryShell
      categories={FILTER_CATEGORIES}
      category={category}
      setCategory={setCategory}
      query={query}
      setQuery={setQuery}
      placeholder="Search filters"
      hint={clip ? 'Click to apply to the selected clip, or drag onto any clip.' : 'Drag a filter onto a clip on the timeline.'}
    >
      <div className="lib-grid">
        <SwatchTile
          name="None"
          swatch={['#1a1a1e', '#3a3a40']}
          variant="filter"
          selected={applied === null}
          onClick={() => {
            if (!clip) return;
            setApplied(null);
            commit('Clear filter', (d) => {
              const c = d.clips[clip.id];
              if (c) c.color = { ...defaultColorGrade(), lut: c.color.lut };
            });
          }}
        />
      </div>
      <GroupedGrid
        items={list}
        categories={FILTER_CATEGORIES}
        activeCategory={category}
        render={(f) => (
          <SwatchTile
            key={f.id}
            name={f.name}
            swatch={f.swatch}
            variant="filter"
            selected={applied === f.id}
            onClick={() => apply(f)}
            dragType={DND_FILTER}
            dragId={f.id}
            hint="drag onto a clip"
          />
        )}
      />
    </LibraryShell>
  );
}

/* ------------------------------------------------------------------ *
 * Stickers
 * ------------------------------------------------------------------ */

export function StickersTab() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const commit = useEditorStore((s) => s.commit);
  const select = useUIStore((s) => s.select);

  const list = useMemo(() => filterList(STICKERS, category, query), [category, query]);

  const add = (def: StickerDef) => {
    const clipId = newId();
    commit(`Add ${def.name}`, (d) => {
      let track = d.tracks.find((t) => t.kind === 'sticker' && !t.locked);
      if (!track) {
        const { createTrack } = { createTrack: makeStickerTrack };
        track = createTrack(d.tracks.filter((t) => t.kind === 'sticker').length + 1);
        d.tracks.push(track);
      }
      const c = createClip({
        trackId: track.id,
        kind: 'sticker',
        name: def.name,
        start: playback.currentFrame,
        duration: 75,
        stickerId: def.id,
      });
      d.clips[clipId] = { ...c, id: clipId };
    });
    select([clipId]);
  };

  return (
    <LibraryShell
      categories={STICKER_CATEGORIES}
      category={category}
      setCategory={setCategory}
      query={query}
      setQuery={setQuery}
      placeholder="Search stickers"
    >
      <div className="lib-grid">
        {list.map((s) => (
          <button key={s.id} className="lib-tile" onClick={() => add(s)} title={s.name}>
            <div className="lib-thumb lib-thumb-sticker">
              <img src={stickerDataUrl(s)} alt="" draggable={false} />
            </div>
            <span className="lib-name">{s.name}</span>
          </button>
        ))}
      </div>
    </LibraryShell>
  );
}

function makeStickerTrack(index: number) {
  return {
    id: newId(),
    kind: 'sticker' as const,
    name: `Sticker ${index}`,
    height: 28,
    hidden: false,
    locked: false,
    muted: false,
    volumeDb: 0,
  };
}

/* ------------------------------------------------------------------ */

function filterList<T extends { name: string; category: string }>(items: T[], category: string, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) => (category === 'all' || i.category === category) && (!q || i.name.toLowerCase().includes(q))
  );
}
