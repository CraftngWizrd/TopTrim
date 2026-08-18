/**
 * Project + settings storage. Main process only — the renderer never touches this.
 *
 * Primary backend is SQLite (better-sqlite3) using the schema in the spec.
 * better-sqlite3 is a native module and needs to be compiled against Electron's
 * ABI (`npm run rebuild`). If it is missing or fails to load we transparently
 * fall back to a JSON file store with identical semantics, so the app is always
 * runnable straight after `npm install`.
 */
import path from 'node:path';
import fs from 'node:fs';

export interface ProjectRow {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration_frames: number;
  thumbnail_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface Store {
  backend: 'sqlite' | 'json';
  getProjects(): ProjectRow[];
  getProject(id: string): (ProjectRow & { state: unknown | null }) | null;
  saveProject(row: ProjectRow, state: unknown): void;
  deleteProject(id: string): void;
  getSetting(key: string): unknown | null;
  setSetting(key: string, value: unknown): void;
  /** Force any buffered write to disk synchronously (called before quit). */
  flush(): void;
  /** Flush and release the backend. */
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled project',
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080,
  fps INTEGER NOT NULL DEFAULT 30,
  duration_frames INTEGER NOT NULL DEFAULT 0,
  thumbnail_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function createSqliteStore(dbPath: string): Store {
  // Resolved lazily so a missing/unbuilt native module degrades instead of crashing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const qAll = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  const qOne = db.prepare('SELECT * FROM projects WHERE id = ?');
  const qState = db.prepare('SELECT state FROM project_state WHERE project_id = ?');
  const qUpsertProject = db.prepare(`
    INSERT INTO projects (id, name, width, height, fps, duration_frames, thumbnail_path, created_at, updated_at)
    VALUES (@id, @name, @width, @height, @fps, @duration_frames, @thumbnail_path, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      width = excluded.width,
      height = excluded.height,
      fps = excluded.fps,
      duration_frames = excluded.duration_frames,
      thumbnail_path = excluded.thumbnail_path,
      updated_at = excluded.updated_at
  `);
  const qUpsertState = db.prepare(`
    INSERT INTO project_state (project_id, state, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `);
  const qDelete = db.prepare('DELETE FROM projects WHERE id = ?');
  const qGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const qSetSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const save = db.transaction((row: ProjectRow, state: unknown) => {
    qUpsertProject.run(row);
    qUpsertState.run(row.id, JSON.stringify(state ?? null), row.updated_at);
  });

  return {
    backend: 'sqlite',
    getProjects: () => qAll.all() as ProjectRow[],
    getProject(id) {
      const row = qOne.get(id) as ProjectRow | undefined;
      if (!row) return null;
      const s = qState.get(id) as { state: string } | undefined;
      return { ...row, state: s ? JSON.parse(s.state) : null };
    },
    saveProject: (row, state) => save(row, state),
    deleteProject: (id) => void qDelete.run(id),
    getSetting(key) {
      const r = qGetSetting.get(key) as { value: string } | undefined;
      return r ? JSON.parse(r.value) : null;
    },
    setSetting: (key, value) => void qSetSetting.run(key, JSON.stringify(value)),
    // better-sqlite3 is synchronous, so every write is already durable on
    // return; a WAL checkpoint on quit keeps the -wal file from growing.
    flush() {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        /* best effort */
      }
    },
    close() {
      try {
        db.close();
      } catch {
        /* already closing */
      }
    },
  };
}

function createJsonStore(jsonPath: string): Store {
  type Shape = {
    projects: Record<string, ProjectRow>;
    project_state: Record<string, unknown>;
    settings: Record<string, unknown>;
  };
  const empty: Shape = { projects: {}, project_state: {}, settings: {} };

  let data: Shape = empty;
  try {
    if (fs.existsSync(jsonPath)) {
      data = { ...empty, ...JSON.parse(fs.readFileSync(jsonPath, 'utf8')) };
    }
  } catch (err) {
    // A parse failure must NOT lead to starting empty and then overwriting the
    // file on the next save — that destroys data that is often hand-recoverable
    // (a truncated tail from a previous crash). Preserve the bad file first.
    try {
      const aside = `${jsonPath}.corrupt-${Date.now()}.json`;
      fs.renameSync(jsonPath, aside);
      console.error(`[toptrim] project store was unreadable; preserved a copy at ${aside}`, err);
    } catch {
      /* best effort — if we can't move it, still don't clobber below on load */
    }
    data = empty;
  }

  // Bounded, NOT trailing, debounce: schedule one write ~50ms after the first
  // dirty change and let it capture the latest data. A trailing debounce
  // (clear+reset on every write) could postpone the write indefinitely under
  // steady autosaves. `writeNow` is the synchronous path used on quit.
  let flushTimer: NodeJS.Timeout | null = null;
  const writeNow = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const tmp = `${jsonPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, jsonPath); // atomic-ish: never leaves a half-written db
  };
  const schedule = () => {
    if (!flushTimer) flushTimer = setTimeout(writeNow, 50);
  };

  return {
    backend: 'json',
    getProjects: () =>
      Object.values(data.projects).sort((a, b) => b.updated_at - a.updated_at),
    getProject(id) {
      const row = data.projects[id];
      if (!row) return null;
      return { ...row, state: data.project_state[id] ?? null };
    },
    saveProject(row, state) {
      data.projects[row.id] = row;
      data.project_state[row.id] = state ?? null;
      schedule();
    },
    deleteProject(id) {
      delete data.projects[id];
      delete data.project_state[id];
      schedule();
    },
    getSetting: (key) => (key in data.settings ? data.settings[key] : null),
    setSetting(key, value) {
      data.settings[key] = value;
      schedule();
    },
    flush: writeNow,
    close: writeNow,
  };
}

/** Thrown when the SQLite db exists but can't be opened — the caller surfaces it. */
export class StoreOpenError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'StoreOpenError';
  }
}

export function createStore(userDataDir: string): Store {
  const dbPath = path.join(userDataDir, 'toptrim.db');
  try {
    return createSqliteStore(dbPath);
  } catch (err) {
    // If a real SQLite db exists but won't open — almost always a native-module
    // ABI mismatch after an Electron upgrade — do NOT silently fall back to an
    // empty JSON store. That would hide every project AND make the next save
    // diverge into a different file (split-brain), looking exactly like total
    // data loss. Surface it so the data stays put until the module is rebuilt.
    if (fs.existsSync(dbPath)) {
      throw new StoreOpenError(
        `Your projects are stored in toptrim.db, but it could not be opened:\n` +
          `${(err as Error).message}\n\n` +
          `This usually means the database engine needs rebuilding for this ` +
          `version of the app. Run \`npm run rebuild\` and reopen.\n\n` +
          `Your projects are safe and untouched.`
      );
    }
    // No existing SQLite db: a genuine first run without the native module.
    console.warn('[toptrim] better-sqlite3 unavailable; using JSON store.', (err as Error).message);
    return createJsonStore(path.join(userDataDir, 'toptrim-db.json'));
  }
}
