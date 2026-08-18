import { useCallback } from 'react';
import type { PlatformFile } from '../../platform/types';
import type { MediaAsset } from '../../types/project';
import { usePlatform } from './usePlatform';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { MEDIA_ACCEPT, assetHash, importFiles } from '../../engine/media';
import { registerFileHandle } from '../../engine/ffmpegClient';
import { primeStoryboard } from '../../engine/storyboard';
import { ensureWaveform } from '../../engine/waveform';

/**
 * One import path for the picker, drag-and-drop and Ctrl+I.
 *
 * Beyond adding assets to the project it does the two things that make the
 * timeline feel instant: it hands the raw File to the ffmpeg worker registry
 * (so storyboard/waveform work needs no re-read), and kicks off a first pass of
 * frames and peaks in the background.
 */
export function useMediaImport() {
  const platform = usePlatform();

  const ingest = useCallback(
    async (files: PlatformFile[]): Promise<MediaAsset[]> => {
      if (files.length === 0) return [];

      const editor = useEditorStore.getState();
      const ui = useUIStore.getState();
      const fps = editor.meta?.fps ?? 30;

      // Register handles before probing so a failure later still leaves them usable.
      for (const f of files) {
        if (!f.localPath) {
          const p = platform.getLocalPath(f);
          if (p) f.localPath = p;
        }
        registerFileHandle(assetHash(f), f);
      }

      const jobId = `import-${Date.now()}`;
      ui.setJob({ id: jobId, label: 'Importing media', detail: `${files.length} file${files.length === 1 ? '' : 's'}`, progress: -1 });

      const { assets, errors } = await importFiles(files, platform, fps);
      editor.addAssets(assets);

      if (errors.length) {
        ui.setJob({
          id: jobId,
          label: 'Import finished with problems',
          detail: '',
          progress: 1,
          error: errors.map((e) => `${e.name}: ${e.reason}`).join(', '),
        });
      } else {
        ui.setJob({ id: jobId, label: 'Import complete', detail: `${assets.length} added`, progress: 1, done: true });
        window.setTimeout(() => ui.clearJob(jobId), 2200);
      }

      // Background: first storyboard pass and waveform peaks.
      for (const a of assets) {
        primeStoryboard(a, fps);
        void ensureWaveform(a, fps);
      }

      return assets;
    },
    [platform]
  );

  const pickAndImport = useCallback(async () => {
    const files = await platform.openFile({ accept: MEDIA_ACCEPT, multiple: true });
    return ingest(files);
  }, [platform, ingest]);

  /** Attach local paths to dropped files before ingesting them. */
  const importDropped = useCallback(
    async (dataTransfer: DataTransfer) => {
      const files = Array.from(dataTransfer.files) as PlatformFile[];
      for (const f of files) {
        const p = platform.getLocalPath(f);
        if (p) f.localPath = p;
      }
      return ingest(files);
    },
    [platform, ingest]
  );

  return { ingest, pickAndImport, importDropped };
}
