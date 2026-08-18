import { ffmpegHost } from './ffmpegHost';
import { platform } from '../app/hooks/usePlatform';

/**
 * What this ffmpeg core can actually do.
 *
 * The @ffmpeg/core build is not the full ffmpeg: it ships without
 * `--enable-libvidstab`, so `vidstabdetect`/`vidstabtransform` do not exist,
 * and a few filters like `kuwahara` and `kaleidoscope` are absent too. Firing
 * a command at a missing filter produces a wall of log output and a failure
 * that is easy to mistake for "it is still processing".
 *
 * So we ask once, cache the answer, and let the UI disable what it cannot do
 * with an honest reason instead of pretending and hanging.
 */

let filters: Set<string> | null = null;
let probing: Promise<Set<string>> | null = null;

// v2: the list now comes from the native binary where one exists, so a cache
// written by the old WASM-only probe must not be reused.
const CACHE_KEY = 'toptrim.ffmpeg.filters.v2';

function readCache(): Set<string> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.length > 0 ? new Set(list) : null;
  } catch {
    return null;
  }
}

function writeCache(set: Set<string>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...set]));
  } catch {
    /* cache is an optimisation, not a requirement */
  }
}

/**
 * Probe the core's filter list.
 *
 * `-filters` prints one filter per line as `... name  in->out  description`.
 * The name is the second whitespace-delimited token.
 */
export function probeFilters(): Promise<Set<string>> {
  if (filters) return Promise.resolve(filters);
  if (probing) return probing;

  const cached = readCache();
  if (cached) {
    filters = cached;
    return Promise.resolve(cached);
  }

  probing = (async () => {
    const found = new Set<string>();

    // Ask the binary that will actually run the work. Operations execute on the
    // native ffmpeg whenever it is present, and it is a fuller build than the
    // WASM core — gating it on the core's list would refuse work it can do.
    try {
      const native = await platform.nativeFFmpeg();
      if (native) {
        for (const name of await native.listFilters()) found.add(name);
      }
    } catch {
      /* fall through to the WASM probe */
    }

    if (found.size === 0) {
      const lines: string[] = [];
      try {
        // `-filters` writes to the log and exits; the missing output file is
        // expected and not an error worth surfacing.
        await ffmpegHost.run(['-hide_banner', '-filters'], 'nul.txt', {
          onLog: (line) => lines.push(line),
          timeoutMs: 60_000,
        });
      } catch {
        /* the log is what we came for */
      }
      for (const line of lines) {
        const m = /^\s*[TSC.]{0,3}\s+([A-Za-z0-9_]+)\s+[|A-Z]+->/.exec(line) ?? /^\s*\S+\s+([a-z0-9_]+)\s+/.exec(line);
        if (m) found.add(m[1]);
      }
    }

    // Fail OPEN. Assigning an empty set here would make `hasFilter` answer
    // false for everything, and every operation would refuse up front with
    // "this build has no X filter" — turning a failed probe into an app with
    // no working AI features at all.
    if (found.size > 0) {
      writeCache(found);
      filters = found;
    }
    return found;
  })();

  return probing;
}

/** Synchronous check. Returns true when the probe has not run, so nothing is blocked by an unknown. */
export function hasFilter(name: string): boolean {
  if (!filters) return true;
  return filters.has(name);
}

/** All of `names` present? Used to gate a whole operation. */
export const hasFilters = (...names: string[]) => names.every(hasFilter);

export const filtersProbed = () => filters !== null;

/** Kick the probe off in the background; callers do not need to await it. */
export function warmCapabilities() {
  void probeFilters();
}

/**
 * Filters this build is known to lack, with what we do instead.
 * Kept here so the reason is in one place rather than scattered through the UI.
 */
export const KNOWN_ABSENT: Record<string, string> = {
  // The bundled native binary does ship libvidstab, so these only apply to the
  // WASM core; stabilisation picks its filter from what the probe reports.
  vidstabdetect: 'This ffmpeg build has no libvidstab. Stabilisation uses the deshake filter instead.',
  vidstabtransform: 'This ffmpeg build has no libvidstab. Stabilisation uses the deshake filter instead.',
  kuwahara: 'Not in this build. Oil paint and watercolour approximate it with smartblur on export.',
  kaleidoscope: 'Not in this build. The effect previews correctly but cannot be exported.',
};
