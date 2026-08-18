import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { cancelStoryboard, setStoryboardReporter } from '../../engine/storyboard';

/**
 * Bridges storyboard extraction into the jobs overlay.
 *
 * Thumbnail extraction is background work, so it must never block — but it has
 * to be legible: how far along it is, how long it has taken, roughly how long
 * is left, and a way to stop it. Without this the only symptom of a stalled
 * extractor is a clip that shimmers forever.
 */
export function useStoryboardReporter() {
  useEffect(() => {
    const ui = useUIStore.getState();
    const active = new Map<string, { name: string; startedAt: number }>();
    const JOB = 'storyboard';

    const paint = () => {
      if (active.size === 0) {
        ui.clearJob(JOB);
        return;
      }
      // Collapsed into one card: several clips extracting at once should not
      // bury the rest of the UI under a stack of near-identical toasts.
      const entries = [...active.entries()];
      const earliest = Math.min(...entries.map(([, v]) => v.startedAt));
      const names = entries.map(([, v]) => v.name);

      ui.setJob({
        id: JOB,
        label: names.length === 1 ? 'Building storyboard' : `Building ${names.length} storyboards`,
        detail: names.length === 1 ? names[0] : names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : ''),
        progress: -1,
        startedAt: earliest,
        onCancel: () => {
          for (const [hash] of entries) cancelStoryboard(hash);
          active.clear();
        },
      });
    };

    setStoryboardReporter((event) => {
      switch (event.kind) {
        case 'start': {
          if (!active.has(event.hash)) {
            active.set(event.hash, { name: event.assetName, startedAt: Date.now() });
          }
          paint();
          break;
        }
        case 'progress': {
          const entry = active.get(event.hash);
          if (!entry) break;
          const fraction = event.total > 0 ? Math.min(1, event.done / event.total) : -1;
          ui.setJob({
            id: JOB,
            label: active.size === 1 ? 'Building storyboard' : `Building ${active.size} storyboards`,
            detail: entry.name,
            progress: fraction,
            startedAt: entry.startedAt,
            done_count: event.done,
            total_count: event.total,
            onCancel: () => {
              for (const [hash] of active) cancelStoryboard(hash);
              active.clear();
            },
          });
          break;
        }
        case 'done': {
          active.delete(event.hash);
          paint();
          break;
        }
        case 'error': {
          active.delete(event.hash);
          ui.setJob({
            id: `storyboard-error-${event.hash}`,
            label: 'Thumbnails unavailable',
            detail: '',
            progress: 1,
            error: `${event.assetName}: ${event.message}`,
          });
          paint();
          break;
        }
      }
    });

    return () => setStoryboardReporter(null);
  }, []);
}
