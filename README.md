# TopTrim v2

A clean, focused, free video editor. No watermark. No subscription. No account. Nothing leaves the machine.

Electron + React + Vite, architected from day one so the whole app can move to the web by replacing one file.

## Running it

```bash
npm install
npm run dev
```

`npm run rebuild` compiles `better-sqlite3` against Electron's ABI. Without it the app still runs — project storage
transparently falls back to a JSON file with identical semantics — but SQLite is the intended backend.

```bash
npm run build     # typecheck + renderer + electron bundles
npm run dist      # packaged installers via electron-builder
```

`npm run sync-core` copies the ffmpeg.wasm core into `public/ffmpeg/`. It runs automatically before `dev` and `build`.

## Architecture

```
electron/          main process — window, IPC, SQLite, toptrim:// protocol
src/platform/      THE web-conversion surface: types.ts | electron.ts | web.ts
src/app/           pure React — never imports from electron/
src/engine/        framework-free core: timeline renderer, playback, ffmpeg, keyframes
src/workers/       whisper.worker.ts
```

Everything platform-specific goes through `usePlatform()`. To ship on the web: fill in the storage half of
`src/platform/web.ts` and delete the Electron branch in `src/app/hooks/usePlatform.ts`. Nothing under `src/app`,
`src/engine` or `src/workers` changes.

### Four decisions worth knowing about

**Export uses a native ffmpeg binary, not WebAssembly.** ffmpeg.wasm encodes 1080p in software at a few frames per
second, so a one-minute timeline took many minutes — unusable. The Electron main process spawns `ffmpeg-static`
instead: **4.5 s** to encode 30 s of 1080p30 x264 versus roughly two minutes for the WASM path, reading sources
straight off disk with no copy into a virtual filesystem, and writing directly to the destination so a 4K export never
has to fit in the renderer's heap. Cancel kills the process by PID.

This sits behind `PlatformAdapter.nativeFFmpeg()`, so the web build simply gets `null` and falls back to ffmpeg.wasm —
the export pipeline builds one filtergraph and both paths run it.



**Storyboard thumbnails come from the browser's decoder, not ffmpeg.** One `<video>` is opened per source and reused
across seeks, drawn into an `OffscreenCanvas` and handed over with `transferToImageBitmap()` — no encode/decode round
trip. Measured at **13.4 ms/frame** against **33.4 ms/frame** for ffmpeg with its core already warm, and that comparison
flatters ffmpeg because it excludes the 31 MB core download you would otherwise pay before the first thumbnail could
appear at all. ffmpeg remains the fallback for sources the browser refuses to open. See `src/engine/frameGrabber.ts`.

One trap worth knowing if you touch that file: `requestVideoFrameCallback` is compositor-driven, so it never fires while
the window is minimised. It is raced against a short timer, otherwise extraction stalls in a hidden window.


**ffmpeg runs on the main thread — and that is correct.** `FFmpeg` from `@ffmpeg/ffmpeg` already owns a dedicated
worker; all decoding and encoding happens there, so the main thread is never blocked. Wrapping it in a *second* worker
looks tidier but breaks: `@ffmpeg/ffmpeg` builds its worker with
`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`, and Chromium aborts that nested module-worker
request (`net::ERR_ABORTED`), so `load()` never resolves. One layer of worker is the right number. See
`src/engine/ffmpegHost.ts`.

**The single-thread ffmpeg core is the default.** The multi-thread core does the work correctly but does not reliably
hand control back — ffmpeg logs a completed mux and the `exec` promise never settles, which surfaces as a clip that
shimmers forever. Single-thread resolves every time, and with `-ss` fast seeking a storyboard frame costs milliseconds.
Multi-thread is available in Settings for anyone whose machine behaves. Every command also has a watchdog, so a wedged
core reports an error instead of hanging silently.

## Non-negotiables held

- No watermark on any export, no resolution cap
- Works fully offline; the only network use is the one-time Whisper model download
- No component library, no Inter, no purple, no gradient buttons, no `transition: all`
- Timeline is custom Canvas 2D — no timeline library
- The playhead moves via a CSS variable written by a RAF loop; React does not re-render during playback
- Storyboard thumbnails tile wall-to-wall with shimmer while loading — never a flat colour block
- Context menus are the app's own, never the OS menu

## What is implemented

Electron shell (frameless window, custom window controls, `toptrim://` protocol with HTTP Range so video can seek,
SharedArrayBuffer via command-line switch, SQLite + JSON fallback) · platform adapter · design system · home screen · four-zone
editor layout with resizable dividers · all nine asset tabs · preview monitor with A/B video swap and on-canvas
transform handles · Canvas timeline (ruler, multi-track, drag/trim/split/marquee, snapping, magnet, markers, loop,
keyframe strip) · storyboard + waveform extraction with IndexedDB caching · on-canvas transform handles · properties
panel for every clip type · keyframe engine with group-level keyframes and a right-click easing editor · bezier speed
curves and tone curves · colour wheels and HSL · effect and transition registries · cancellable background jobs with
percentage, counts and time estimates ·
Whisper auto-captions with SRT import/export · text-to-speech · voiceover recording · synthesised sound effects ·
ffmpeg clip operations (stabilise, denoise, optical flow, upscale, vocal isolation, beat detection) · export pipeline
with platform presets and real progress · 30-second auto-save · full keyboard shortcut table.

## What is not built yet

- **WebGL shader pipeline.** Effects and transitions carry finished GLSL and ffmpeg filter chains, and export applies
  the ffmpeg side. The live preview currently approximates grading with CSS filters, so curves, colour wheels, HSL
  bands and LUTs are export-only until the shader pass lands.
- **MediaPipe features** — background removal, smart cutout, auto-reframe. Deliberately absent from the UI rather than
  present as buttons that do nothing.
- **Real-ESRGAN upscaling** — upscale currently uses Lanczos with edge sharpening.
- **Demucs vocal isolation** — currently centre-channel extraction, which works on stereo mixes and not on mono.
- **LUT (.cube) import**, effect/transition hover previews rendered through the real shader, and multi-layer video
  compositing in export beyond overlay-based picture-in-picture.
