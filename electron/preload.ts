import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The entire Electron surface available to the renderer.
 * React never imports this directly — it goes through src/platform/electron.ts,
 * which is the single file a future web build replaces.
 */
const api = {
  /* files */
  openFileDialog: (options: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) =>
    ipcRenderer.invoke('file:openDialog', options),
  saveFileDialog: (options: { defaultFilename: string; filters: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:saveDialog', options),
  writeBegin: (filePath: string) => ipcRenderer.invoke('file:writeBegin', filePath),
  writeChunk: (token: string, chunk: Uint8Array) => ipcRenderer.invoke('file:writeChunk', token, chunk),
  writeEnd: (token: string) => ipcRenderer.invoke('file:writeEnd', token),
  stat: (filePath: string) => ipcRenderer.invoke('file:stat', filePath),
  reveal: (filePath: string) => ipcRenderer.invoke('file:reveal', filePath),

  /**
   * Absolute path for a File obtained from a DOM file input or a drop event.
   * This is what lets media import use real File objects (no copying, works for
   * multi-GB sources) while still resolving to a stable path we can persist.
   */
  getPathForFile: (file: File): string | null => {
    try {
      const p = webUtils.getPathForFile(file) || null;
      // Authorize the resolved path for reading. This runs only for a real
      // dropped/picked File — it cannot be invoked for an arbitrary string, so
      // it is not a self-authorization hole. `fs:authorize` is intentionally not
      // exposed on the bridge, so page scripts can't call it directly.
      if (p) ipcRenderer.sendSync('fs:authorize', p);
      return p;
    } catch {
      return null;
    }
  },

  /* native ffmpeg */
  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg:available'),
  ffmpegRun: (
    jobId: string,
    args: string[],
    tempFiles: { name: string; data: Uint8Array }[],
    keepTemp?: boolean
  ) => ipcRenderer.invoke('ffmpeg:run', jobId, args, tempFiles, keepTemp ?? false),
  ffmpegCancel: (jobId: string) => ipcRenderer.invoke('ffmpeg:cancel', jobId),
  ffmpegFilters: () => ipcRenderer.invoke('ffmpeg:filters'),
  renderPath: (name: string) => ipcRenderer.invoke('media:renderPath', name),
  onFfmpegLog: (cb: (msg: { jobId: string; text: string }) => void) => {
    const handler = (_e: unknown, msg: { jobId: string; text: string }) => cb(msg);
    ipcRenderer.on('ffmpeg:log', handler);
    return () => ipcRenderer.off('ffmpeg:log', handler);
  },

  /* projects */
  getProjects: () => ipcRenderer.invoke('projects:getAll'),
  getProject: (id: string) => ipcRenderer.invoke('projects:get', id),
  saveProject: (row: unknown, state: unknown) => ipcRenderer.invoke('projects:save', row, state),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  saveThumbnail: (id: string, dataUrl: string) => ipcRenderer.invoke('projects:saveThumbnail', id, dataUrl),

  /* settings */
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),

  /* window */
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  setTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (cb: (s: { maximized: boolean }) => void) => {
    const handler = (_e: unknown, s: { maximized: boolean }) => cb(s);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.off('window:state', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
