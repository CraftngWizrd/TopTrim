import type { PlatformAdapter, PlatformFile, OpenFileOptions, SaveDialogOptions } from './types';
import type { Project, ProjectMeta } from '../types/project';

/**
 * WEB CONVERSION: this file is already wired up and ready. The follow-up web
 * prompt replaces the storage stubs below with Supabase calls and flips the
 * import in src/app/hooks/usePlatform.ts. The React app, the workers, the AI
 * features and the stores do not change.
 *
 * The file-access half is already fully implemented — it works today.
 */
export const webAdapter: PlatformAdapter = {
  platform: 'web',

  // No native binary in a browser; export falls back to ffmpeg.wasm.
  // No binary on the web; everything runs through ffmpeg.wasm.
  nativeFFmpeg: async () => null,

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
        resolve(files as PlatformFile[]);
      };
      input.onchange = () => done(Array.from(input.files ?? []));
      input.addEventListener('cancel', () => done([]));
      input.click();
    }),

  async saveFile(data: Blob, options: SaveDialogOptions) {
    // Prefer the File System Access API so large exports stream to disk.
    const anyWin = window as unknown as {
      showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
    };
    if (anyWin.showSaveFilePicker) {
      try {
        const handle = await anyWin.showSaveFilePicker({
          suggestedName: options.defaultFilename,
          types: options.filters.map((f) => ({
            description: f.name,
            accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
          })),
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return handle.name;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return null;
        // Fall through to the anchor download.
      }
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = options.defaultFilename;
    a.click();
    URL.revokeObjectURL(url);
    return options.defaultFilename;
  },

  // A browser never hands out real filesystem paths.
  pickSavePath: async () => null,
  renderOutputPath: async () => null,

  getObjectUrl: async (path: string) => path, // on web, "paths" are already URLs
  getLocalPath: () => null,
  statFile: async () => ({ exists: true, size: 0, mtime: 0 }),
  revealFile: async () => {},

  /* WEB CONVERSION: replace these six with Supabase Postgres + Storage calls. */
  getProjects: async (): Promise<ProjectMeta[]> => [],
  getProject: async (): Promise<Project | null> => null,
  saveProject: async () => {},
  deleteProject: async () => {},
  saveThumbnail: async () => null,
  getSetting: async () => null,
  setSetting: async () => {},

  /* No-ops on web — a page cannot move its own window. */
  minimize: () => {},
  maximize: () => {},
  close: () => {},
  setTitle: (title: string) => {
    document.title = title;
  },
  isMaximized: async () => false,
  onWindowState: () => () => {},
};
