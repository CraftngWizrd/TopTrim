import type {
  PlatformAdapter,
  PlatformFile,
  OpenFileOptions,
  SaveDialogOptions,
  ProjectRow,
  NativeFFmpeg,
} from './types';
import { rowToMeta, metaToRow } from './types';
import type { Project, ProjectMeta, TimelineState } from '../types/project';

/**
 * WEB CONVERSION: replace this entire file with the web.ts implementation and
 * change the import in src/app/hooks/usePlatform.ts. Nothing else moves.
 */

const api = () => window.electronAPI;

/** 16 MB — large enough to be fast, small enough that a 4K export never spikes RAM. */
const WRITE_CHUNK = 16 * 1024 * 1024;

let nativeFFmpegCache: NativeFFmpeg | null | undefined;

export const electronAdapter: PlatformAdapter = {
  platform: 'electron',

  async nativeFFmpeg() {
    if (nativeFFmpegCache !== undefined) return nativeFFmpegCache;
    const available = await api().ffmpegAvailable();
    nativeFFmpegCache = available
      ? {
          run: (jobId, args, tempFiles, keepTemp) => api().ffmpegRun(jobId, args, tempFiles, keepTemp),
          cancel: (jobId) => api().ffmpegCancel(jobId),
          listFilters: () => api().ffmpegFilters(),
          onLog: (cb) => api().onFfmpegLog(cb),
        }
      : null;
    return nativeFFmpegCache;
  },

  /**
   * A DOM file input, not the native dialog. Electron hands back real `File`
   * objects here, which means huge sources are referenced rather than copied
   * through IPC; `webUtils.getPathForFile` then recovers the absolute path so
   * the asset can be persisted and re-opened later.
   */
  openFile: (options: OpenFileOptions) =>
    new Promise<PlatformFile[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = options.accept;
      input.multiple = options.multiple ?? false;
      input.style.display = 'none';
      document.body.appendChild(input);

      const done = (files: File[]) => {
        input.remove();
        resolve(files.map(attachLocalPath));
      };
      input.onchange = () => done(Array.from(input.files ?? []));
      // A cancelled picker fires no event in some builds; `cancel` covers it.
      input.addEventListener('cancel', () => done([]));
      input.click();
    }),

  async saveFile(data: Blob, options: SaveDialogOptions) {
    const filePath = await api().saveFileDialog(options);
    if (!filePath) return null;

    const token = await api().writeBegin(filePath);
    try {
      for (let offset = 0; offset < data.size; offset += WRITE_CHUNK) {
        const slice = data.slice(offset, Math.min(offset + WRITE_CHUNK, data.size));
        const buf = new Uint8Array(await slice.arrayBuffer());
        await api().writeChunk(token, buf);
      }
    } finally {
      await api().writeEnd(token);
    }
    return filePath;
  },

  pickSavePath: (options: SaveDialogOptions) => api().saveFileDialog(options),
  renderOutputPath: (name: string) => api().renderPath(name),

  async getObjectUrl(filePath: string) {
    return `toptrim://local/${encodeURIComponent(filePath)}`;
  },

  getLocalPath(file: File) {
    return api().getPathForFile(file);
  },

  statFile: (filePath) => api().stat(filePath),
  revealFile: async (filePath) => void api().reveal(filePath),

  async getProjects(): Promise<ProjectMeta[]> {
    const rows: ProjectRow[] = await api().getProjects();
    return rows.map(rowToMeta);
  },

  async getProject(id: string): Promise<Project | null> {
    const row = (await api().getProject(id)) as (ProjectRow & { state: TimelineState | null }) | null;
    if (!row) return null;
    return { ...rowToMeta(row), state: row.state as TimelineState };
  },

  async saveProject(project: Project) {
    await api().saveProject(metaToRow(project), project.state);
  },

  deleteProject: (id) => api().deleteProject(id),
  saveThumbnail: (id, dataUrl) => api().saveThumbnail(id, dataUrl),

  getSetting: <T,>(key: string) => api().getSetting(key) as Promise<T | null>,
  setSetting: <T,>(key: string, value: T) => api().setSetting(key, value),

  minimize: () => void api().minimize(),
  maximize: () => void api().maximize(),
  close: () => void api().close(),
  setTitle: (title) => void api().setTitle(title),
  isMaximized: () => api().isMaximized(),
  onWindowState: (cb) => api().onWindowState(cb),
};

function attachLocalPath(file: File): PlatformFile {
  const f = file as PlatformFile;
  try {
    const p = window.electronAPI.getPathForFile(file);
    if (p) f.localPath = p;
  } catch {
    /* File came from somewhere without a disk path (e.g. clipboard paste). */
  }
  return f;
}
