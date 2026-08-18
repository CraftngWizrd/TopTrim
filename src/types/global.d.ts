import type { ProjectRow } from '../platform/types';

declare global {
  interface Window {
    electronAPI: {
      openFileDialog(options: {
        filters?: { name: string; extensions: string[] }[];
        multiple?: boolean;
      }): Promise<{ path: string; name: string; size: number }[]>;
      saveFileDialog(options: {
        defaultFilename: string;
        filters: { name: string; extensions: string[] }[];
      }): Promise<string | null>;
      writeBegin(filePath: string): Promise<string>;
      writeChunk(token: string, chunk: Uint8Array): Promise<void>;
      writeEnd(token: string): Promise<void>;
      stat(filePath: string): Promise<{ exists: boolean; size: number; mtime: number }>;
      reveal(filePath: string): Promise<void>;
      getPathForFile(file: File): string | null;

      ffmpegAvailable(): Promise<boolean>;
      ffmpegRun(
        jobId: string,
        args: string[],
        tempFiles: { name: string; data: Uint8Array }[],
        keepTemp?: boolean
      ): Promise<{ code: number; stderr: string; cancelled: boolean }>;
      ffmpegCancel(jobId: string): Promise<boolean>;
      ffmpegFilters(): Promise<string[]>;
      renderPath(name: string): Promise<string>;
      onFfmpegLog(cb: (msg: { jobId: string; text: string }) => void): () => void;

      getProjects(): Promise<ProjectRow[]>;
      getProject(id: string): Promise<unknown>;
      saveProject(row: unknown, state: unknown): Promise<void>;
      deleteProject(id: string): Promise<void>;
      saveThumbnail(id: string, dataUrl: string): Promise<string | null>;

      getSetting(key: string): Promise<unknown>;
      setSetting(key: string, value: unknown): Promise<void>;

      minimize(): Promise<void>;
      maximize(): Promise<void>;
      close(): Promise<void>;
      setTitle(title: string): Promise<void>;
      isMaximized(): Promise<boolean>;
      onWindowState(cb: (s: { maximized: boolean }) => void): () => void;
    };
  }
}

export {};
