import { app, BrowserWindow, ipcMain, protocol, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { createStore, type Store, type ProjectRow } from './db';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '../dist');

// Opt-in remote debugging, so the running app can be inspected from a script
// rather than only by hand. Must be set before `ready`.
if (process.env.TOPTRIM_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.TOPTRIM_DEBUG_PORT);
}

/**
 * SharedArrayBuffer without cross-origin isolation.
 *
 * ffmpeg.wasm's multi-thread core and Whisper both need SharedArrayBuffer, and
 * the web way to get it is COOP: same-origin + COEP: require-corp. On Windows
 * those headers also break the custom title bar: a cross-origin-isolated
 * document's draggable regions never reach the browser process, so the window
 * reports HTCLIENT where the bar is and cannot be dragged. Measured with
 * identical windows differing only in these headers:
 *
 *   plain HTTP                      WM_NCHITTEST -> HTCAPTION   (drags)
 *   COOP: same-origin + COEP        WM_NCHITTEST -> HTCLIENT    (dead)
 *
 * This switch grants SharedArrayBuffer directly instead. It is the right trade
 * for a desktop app that only ever loads its own bundled code — the isolation
 * headers exist to protect against untrusted cross-origin content, which never
 * enters this window (external links open in the real browser, see below).
 * Verified: SharedArrayBuffer allocates and Atomics work with the headers gone.
 */
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

let win: BrowserWindow | null = null;
let store: Store;

/* ------------------------------------------------------------------ *
 * Custom protocols
 *
 * `toptrim://local/<encoded absolute path>` serves user media to the
 * <video>/<img> elements without exposing the file system to the renderer.
 * `app://bundle/...` serves the built renderer in production so the page has a
 * real origin and can be cross-origin isolated (SharedArrayBuffer).
 * ------------------------------------------------------------------ */
protocol.registerSchemesAsPrivileged([
  {
    // No bypassCSP: this scheme only ever feeds <video>/<img>/fetch, none of
    // which needs it. Its only effect would be to make any HTML ever served
    // over toptrim:// exempt from CSP — an amplifier we don't want.
    scheme: 'toptrim',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.cube': 'text/plain',
};
const mimeFor = (p: string) => MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream';

/** Corp header is mandatory: without it COEP:require-corp blocks every subresource. */
const baseHeaders = (filePath: string) => ({
  'Content-Type': mimeFor(filePath),
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'no-cache',
});

/**
 * Serve a file with HTTP Range support. Range is not optional here — a <video>
 * element cannot seek in a response that arrives as one opaque 200.
 */
async function serveFile(filePath: string, rangeHeader: string | null): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const total = stat.size;
  const match = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader);

  if (match) {
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
    if (Number.isNaN(start) || start >= total || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}`, 'Cross-Origin-Resource-Policy': 'cross-origin' },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders(filePath),
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders(filePath), 'Accept-Ranges': 'bytes', 'Content-Length': String(total) },
  });
}

function registerProtocolHandlers() {
  protocol.handle('toptrim', (request) => {
    const url = new URL(request.url);
    // Path is percent-encoded whole by the platform adapter, so decode then strip
    // the leading slash the URL parser adds.
    const decoded = path.normalize(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    // Serve only files the renderer was authorized to touch (imported media,
    // rendered output, app data). A bare fetch of an arbitrary absolute path —
    // the `~/.ssh/id_rsa` read — now 404s.
    if (!canRead(decoded)) return Promise.resolve(new Response('Not found', { status: 404 }));
    return serveFile(decoded, request.headers.get('Range'));
  });

  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    // Contain the resolved path inside the bundle directory. The trailing
    // separator is load-bearing: without it a sibling like `dist-electron`
    // shares the `dist` prefix and passes the check.
    const resolved = path.normalize(path.join(RENDERER_DIR, rel));
    if (resolved !== RENDERER_DIR && !resolved.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return serveFile(resolved, request.headers.get('Range'));
  });
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */
/**
 * Window/taskbar icon for development runs. Packaged builds get theirs from
 * electron-builder via build/icon.png; without this, dev shows the default
 * Electron atom.
 */
function devIconPath(): string | undefined {
  for (const candidate of [
    path.join(__dirname, '../build/icon.png'),
    path.join(process.cwd(), 'build/icon.png'),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    // No titleBarStyle: with frame:false it is redundant, and on Windows the
    // combination has been a source of drag-region weirdness.
    backgroundColor: '#111113',
    icon: devIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false, // required for SharedArrayBuffer (ffmpeg.wasm + Whisper)
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // No COOP/COEP here on purpose — see the SharedArrayBuffer note at the top.

  win.once('ready-to-show', () => win?.show());

  win.on('maximize', () => win?.webContents.send('window:state', { maximized: true }));
  win.on('unmaximize', () => win?.webContents.send('window:state', { maximized: false }));

  // New windows: deny, and hand only https links to the real browser. (http and
  // other schemes are dropped — openExternal on an arbitrary URL is an exfil
  // channel that sidesteps the renderer CSP.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Top-frame navigation: the app must only ever host its own first-party code.
  // setWindowOpenHandler covers popups; this covers the main frame (and any
  // subframe). Without it, a navigation to a remote or toptrim:// origin would
  // load foreign content that still inherits the preload's electronAPI —
  // arbitrary file read/write + ffmpeg — turning any navigation bug into full
  // host compromise. Verified: this blocks a location.href to toptrim://.
  const allowedOrigin = (url: string) => (isDev && DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://'));
  const guardNav = (e: Electron.Event, url: string) => {
    if (!allowedOrigin(url)) {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  };
  win.webContents.on('will-navigate', guardNav);
  win.webContents.on('will-frame-navigate', (e) => guardNav(e, e.url));

  if (isDev && DEV_URL) {
    win.loadURL(DEV_URL);
    // DevTools are opt-in (TOPTRIM_DEVTOOLS=1), not automatic. Opening them on
    // every dev launch also makes the title bar undraggable — Chromium disables
    // app-region dragging while an inspector is attached so that elements
    // inside a drag region can still be inspected (electron#3647).
    if (process.env.TOPTRIM_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL('app://bundle/index.html');
  }
}

/* ------------------------------------------------------------------ *
 * Native ffmpeg
 *
 * ffmpeg.wasm is fine for probing and for the future web build, but it cannot
 * render at a usable speed: software H.264 encoding of 1080p in WASM runs at a
 * few frames per second, so a one-minute timeline takes many minutes. This is
 * a desktop app, so it does what a native editor does — drive a real ffmpeg binary,
 * which reads the source files straight off disk (no copying into a virtual
 * filesystem) and can reach the machine's hardware encoders.
 * ------------------------------------------------------------------ */

function resolveFfmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = require('ffmpeg-static') as string | null;
    if (typeof resolved !== 'string') return null;
    // electron-builder keeps the binary outside the asar so it stays executable.
    const unpacked = resolved.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

const ffmpegPath = resolveFfmpegPath();
const ffmpegJobs = new Map<string, ChildProcess>();

const thumbDir = () => path.join(app.getPath('userData'), 'thumbnails');

/** Extensions a cover may have been written with, for cleanup and deletion. */
const THUMB_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

const thumbVariants = (id: string) => THUMB_EXTS.map((e) => path.join(thumbDir(), `${id}${e}`));

/* ------------------------------------------------------------------ *
 * Path authorization
 *
 * The renderer legitimately handles files anywhere on disk (imported media,
 * chosen export targets), so the fs-touching IPC endpoints used to accept any
 * path — which meant a compromised renderer could read `~/.ssh/id_rsa` over
 * `toptrim://`, or write a `.bat` into the Startup folder via `file:writeBegin`.
 *
 * The fix is an allowlist the RENDERER cannot populate at will. A path becomes
 * readable/writable only when it enters through a gate the main process
 * controls: a file dialog the user drove, a render target the main process
 * minted, the app's own data dirs, or `webUtils.getPathForFile` — which needs a
 * real dropped/picked File and so cannot be forged for an arbitrary string.
 * ------------------------------------------------------------------ */
const authorizedRead = new Set<string>();
const authorizedWrite = new Set<string>();

const normPath = (p: string) => path.normalize(p).toLowerCase();

/** App-owned trees that are always readable (renderer bundle, userData: db, thumbnails, rendered). */
function alwaysReadable(p: string): boolean {
  const n = normPath(p);
  const roots = [normPath(RENDERER_DIR), normPath(app.getPath('userData'))];
  return roots.some((r) => n === r || n.startsWith(r + path.sep));
}
const authorizeRead = (p: string) => p && authorizedRead.add(normPath(p));
const authorizeWrite = (p: string) => p && authorizedWrite.add(normPath(p));
const canRead = (p: string) => alwaysReadable(p) || authorizedRead.has(normPath(p));
const canWrite = (p: string) => {
  const n = normPath(p);
  // Writes are allowed to a user-chosen target or anywhere in userData (renders,
  // thumbnails). Never to the app bundle.
  const ud = normPath(app.getPath('userData'));
  return authorizedWrite.has(n) || n === ud || n.startsWith(ud + path.sep);
};

/** Authorize every `asset.path` stored in a loaded project, so its media reads. */
function authorizeProjectAssets(state: unknown) {
  const assets = (state as { assets?: Record<string, { path?: unknown }> } | null)?.assets;
  if (!assets || typeof assets !== 'object') return;
  for (const a of Object.values(assets)) {
    if (a && typeof a.path === 'string') authorizeRead(a.path);
  }
}

/**
 * Reclaim orphaned AI render outputs.
 *
 * Stabilise/denoise/upscale/etc. write durable files to userData/rendered and
 * point a clip at them, but nothing ever removed a file once every project that
 * referenced it was deleted or the op reverted — so the directory grew without
 * bound. On startup, delete any rendered file no open project's assets point
 * at. A one-hour grace skips anything just written, so an in-flight render is
 * never swept.
 */
function sweepRenderedAssets(store: Store) {
  try {
    const dir = path.join(app.getPath('userData'), 'rendered');
    if (!fs.existsSync(dir)) return;

    const referenced = new Set<string>();
    for (const meta of store.getProjects()) {
      const project = store.getProject(meta.id);
      const assets = (project?.state as { assets?: Record<string, { path?: unknown }> } | null)?.assets;
      if (assets && typeof assets === 'object') {
        for (const a of Object.values(assets)) {
          if (a && typeof a.path === 'string') referenced.add(normPath(a.path));
        }
      }
    }

    const now = Date.now();
    let freed = 0;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || now - st.mtimeMs < 60 * 60 * 1000) continue;
        if (!referenced.has(normPath(full))) {
          fs.unlinkSync(full);
          freed++;
        }
      } catch {
        /* skip */
      }
    }
    if (freed) console.log(`[toptrim] swept ${freed} orphaned render(s) from ${dir}`);
  } catch {
    /* best effort — never block startup */
  }
}

function registerIpc() {
  /* --- files --------------------------------------------------------- */

  // Native picker used for "open project file" style flows where only a path is
  // needed. Media import goes through a DOM <input type=file> instead so the
  // renderer gets real File objects with zero copying (see src/platform/electron.ts).
  ipcMain.handle('file:openDialog', async (_e, options: { filters?: Electron.FileFilter[]; multiple?: boolean }) => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, {
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options?.filters ?? [],
    });
    if (res.canceled) return [];
    // The user picked these, so they become readable.
    res.filePaths.forEach(authorizeRead);
    return res.filePaths.map((p) => ({
      path: p,
      name: path.basename(p),
      size: fs.existsSync(p) ? fs.statSync(p).size : 0,
    }));
  });

  ipcMain.handle('file:saveDialog', async (_e, options: { defaultFilename: string; filters: Electron.FileFilter[] }) => {
    if (!win) return null;
    const res = await dialog.showSaveDialog(win, {
      defaultPath: options.defaultFilename,
      filters: options.filters ?? [],
    });
    if (res.canceled || !res.filePath) return null;
    // The user chose this destination, so a subsequent writeBegin may target it.
    authorizeWrite(res.filePath);
    return res.filePath;
  });

  // Synchronous authorization gate for imported media. The preload calls this
  // from getPathForFile with the path webUtils resolved from a real File — which
  // cannot be forged for an arbitrary string, so this is not a way for a
  // compromised renderer to authorize itself into `C:\Windows\...`.
  ipcMain.on('fs:authorize', (e, filePath: string) => {
    if (typeof filePath === 'string') authorizeRead(filePath);
    e.returnValue = true;
  });

  // Chunked write so a multi-GB export never has to exist as one IPC message.
  const writeHandles = new Map<string, number>();
  ipcMain.handle('file:writeBegin', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !canWrite(filePath)) {
      throw new Error('Write not permitted for this path');
    }
    const fd = fs.openSync(filePath, 'w');
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    writeHandles.set(token, fd);
    return token;
  });
  ipcMain.handle('file:writeChunk', async (_e, token: string, chunk: Uint8Array) => {
    const fd = writeHandles.get(token);
    if (fd === undefined) throw new Error('Invalid write token');
    fs.writeSync(fd, Buffer.from(chunk));
  });
  ipcMain.handle('file:writeEnd', async (_e, token: string) => {
    const fd = writeHandles.get(token);
    if (fd === undefined) return;
    fs.closeSync(fd);
    writeHandles.delete(token);
  });

  ipcMain.handle('file:stat', async (_e, filePath: string) => {
    // Only report on paths the renderer is allowed to see, so stat can't be used
    // to probe the filesystem for arbitrary files.
    if (typeof filePath !== 'string' || !canRead(filePath)) return { exists: false, size: 0, mtime: 0 };
    try {
      const s = fs.statSync(filePath);
      return { exists: true, size: s.size, mtime: s.mtimeMs };
    } catch {
      return { exists: false, size: 0, mtime: 0 };
    }
  });

  ipcMain.handle('file:reveal', async (_e, filePath: string) => {
    if (typeof filePath === 'string' && canRead(filePath)) shell.showItemInFolder(filePath);
  });

  /* --- projects ------------------------------------------------------ */

  ipcMain.handle('projects:getAll', async () => store.getProjects());
  ipcMain.handle('projects:get', async (_e, id: string) => {
    const project = store.getProject(id);
    // Reopening a project must let its media load again: the paths were
    // authorized in the session that imported them, but the allowlist is
    // in-memory, so re-authorize the stored asset paths now.
    if (project) authorizeProjectAssets(project.state);
    return project;
  });
  ipcMain.handle('projects:save', async (_e, row: ProjectRow, state: unknown) => {
    store.saveProject(row, state);
  });
  ipcMain.handle('projects:delete', async (_e, id: string) => {
    store.deleteProject(id);
    for (const t of thumbVariants(id)) {
      if (fs.existsSync(t)) fs.unlinkSync(t);
    }
  });

  /**
   * Write a project cover.
   *
   * Three things here are load-bearing:
   *
   *  - The extension follows the data URL's own type. The capture encodes JPEG,
   *    and writing those bytes to `<id>.png` only rendered because Chromium
   *    sniffs image content; anything that trusts the extension (revealFile,
   *    the OS previewer) got a file it could not open.
   *  - The write is atomic. `writeFileSync` truncates first, so a cover being
   *    re-saved while the home screen was reading it served a half-written body
   *    under the full Content-Length — which decodes as a broken image and
   *    stays broken, because nothing retries. Rename is atomic on NTFS, so a
   *    reader sees either the old file or the new one.
   *  - A malformed data URL is rejected rather than base64-decoded as garbage.
   */
  ipcMain.handle('projects:saveThumbnail', async (_e, id: string, dataUrl: string) => {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;

    const ext = m[1] === 'jpeg' ? '.jpg' : `.${m[1]}`;
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length === 0) return null;

    fs.mkdirSync(thumbDir(), { recursive: true });
    const out = path.join(thumbDir(), `${id}${ext}`);
    const tmp = `${out}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, out);

    // Drop covers left behind under a different extension so they cannot be
    // served later by a stale path.
    for (const other of thumbVariants(id)) {
      if (other !== out && fs.existsSync(other)) fs.unlinkSync(other);
    }
    return out;
  });

  /* --- native ffmpeg -------------------------------------------------- */

  ipcMain.handle('ffmpeg:available', () => !!ffmpegPath);

  /**
   * The native binary's filter list.
   *
   * The renderer used to decide what an operation could do by probing the
   * ffmpeg.wasm core — a different build from the one that actually runs the
   * work now. `-filters` also writes to stdout, which `ffmpeg:run` does not
   * capture, so it needs its own handler.
   */
  ipcMain.handle('ffmpeg:filters', async (): Promise<string[]> => {
    if (!ffmpegPath) return [];
    return new Promise((resolve) => {
      const child = spawn(ffmpegPath, ['-hide_banner', '-filters'], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (c: Buffer) => (out += c.toString()));
      child.on('error', () => resolve([]));
      child.on('close', () => {
        // Lines look like ` T.C name  A->A  description`.
        const names: string[] = [];
        for (const line of out.split(/[\r\n]+/)) {
          const m = /^\s*[TSC.]{3}\s+([A-Za-z0-9_]+)\s+\S+->\S+/.exec(line);
          if (m) names.push(m[1]);
        }
        resolve(names);
      });
    });
  });

  /**
   * Run the native binary.
   *
   * `args` may contain the token `{TMP}`, replaced with a per-job scratch
   * directory. Overlay PNGs the renderer rasterised are written there, so the
   * command references real paths and nothing large crosses IPC twice.
   *
   * Progress is streamed as raw stderr lines; the renderer parses `time=`.
   */
  ipcMain.handle(
    'ffmpeg:run',
    async (
      _e,
      jobId: string,
      args: string[],
      tempFiles: { name: string; data: Uint8Array }[] = [],
      // Multi-pass operations (vidstab writes a motion file in pass 1 and reads
      // it in pass 2) need the scratch directory to survive between passes. The
      // dir is derived from jobId, so the final pass clears it.
      keepTemp = false
    ): Promise<{ code: number; stderr: string; cancelled: boolean }> => {
      if (!ffmpegPath) return { code: -1, stderr: 'No ffmpeg binary available', cancelled: false };

      // jobId builds the scratch dir and tempFiles[].name are written into it.
      // Both cross from the renderer, so both must be simple names — otherwise
      // `../..` turns the scratch write into an arbitrary-file write and the
      // cleanup `rmSync` into an arbitrary-directory delete.
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
        return { code: -1, stderr: 'Invalid job id', cancelled: false };
      }
      for (const f of tempFiles) {
        if (typeof f.name !== 'string' || f.name !== path.basename(f.name) || f.name.includes('..')) {
          return { code: -1, stderr: `Invalid temp file name: ${f.name}`, cancelled: false };
        }
      }

      const dir = path.join(os.tmpdir(), 'toptrim', jobId);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of tempFiles) {
        fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.data));
      }

      const finalArgs = args.map((a) => a.split('{TMP}').join(dir));

      return new Promise((resolve) => {
        // cwd is the scratch dir so a filtergraph can name a helper file
        // relatively. An absolute Windows path inside `-vf` is a trap: `:`
        // separates filter options, so a drive letter splits the argument and
        // ffmpeg reports a bogus error about whichever option followed it.
        // Inputs and outputs are absolute and unaffected.
        const child = spawn(ffmpegPath, finalArgs, { windowsHide: true, cwd: dir });
        ffmpegJobs.set(jobId, child);

        let stderr = '';
        let cancelled = false;
        let wedged = false;

        // Inactivity watchdog. A working ffmpeg — however slow, however large the
        // 4K render — keeps emitting `frame=`/`time=` status lines; a wedged one
        // goes silent. The ceiling is on SILENCE, not total runtime, so a long
        // legitimate render is never killed. Reset on every stderr chunk.
        const SILENCE_MS = 5 * 60 * 1000;
        let watchdog: NodeJS.Timeout | null = null;
        const kick = () => {
          if (watchdog) clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            wedged = true;
            try {
              child.kill('SIGKILL');
            } catch {
              /* already gone */
            }
          }, SILENCE_MS);
        };
        kick();

        child.stderr.on('data', (chunk: Buffer) => {
          kick();
          const text = chunk.toString();
          // Keep only the tail: a long render's stderr is mostly status lines.
          stderr = (stderr + text).slice(-8000);
          win?.webContents.send('ffmpeg:log', { jobId, text });
        });

        child.on('error', (err) => {
          if (watchdog) clearTimeout(watchdog);
          ffmpegJobs.delete(jobId);
          fs.rmSync(dir, { recursive: true, force: true });
          resolve({ code: -1, stderr: String(err), cancelled });
        });


        child.on('close', (code) => {
          if (watchdog) clearTimeout(watchdog);
          cancelled = ffmpegJobs.get(jobId) === undefined;
          ffmpegJobs.delete(jobId);
          // A cancelled job is finished whatever the caller asked for.
          if (!keepTemp || cancelled) fs.rmSync(dir, { recursive: true, force: true });
          resolve({
            code: code ?? -1,
            stderr: wedged ? `${stderr}\n[toptrim] terminated after ${SILENCE_MS / 60000} min with no output` : stderr,
            cancelled,
          });
        });
      });
    }
  );

  /**
   * A durable destination for renders that become project assets (stabilise,
   * denoise, upscale...). These live in userData rather than temp so the clip
   * still resolves after a reopen, and so they can be fed into further native
   * operations by path instead of being copied around.
   */
  ipcMain.handle('media:renderPath', (_e, name: string) => {
    const dir = path.join(app.getPath('userData'), 'rendered');
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^\w.-]/g, '_');
    const out = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    // Under userData, so canRead/canWrite already permit it; authorize explicitly
    // for clarity and in case the userData rule ever tightens.
    authorizeRead(out);
    authorizeWrite(out);
    return out;
  });

  ipcMain.handle('ffmpeg:cancel', (_e, jobId: string) => {
    const child = ffmpegJobs.get(jobId);
    if (!child) return false;
    // Delete first so `close` can tell a cancel from a natural exit.
    ffmpegJobs.delete(jobId);
    child.kill('SIGKILL');
    return true;
  });

  /* --- settings ------------------------------------------------------ */

  ipcMain.handle('settings:get', async (_e, key: string) => store.getSetting(key));
  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => store.setSetting(key, value));

  /* --- window -------------------------------------------------------- */

  /*
   * Manual window dragging.
   *
   * `-webkit-app-region: drag` is the documented approach but proved
   * unreliable here, and it silently does nothing when a maximised window is
   * dragged. These let the renderer move the window itself from pointer
   * deltas, which works in every state and can be reasoned about.
   */
  /*
   * No window-move IPC here on purpose. The title bar uses the native caption
   * drag (-webkit-app-region: drag) because moving the window from JS cannot
   * preserve its size on a fractionally-scaled display — setBounds re-rounds
   * the DIP<->device conversion on every call and the error accumulates. The
   * measurements are recorded above the .drag-region rule in base.css.
   */
  ipcMain.handle('window:minimize', () => win?.minimize());
  ipcMain.handle('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.handle('window:close', () => win?.close());
  ipcMain.handle('window:setTitle', (_e, title: string) => win?.setTitle(title));
  ipcMain.handle('window:isMaximized', () => !!win?.isMaximized());
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    try {
      store = createStore(app.getPath('userData'));
    } catch (err) {
      // The project db exists but couldn't be opened (see StoreOpenError). Tell
      // the user their data is safe and how to recover, then quit — rather than
      // starting empty and letting the next save diverge.
      dialog.showErrorBox('TopTrim — could not open your projects', (err as Error).message);
      app.quit();
      return;
    }
    registerProtocolHandlers();
    registerIpc();
    createWindow();

    // Reclaim orphaned renders shortly after boot, off the startup critical path.
    setTimeout(() => sweepRenderedAssets(store), 4000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Buffered writes (the JSON store debounces) must reach disk before exit, or a
  // quick quit after an edit loses it. better-sqlite3 is already durable; this
  // just checkpoints its WAL.
  app.on('before-quit', () => {
    try {
      store?.flush();
      store?.close();
    } catch {
      /* best effort on shutdown */
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
