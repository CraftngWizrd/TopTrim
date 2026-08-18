import type { Project, ProjectMeta } from '../types/project';

/**
 * THE web-conversion surface.
 *
 * This interface never changes. `electron.ts` and `web.ts` both implement it,
 * and the React app only ever reaches the platform through `usePlatform()`.
 * Nothing under `src/app` may import from `electron/` or reference
 * `window.electronAPI` directly.
 */

export interface OpenFileOptions {
  /** Accept string in <input accept> form, e.g. 'video/*,audio/*,image/*'. */
  accept: string;
  multiple?: boolean;
}

export interface SaveDialogOptions {
  defaultFilename: string;
  filters: { name: string; extensions: string[] }[];
}

/**
 * A real `File` — so both platforms get zero-copy access to multi-GB sources —
 * carrying the absolute disk path when the host can provide one.
 *
 * Electron resolves `localPath` via `webUtils.getPathForFile`; on web it stays
 * undefined and the app falls back to the object URL, which is exactly the
 * behaviour the web build wants.
 */
export type PlatformFile = File & { localPath?: string };

export interface FileStat {
  exists: boolean;
  size: number;
  mtime: number;
}

/**
 * A real ffmpeg binary, when the host can provide one.
 *
 * Desktop has this; the web build does not and falls back to ffmpeg.wasm. The
 * difference is not cosmetic — WASM software encoding renders 1080p at a few
 * frames per second, while the native binary reads sources straight off disk
 * and can use hardware encoders.
 */
export interface NativeFFmpeg {
  /**
   * Args may contain `{TMP}`, replaced with a per-job scratch directory.
   *
   * `keepTemp` leaves that directory in place so a following pass with the same
   * jobId can read what this one wrote; the last pass must not set it.
   */
  run(
    jobId: string,
    args: string[],
    tempFiles: { name: string; data: Uint8Array }[],
    keepTemp?: boolean
  ): Promise<{ code: number; stderr: string; cancelled: boolean }>;
  cancel(jobId: string): Promise<boolean>;
  /**
   * Filter names this binary supports. Empty means "could not tell", which
   * callers must treat as unknown rather than as "supports nothing".
   */
  listFilters(): Promise<string[]>;
  /** Raw stderr as it streams; callers parse `time=` for progress. */
  onLog(cb: (msg: { jobId: string; text: string }) => void): () => void;
}

export interface PlatformAdapter {
  platform: 'electron' | 'web';

  /** Null when only ffmpeg.wasm is available. */
  nativeFFmpeg(): Promise<NativeFFmpeg | null>;
  /**
   * A durable path to write a rendered asset to. Null on hosts with no
   * filesystem, where renders stay in memory as blobs.
   */
  renderOutputPath(name: string): Promise<string | null>;

  /* File access */
  openFile(options: OpenFileOptions): Promise<PlatformFile[]>;
  saveFile(data: Blob, options: SaveDialogOptions): Promise<string | null>;
  /**
   * Ask where to save without writing anything — for renderers that produce the
   * file themselves (native ffmpeg writes straight to the destination).
   * Null when the host cannot hand out real paths, e.g. the browser.
   */
  pickSavePath(options: SaveDialogOptions): Promise<string | null>;
  /** Local absolute path -> a URL a <video>/<img> can load. */
  getObjectUrl(filePath: string): Promise<string>;
  /** Absolute path for a dropped/picked File, when the host exposes one. */
  getLocalPath(file: File): string | null;
  statFile(filePath: string): Promise<FileStat>;
  revealFile(filePath: string): Promise<void>;

  /* Project storage */
  getProjects(): Promise<ProjectMeta[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  saveThumbnail(projectId: string, dataUrl: string): Promise<string | null>;

  /* Settings */
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;

  /* Window controls (Electron: real; Web: no-op) */
  minimize(): void;
  maximize(): void;
  close(): void;
  setTitle(title: string): void;
  isMaximized(): Promise<boolean>;
  onWindowState(cb: (s: { maximized: boolean }) => void): () => void;
}

/** Shape sent over IPC — the renderer converts it to/from `Project`. */
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

export const rowToMeta = (r: ProjectRow): ProjectMeta => ({
  id: r.id,
  name: r.name,
  width: r.width,
  height: r.height,
  fps: r.fps,
  durationFrames: r.duration_frames,
  thumbnailPath: r.thumbnail_path,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const metaToRow = (m: ProjectMeta): ProjectRow => ({
  id: m.id,
  name: m.name,
  width: m.width,
  height: m.height,
  fps: m.fps,
  duration_frames: m.durationFrames,
  thumbnail_path: m.thumbnailPath,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
});
