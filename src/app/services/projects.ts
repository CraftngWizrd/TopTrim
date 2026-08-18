import type { MediaAsset, Project, ProjectMeta } from '../../types/project';
import type { PlatformFile } from '../../platform/types';
import { platform } from '../hooks/usePlatform';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { assetHash, grabFrame, importFiles, rehydrateAssetUrls } from '../../engine/media';
import { getFrameAt } from '../../engine/storyboard';
import { playback } from '../../engine/playback';
import { createProject } from '../../engine/defaults';
import { framesToSeconds } from '../../engine/time';
import { registerFileHandle } from '../../engine/ffmpegClient';
import { primeStoryboard } from '../../engine/storyboard';
import { ensureWaveform } from '../../engine/waveform';

/**
 * Project lifecycle, shared by the home screen and the editor so both agree on
 * what "open", "save" and "new" mean.
 */

export const listProjects = (): Promise<ProjectMeta[]> => platform.getProjects();

export async function openProject(idOrProject: string | Project): Promise<boolean> {
  const project = typeof idOrProject === 'string' ? await platform.getProject(idOrProject) : idOrProject;
  if (!project) return false;

  // Re-link assets to their files before anything tries to render them.
  const { missing } = await rehydrateAssetUrls(project.state.assets, platform);
  if (missing.length) {
    console.warn(`[toptrim] ${missing.length} asset(s) could not be found on disk`, missing.map((m) => m.name));
  }

  useEditorStore.getState().loadProject(project);
  useUIStore.getState().clearSelection();
  useUIStore.getState().setRoute('editor');
  platform.setTitle(`${project.name} — TopTrim`);
  return true;
}

export async function newProject(name = 'Untitled project', width = 1920, height = 1080, fps = 30) {
  const project = createProject(name, width, height, fps);
  await platform.saveProject(project);
  await openProject(project);
  return project;
}

/**
 * Drag a video onto the home screen and you are editing it a moment later —
 * create the project, import, and lay the clips down in one step.
 */
export async function newProjectFromFiles(files: PlatformFile[]): Promise<Project | null> {
  if (files.length === 0) return null;

  const first = files[0];
  const project = createProject(first.name.replace(/\.[^.]+$/, ''));

  // Hand the raw Files to the ffmpeg worker registry before anything else.
  // Without this, storyboards and waveforms have no source to read and the
  // timeline is stuck on shimmer — this is the main "drop a video to start"
  // path, so it must register handles exactly like the in-editor import does.
  for (const f of files) {
    if (!f.localPath) {
      const p = platform.getLocalPath(f);
      if (p) f.localPath = p;
    }
    registerFileHandle(assetHash(f), f);
  }

  const { assets } = await importFiles(files, platform, project.fps);
  if (assets.length === 0) return null;

  // Match the project frame size to the first video so nothing is letterboxed
  // by default.
  const firstVideo = assets.find((a) => a.kind === 'video');
  if (firstVideo && firstVideo.width && firstVideo.height) {
    project.width = firstVideo.width;
    project.height = firstVideo.height;
  }

  for (const a of assets) project.state.assets[a.id] = a;

  const videoTrack = project.state.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = project.state.tracks.find((t) => t.kind === 'audio')!;
  let videoCursor = 0;
  let audioCursor = 0;

  const { clipFromAsset } = await import('../../engine/defaults');
  for (const a of assets) {
    const onAudio = a.kind === 'audio';
    const clip = clipFromAsset(a, onAudio ? audioTrack.id : videoTrack.id, onAudio ? audioCursor : videoCursor);
    project.state.clips[clip.id] = clip;
    if (onAudio) audioCursor += clip.duration;
    else videoCursor += clip.duration;
  }
  project.durationFrames = Math.max(videoCursor, audioCursor);

  await platform.saveProject(project);
  await openProject(project);

  // Start frame and peak extraction immediately so the timeline fills in.
  for (const a of assets) {
    primeStoryboard(a, project.fps);
    void ensureWaveform(a, project.fps);
  }

  void refreshThumbnail(project.id, assets);
  return project;
}

/** Save whatever is currently open. Returns the timestamp it was saved at. */
export async function saveCurrentProject(): Promise<number | null> {
  const store = useEditorStore.getState();
  const project = store.toProject();
  if (!project) return null;

  // The exact state/meta this save serializes. If either is replaced by an edit
  // during the async write, markSaved keeps `dirty` set so the edit isn't lost.
  const savedState = store.state;
  const savedMeta = store.meta;

  store.setSaving(true);
  try {
    const at = Date.now();
    await platform.saveProject({ ...project, updatedAt: at });
    useEditorStore.getState().markSaved(at, savedState, savedMeta);

    // Refresh the card art so the home screen shows what the project actually
    // looks like. Throttled: it is a canvas draw plus a PNG write, cheap but
    // pointless to redo on every 30-second autosave.
    if (at - lastThumbnailAt > THUMBNAIL_INTERVAL_MS || !project.thumbnailPath) {
      lastThumbnailAt = at;
      void refreshThumbnail(project.id);
    }
    return at;
  } catch (err) {
    store.setSaving(false);
    console.error('[toptrim] save failed', err);
    return null;
  }
}

const THUMBNAIL_INTERVAL_MS = 60_000;
let lastThumbnailAt = 0;

/**
 * Project card art: a real frame from the timeline, at the project's own
 * aspect ratio.
 *
 * The frame is taken from whatever is actually visible a third of the way in —
 * not from "the first asset", which for a project that opens on a title card
 * or a black lead-in shows nothing useful. Storyboard frames are reused where
 * they exist, so this usually costs a canvas draw and nothing else.
 */
export async function refreshThumbnail(projectId: string, assets?: MediaAsset[]) {
  const store = useEditorStore.getState();
  const { state, meta } = store;
  if (!meta) return;

  try {
    const dataUrl =
      (await captureFromTimeline(state, meta.width, meta.height, meta.fps)) ??
      (await captureFromAssets(assets ?? Object.values(state.assets)));
    if (!dataUrl) return;

    const path = await platform.saveThumbnail(projectId, dataUrl);
    // Only write back if this project is still the open one.
    if (path && useEditorStore.getState().meta?.id === projectId) {
      useEditorStore.getState().setMeta({ thumbnailPath: path });
    }
  } catch (err) {
    console.warn('[toptrim] thumbnail generation failed', err);
  }
}

/** Draw the topmost visual clip at a representative frame, letterboxed to the project ratio. */
async function captureFromTimeline(
  state: Project['state'],
  projectWidth: number,
  projectHeight: number,
  fps: number
): Promise<string | null> {
  const clips = Object.values(state.clips).filter((c) => c.kind === 'video' || c.kind === 'image');
  if (clips.length === 0) return null;

  const duration = Math.max(...clips.map((c) => c.start + c.duration));
  const target = Math.round(duration / 3);

  // Prefer a clip live at the target frame; otherwise the earliest one, so a
  // gap at that point still yields a picture.
  const order = new Map(state.tracks.map((t, i) => [t.id, state.tracks.length - i]));
  const live = clips
    .filter((c) => target >= c.start && target < c.start + c.duration)
    .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0));
  const clip = live[0] ?? [...clips].sort((a, b) => a.start - b.start)[0];

  const asset = clip.assetId ? state.assets[clip.assetId] : undefined;
  if (!asset) return null;

  const frameInClip = Math.max(0, Math.min(target - clip.start, clip.duration - 1));
  const sourceSeconds = (clip.inPoint + frameInClip * clip.speed) / fps;

  const width = 480;
  const height = Math.max(1, Math.round((width * projectHeight) / projectWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Reuse a storyboard frame when one is cached; fall back to a fresh grab.
  const cached = asset.kind === 'video' ? getFrameAt(asset.hash, sourceSeconds, 60_000) : null;
  const source: CanvasImageSource | null = cached ?? (await loadImageish(asset, sourceSeconds));
  if (!source) return null;

  const sw = 'width' in source ? (source.width as number) : projectWidth;
  const sh = 'height' in source ? (source.height as number) : projectHeight;
  // Contain, not cover: a 9:16 project should read as 9:16 on its card rather
  // than being cropped into a landscape sliver.
  const scale = Math.min(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);

  return canvas.toDataURL('image/jpeg', 0.82);
}

async function loadImageish(asset: MediaAsset, seconds: number): Promise<CanvasImageSource | null> {
  try {
    if (asset.kind === 'image') {
      const img = new Image();
      img.src = asset.url;
      await img.decode();
      return img;
    }
    const dataUrl = await grabFrame(asset.url, seconds);
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Last resort for a project with no visual clips laid down yet. */
async function captureFromAssets(list: MediaAsset[]): Promise<string | null> {
  const video = list.find((a) => a.kind === 'video');
  const image = list.find((a) => a.kind === 'image');
  if (video) {
    const seconds = Math.min(1, framesToSeconds(video.durationFrames, video.fps) / 2);
    return grabFrame(video.url, seconds);
  }
  if (image) return toDataUrl(image.url);
  return null;
}

async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function deleteProject(id: string) {
  await platform.deleteProject(id);
}

export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const source = await platform.getProject(id);
  if (!source) return null;
  const copy = createProject(`${source.name} copy`, source.width, source.height, source.fps);
  copy.state = structuredClone(source.state);
  copy.durationFrames = source.durationFrames;
  copy.thumbnailPath = source.thumbnailPath;
  await platform.saveProject(copy);
  return copy;
}

export async function renameProject(id: string, name: string) {
  const p = await platform.getProject(id);
  if (!p) return;
  await platform.saveProject({ ...p, name, updatedAt: Date.now() });
  const store = useEditorStore.getState();
  if (store.meta?.id === id) store.setMeta({ name });
}

/**
 * Leave the editor and land back on the project manager.
 *
 * Saves first — including a fresh cover — so the card you return to reflects
 * the state you left, then tears the project down so the next open starts
 * clean rather than inheriting stale playback and selection.
 */
export async function closeToHome() {
  const id = useEditorStore.getState().meta?.id;
  await saveCurrentProject();
  if (id) await refreshThumbnail(id);

  playback.pause();
  useEditorStore.getState().closeProject();

  const ui = useUIStore.getState();
  ui.clearSelection();
  ui.setScrollX(0);
  ui.setScrollY(0);
  ui.setCropMode(false);
  ui.closeModal();
  ui.setRoute('home');

  platform.setTitle('TopTrim');
}
