/**
 * Fast storyboard frame extraction using the browser's own video decoder.
 *
 * WHY NOT FFMPEG FOR THIS
 * -----------------------
 * ffmpeg.wasm is the right tool for encoding and for formats the browser
 * cannot open, but it is the wrong tool for thumbnails:
 *
 *   - it costs a 31 MB core download and a WASM instantiation before the very
 *     first frame can appear, so a freshly placed clip stays blank for seconds;
 *   - one `exec` per frame re-opens and re-probes the input every time;
 *   - every frame is JPEG-encoded in software, then decoded again by us.
 *
 * A <video> element has none of that. It is already hardware-accelerated, it
 * stays open across seeks, and `drawImage` into an OffscreenCanvas skips the
 * encode/decode round trip entirely — a frame costs a seek, not a decode of
 * everything preceding it. That is the same trick fast editors play by talking to
 * the platform decoder, and it is why a clip can be tiled essentially as fast
 * as it is dropped.
 *
 * ffmpeg remains the fallback for anything the browser refuses to open.
 */

export interface GrabOptions {
  /** Target thumbnail width in pixels; height follows the source aspect. */
  width: number;
  signal?: AbortSignal;
  /** Called after each frame lands, for progress reporting. */
  onFrame?(index: number, total: number): void;
}

export interface GrabResult {
  bitmaps: ImageBitmap[];
  timestamps: number[];
}

export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}

/** A seek that never reports back should not wedge the whole strip. */
const SEEK_TIMEOUT_MS = 4000;
const OPEN_TIMEOUT_MS = 8000;
/**
 * How long to wait for the compositor to present a seeked frame before drawing
 * anyway. Only reached when nothing is painting (minimised window, background
 * tab), since requestVideoFrameCallback normally fires within a frame.
 *
 * Kept tight on purpose: measured seek+draw costs ~13 ms/frame, so a generous
 * fallback dominates the cost the moment rVFC goes quiet. `seeked` already
 * implies the frame at the new position is decoded and drawable, so this is a
 * safety margin rather than a requirement.
 */
const PRESENT_FALLBACK_MS = 24;

/**
 * One open <video> per source, reused across seeks.
 *
 * Re-opening per frame is what makes naive implementations slow; the element is
 * kept warm and only released when the asset is dropped.
 */
class OpenVideo {
  readonly el: HTMLVideoElement;
  private opening: Promise<void> | null = null;

  constructor(private url: string) {
    this.el = document.createElement('video');
    this.el.preload = 'auto';
    this.el.muted = true;
    this.el.playsInline = true;
    this.el.crossOrigin = 'anonymous';
    // Never attached to the DOM; it exists purely as a decoder.
    this.el.style.display = 'none';
  }

  open(): Promise<void> {
    if (this.opening) return this.opening;

    this.opening = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new UnsupportedSourceError('Timed out opening source')),
        OPEN_TIMEOUT_MS
      );
      const done = () => {
        window.clearTimeout(timer);
        cleanup();
        // A source the browser cannot decode reports no dimensions.
        if (!this.el.videoWidth || !this.el.videoHeight) {
          reject(new UnsupportedSourceError('Browser cannot decode this source'));
        } else {
          resolve();
        }
      };
      const fail = () => {
        window.clearTimeout(timer);
        cleanup();
        reject(new UnsupportedSourceError(this.el.error?.message ?? 'Source failed to load'));
      };
      const cleanup = () => {
        this.el.removeEventListener('loadeddata', done);
        this.el.removeEventListener('error', fail);
      };

      this.el.addEventListener('loadeddata', done);
      this.el.addEventListener('error', fail);
      this.el.src = this.url;
      this.el.load();
    });

    return this.opening;
  }

  /** Seek and resolve once the decoder has actually presented the frame. */
  seekTo(seconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = Math.max(0, Math.min(seconds, Math.max(0, (this.el.duration || 0) - 0.02)));

      // Already there — nothing to wait for.
      if (Math.abs(this.el.currentTime - target) < 0.001 && this.el.readyState >= 2) {
        resolve();
        return;
      }

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Seek to ${target.toFixed(2)}s timed out`));
      }, SEEK_TIMEOUT_MS);

      const finish = () => {
        window.clearTimeout(timer);
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.el.removeEventListener('seeked', onSeeked);
        this.el.removeEventListener('error', onError);
      };
      const onError = () => {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error('Decode error while seeking'));
      };

      const onSeeked = () => {
        // `seeked` fires when the time updates, which can be a frame before the
        // decoder has presented. requestVideoFrameCallback is the accurate
        // signal — but it is driven by the compositor, so it never fires while
        // the window is minimised or otherwise not painting. Racing it against
        // a short timer keeps extraction running in a hidden window; by then
        // the data is decoded and drawImage produces the right frame anyway.
        let settled = false;
        const once = () => {
          if (settled) return;
          settled = true;
          finish();
        };

        const rvfc = (this.el as HTMLVideoElement & {
          requestVideoFrameCallback?(cb: () => void): number;
        }).requestVideoFrameCallback;
        if (typeof rvfc === 'function') rvfc.call(this.el, once);
        else requestAnimationFrame(once);

        window.setTimeout(once, PRESENT_FALLBACK_MS);
      };

      this.el.addEventListener('seeked', onSeeked, { once: true });
      this.el.addEventListener('error', onError, { once: true });
      this.el.currentTime = target;
    });
  }

  release() {
    this.el.removeAttribute('src');
    this.el.load();
  }
}

const openVideos = new Map<string, OpenVideo>();

/**
 * Grab frames at the given source times.
 *
 * Frames come back in request order; any individual timestamp that fails is
 * skipped rather than sinking the batch, which is why `timestamps` is returned
 * alongside and may be shorter than the request.
 */
export async function grabFrames(
  key: string,
  url: string,
  seconds: number[],
  options: GrabOptions
): Promise<GrabResult> {
  let open = openVideos.get(key);
  if (!open) {
    open = new OpenVideo(url);
    openVideos.set(key, open);
  }

  await open.open(); // throws UnsupportedSourceError -> caller falls back to ffmpeg

  const aspect = open.el.videoHeight / open.el.videoWidth;
  const w = Math.max(2, Math.round(options.width));
  const h = Math.max(2, Math.round(w * aspect));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  if (!ctx) throw new UnsupportedSourceError('No 2D context available');

  const bitmaps: ImageBitmap[] = [];
  const timestamps: number[] = [];

  // Ascending order keeps seeks short and lets the decoder reuse its state,
  // which is a large win on long sources.
  const ordered = [...seconds].sort((a, b) => a - b);

  for (let i = 0; i < ordered.length; i++) {
    if (options.signal?.aborted) break;
    const t = ordered[i];
    try {
      await open.seekTo(t);
      if (options.signal?.aborted) break;
      ctx.drawImage(open.el, 0, 0, w, h);
      // transferToImageBitmap hands over the backing store with no copy, then
      // gives the canvas a fresh one — cheaper than createImageBitmap(canvas).
      bitmaps.push(canvas.transferToImageBitmap());
      timestamps.push(open.el.currentTime);
      options.onFrame?.(i + 1, ordered.length);
    } catch {
      // Skip this timestamp; a bad seek is not a bad strip.
    }
  }

  return { bitmaps, timestamps };
}

/** True once a source is open and warm, so callers can tell first-hit from steady-state. */
export const isSourceOpen = (key: string) => openVideos.has(key);

export function releaseSource(key: string) {
  const open = openVideos.get(key);
  if (!open) return;
  open.release();
  openVideos.delete(key);
}

export function releaseAllSources() {
  for (const key of [...openVideos.keys()]) releaseSource(key);
}
