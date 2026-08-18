import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { saveCurrentProject } from '../services/projects';
import { platform } from './usePlatform';

const INTERVAL_MS = 30_000;

/**
 * Auto-save every 30 seconds while the editor is open, plus on the way out.
 * Only writes when something actually changed, so an idle editor never touches
 * the disk. Honours the "Auto-save every 30s" preference — when off, the user's
 * explicit saves (Ctrl+S, the menu, returning to projects) still persist.
 */
export function useAutoSave() {
  const savingRef = useRef(false);
  const enabledRef = useRef(true);

  useEffect(() => {
    let alive = true;
    const readPref = () =>
      platform
        .getSetting<{ autoSaveEnabled?: boolean }>('preferences')
        .then((p) => {
          if (alive && p && typeof p.autoSaveEnabled === 'boolean') enabledRef.current = p.autoSaveEnabled;
        })
        .catch(() => {});
    void readPref();

    const tick = async () => {
      if (savingRef.current) return;
      await readPref(); // pick up a mid-session toggle
      if (!enabledRef.current) return;
      const { meta, dirty } = useEditorStore.getState();
      if (!meta || !dirty) return;
      savingRef.current = true;
      try {
        await saveCurrentProject();
      } finally {
        savingRef.current = false;
      }
    };

    const timer = window.setInterval(tick, INTERVAL_MS);

    // Best-effort flush on close. The write is synchronous enough in the main
    // process that a normal quit lands it; a hard kill loses at most 30s.
    const onBeforeUnload = () => {
      const { meta, dirty } = useEditorStore.getState();
      if (meta && dirty) void saveCurrentProject();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Save when the window loses focus — the moment users alt-tab away.
    const onBlur = () => void tick();
    window.addEventListener('blur', onBlur);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('blur', onBlur);
      void tick();
    };
  }, []);
}
