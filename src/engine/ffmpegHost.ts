import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

/**
 * The ffmpeg.wasm host.
 *
 * WHY THIS IS NOT ITSELF A WEB WORKER
 * -----------------------------------
 * `FFmpeg` from @ffmpeg/ffmpeg already owns a dedicated worker and, for the
 * multi-thread core, a pool of pthread workers underneath it. Every frame
 * decode, PCM pass and encode runs there — the main thread only posts messages
 * and receives results, so it is never blocked.
 *
 * Wrapping it in a *second* worker looks tidier but does not survive contact
 * with the browser: @ffmpeg/ffmpeg constructs its worker with
 * `new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`, and
 * that nested module-worker request is aborted by Chromium
 * (`net::ERR_ABORTED`), so `load()` never resolves and every request hangs
 * forever. One layer of worker is the correct number.
 *
 * Sources are read through WORKERFS rather than copied in with writeFile —
 * that is what makes seeking into a 4 GB file cost kilobytes, not gigabytes.
 */

export interface FrameResult {
  bitmaps: ImageBitmap[];
  timestamps: number[];
}

export interface RunOptions {
  files?: File[];
  writes?: { name: string; data: Uint8Array }[];
  onProgress?(value: number): void;
  onLog?(line: string): void;
  /** Watchdog. Defaults to 30 minutes, which only ever catches a wedged core. */
  timeoutMs?: number;
}

const MOUNT = '/mnt';

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/** Per-command callbacks, swapped in while that command is the active one. */
let activeProgress: ((value: number) => void) | null = null;
let activeLog: ((line: string) => void) | null = null;

/** Serialises commands — one ffmpeg invocation at a time, in order. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Single-thread by default — deliberately.
 *
 * The multi-thread core runs the work correctly (ffmpeg logs `frame= 1` and
 * completes the mux) but never returns control: its pthread exit is proxied
 * back through the main thread and the `exec` promise simply never settles. The
 * visible symptom is a clip that shimmers forever, which is exactly the failure
 * this app must not have. The single-thread core resolves reliably, and with
 * `-ss` fast seeking a storyboard frame costs milliseconds anyway.
 *
 * MT stays available behind an explicit opt-in for anyone who wants to trade
 * that risk for export speed on a machine where it behaves.
 */
let preferMultiThread = false;

export const setPreferMultiThread = (value: boolean) => {
  if (value === preferMultiThread) return;
  preferMultiThread = value;
  ffmpegHost.terminate(); // next command reloads with the other core
};

// Gate on what the multi-thread core actually needs. It used to check
// `crossOriginIsolated`, but the app now obtains SharedArrayBuffer from an
// Electron switch rather than the COOP/COEP headers (which break window
// dragging), so that flag is false even when threading is available.
export const usingMultiThread = () => preferMultiThread && typeof SharedArrayBuffer !== 'undefined';

async function coreUrls(): Promise<{ coreURL: string; wasmURL: string; workerURL?: string }> {
  // Served as static assets from public/ffmpeg (scripts/sync-ffmpeg-core.mjs).
  // They must be same-origin: toBlobURL fetches them and COEP would block a
  // cross-origin read.
  const base = new URL('/ffmpeg/', window.location.origin).href;

  if (usingMultiThread()) {
    return {
      coreURL: await toBlobURL(`${base}ffmpeg-core-mt.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}ffmpeg-core-mt.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${base}ffmpeg-core-mt.worker.js`, 'text/javascript'),
    };
  }
  return {
    coreURL: await toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm'),
  };
}

export function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (loading) return loading;

  loading = (async () => {
    const instance = new FFmpeg();
    instance.on('log', ({ message }) => activeLog?.(message));
    instance.on('progress', ({ progress }) => activeProgress?.(Math.max(0, Math.min(1, progress))));

    const urls = await coreUrls();
    const ok = await instance.load(urls);
    if (!ok) throw new Error('ffmpeg.wasm core failed to load');

    ffmpeg = instance;
    return instance;
  })();

  // A failed load must not poison every later attempt.
  loading.catch(() => {
    loading = null;
  });

  return loading;
}

/** Mount source files read-only so ffmpeg can seek without copying them. */
async function mount(ff: FFmpeg, files: File[]): Promise<void> {
  try {
    await ff.createDir(MOUNT);
  } catch {
    /* already exists */
  }
  try {
    await ff.unmount(MOUNT);
  } catch {
    /* not mounted */
  }
  await ff.mount('WORKERFS' as Parameters<FFmpeg['mount']>[0], { files }, MOUNT);
}

async function unmount(ff: FFmpeg): Promise<void> {
  try {
    await ff.unmount(MOUNT);
  } catch {
    /* not mounted */
  }
}

/**
 * Run `task` with exclusive access to the ffmpeg instance.
 *
 * `timeoutMs` is a watchdog, not a performance budget: a wedged wasm core would
 * otherwise leave the caller waiting forever with no way to tell a slow decode
 * from a dead one. On timeout the instance is torn down so the next command
 * starts from a clean core instead of queueing behind a corpse.
 */
function enqueue<T>(
  task: (ff: FFmpeg) => Promise<T>,
  options: { timeoutMs?: number; label?: string; onProgress?(v: number): void; onLog?(line: string): void } = {}
): Promise<T> {
  const { timeoutMs = 0, label = 'ffmpeg', onProgress, onLog } = options;

  const run = queue.then(async () => {
    const ff = await loadFFmpeg();
    activeProgress = onProgress ?? null;
    activeLog = onLog ?? null;

    let timer: number | undefined;
    try {
      if (timeoutMs <= 0) return await task(ff);

      return await Promise.race([
        task(ff),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            ffmpegHost.terminate();
            reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s and was restarted`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      activeProgress = null;
      activeLog = null;
    }
  });

  // Keep the chain alive even when this task rejects.
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export const ffmpegHost = {
  init: () => loadFFmpeg().then(() => undefined),

  get loaded() {
    return ffmpeg !== null;
  },

  extractFrames(
    file: File,
    timestamps: number[],
    width: number,
    onProgress?: (v: number) => void
  ): Promise<FrameResult> {
    return enqueue(async (ff) => {
      await mount(ff, [file]);
      const path = `${MOUNT}/${file.name}`;
      const bitmaps: ImageBitmap[] = [];
      const done: number[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        const out = `sb_${i}.jpg`;
        try {
          // -ss before -i is the fast seek: jump to the nearest keyframe rather
          // than decoding from zero. That is the whole game for storyboards.
          await ff.exec([
            '-hide_banner', '-loglevel', 'error',
            '-ss', t.toFixed(3),
            '-i', path,
            '-frames:v', '1',
            '-vf', `scale=${width}:-2:flags=fast_bilinear`,
            '-q:v', '5',
            // `-update 1` says "this one filename is the whole output" — without
            // it image2 warns about a missing %03d sequence pattern.
            '-f', 'image2', '-update', '1',
            out,
          ]);
          const data = (await ff.readFile(out)) as Uint8Array;
          await ff.deleteFile(out).catch(() => {});
          if (data.length === 0) continue;
          const blob = new Blob([data as unknown as BlobPart], { type: 'image/jpeg' });
          bitmaps.push(await createImageBitmap(blob));
          done.push(t);
          onProgress?.((i + 1) / timestamps.length);
        } catch {
          // One unreadable timestamp must not sink the whole strip.
        }
      }

      await unmount(ff);
      return { bitmaps, timestamps: done };
    }, { onProgress, label: 'Frame extraction', timeoutMs: 20_000 + timestamps.length * 10_000 });
  },

  extractPeaks(file: File, buckets: number, onProgress?: (v: number) => void): Promise<Float32Array> {
    return enqueue(async (ff) => {
      await mount(ff, [file]);
      const out = 'peaks.raw';

      // Mono, 8 kHz, 32-bit float — plenty for a waveform, and a fraction of
      // the data of decoding at full rate.
      await ff.exec([
        '-hide_banner', '-loglevel', 'error',
        '-i', `${MOUNT}/${file.name}`,
        '-vn', '-ac', '1', '-ar', '8000',
        '-f', 'f32le',
        out,
      ]);

      const raw = (await ff.readFile(out)) as Uint8Array;
      await ff.deleteFile(out).catch(() => {});
      await unmount(ff);

      const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
      const count = Math.max(1, buckets);
      const peaks = new Float32Array(count);
      const per = samples.length / count;

      for (let b = 0; b < count; b++) {
        const start = Math.floor(b * per);
        const end = Math.min(samples.length, Math.floor((b + 1) * per));
        let peak = 0;
        for (let i = start; i < end; i++) {
          const v = Math.abs(samples[i]);
          if (v > peak) peak = v;
        }
        peaks[b] = peak;
      }
      return peaks;
    }, { onProgress, label: 'Waveform decode', timeoutMs: 180_000 });
  },

  run(args: string[], outName: string, options: RunOptions = {}): Promise<Uint8Array> {
    return enqueue(
      async (ff) => {
        if (options.files?.length) await mount(ff, options.files);
        for (const w of options.writes ?? []) await ff.writeFile(w.name, w.data);

        await ff.exec(args);

        const data = (await ff.readFile(outName)) as Uint8Array;
        await ff.deleteFile(outName).catch(() => {});
        for (const w of options.writes ?? []) await ff.deleteFile(w.name).catch(() => {});
        if (options.files?.length) await unmount(ff);
        return data;
      },
      {
        onProgress: options.onProgress,
        onLog: options.onLog,
        label: 'Render',
        // Exports legitimately take minutes; only guard against a true wedge.
        timeoutMs: options.timeoutMs ?? 30 * 60_000,
      }
    );
  },

  terminate() {
    void ffmpeg?.terminate();
    ffmpeg = null;
    loading = null;
    queue = Promise.resolve();
  },
};
