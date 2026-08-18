import { electronAdapter } from '../../platform/electron';
import { webAdapter } from '../../platform/web';
import type { PlatformAdapter } from '../../platform/types';

/**
 * Adapter selection — the one place the app is bound to a host.
 *
 * Electron is the build target. The web adapter is picked only when the
 * Electron bridge is absent, which is what lets the identical renderer bundle
 * open in a plain browser for UI work. That fallback is also precisely the
 * switch the web conversion makes permanent (Section 16): delete the Electron
 * branch, keep `webAdapter`, and nothing else in `src/app` changes.
 */
const hasElectronBridge = typeof window !== 'undefined' && !!(window as { electronAPI?: unknown }).electronAPI;

const adapter: PlatformAdapter = hasElectronBridge ? electronAdapter : webAdapter;

/**
 * The ONLY way the React app reaches platform features.
 *
 *   const platform = usePlatform();
 *   const files = await platform.openFile({ accept: 'video/*' });
 */
export const usePlatform = (): PlatformAdapter => adapter;

/** Same adapter, for non-component code (stores, engines, worker hosts). */
export { adapter as platform };
