import type { Frames } from '../types/project';
import { framesToSeconds, formatTimecode } from './time';


/**
 * Playback engine.
 *
 * Two rules shape this file:
 *  1. Playback uses real <video>/<audio> elements. Nothing is decoded to canvas
 *     per frame — the compositor draws with CSS transforms on top of the video.
 *  2. Nothing in React re-renders while the playhead moves. The RAF loop writes
 *     a CSS variable and one textContent, and that is all.
 *
 * The timeline clock is authoritative (a project is many clips, so no single
 * video element can be the clock), but while one clip plays uninterrupted the
 * clock re-syncs to that element so audio and video never drift apart.
 */

export interface PlaybackClip {
  id: string;
  kind: 'video' | 'image' | 'audio';
  url: string;
  /** Timeline placement, in frames. */
  start: Frames;
  duration: Frames;
  /** Source in-point in source frames. */
  inPoint: Frames;
  speed: number;
  reversed: boolean;
  muted: boolean;
  volume: number; // 0..1 linear
  /** Higher wins when clips overlap. */
  layer: number;
  /**
   * Transition out of this clip into whatever follows it on the same track.
   * The engine overlaps the two clips for this many frames and blends them.
   */
  transitionOut?: { transitionId: string; durationFrames: Frames } | null;
  /** Which track the clip sits on, so the successor can be found. */
  trackId?: string;
}

/** What the compositor needs to paint a transition. */
export interface TransitionState {
  outClipId: string;
  inClipId: string;
  transitionId: string;
  /** 0 -> 1 across the transition. */
  t: number;
}

export interface Composition {
  fps: number;
  durationFrames: Frames;
  visual: PlaybackClip[];
  audio: PlaybackClip[];
}

type FrameListener = (frame: Frames) => void;

const EMPTY: Composition = { fps: 30, durationFrames: 0, visual: [], audio: [] };

/** Re-seek only when the element has drifted more than this from the clock. */
const DRIFT_TOLERANCE_S = 0.08;

export class PlaybackEngine {
  private comp: Composition = EMPTY;
  private frame = 0;
  private playing = false;
  private raf: number | null = null;
  private lastTick = 0;

  /** A/B pair — the idle one preloads the next clip so cuts never flash black. */
  private videoA: HTMLVideoElement | null = null;
  private videoB: HTMLVideoElement | null = null;
  private activeIsA = true;
  private activeClipId: string | null = null;
  private preloadedClipId: string | null = null;
  /** Set while a transition is on screen, so its styles can be cleared once. */
  private transitionActive = false;
  private transition: TransitionState | null = null;

  private audioPool = new Map<string, HTMLAudioElement>();

  private timecodeEl: HTMLElement | null = null;
  private playheadHost: HTMLElement | null = null;

  private listeners = new Set<FrameListener>();
  private stateListeners = new Set<(playing: boolean) => void>();

  private masterVolume = 1;
  private masterMuted = false;

  /** Timeline geometry, mirrored here so the RAF loop never touches a store. */
  private pixelsPerFrame = 1.2;
  private scrollX = 0;
  private gutter = 60;

  private loop: { enabled: boolean; inFrame: number; outFrame: number } = {
    enabled: false,
    inFrame: 0,
    outFrame: 0,
  };

  /* ---------------- wiring ---------------- */

  attachVideos(a: HTMLVideoElement | null, b: HTMLVideoElement | null) {
    this.videoA = a;
    this.videoB = b;
    for (const el of [a, b]) {
      if (!el) continue;
      el.preload = 'auto';
      el.playsInline = true;
      el.disableRemotePlayback = true;
    }
    this.activeClipId = null;
    this.syncMedia(true);
  }

  attachTimecode(el: HTMLElement | null) {
    this.timecodeEl = el;
    this.paintTimecode();
  }

  attachPlayheadHost(el: HTMLElement | null) {
    this.playheadHost = el;
    this.paintPlayhead();
  }

  setComposition(comp: Composition) {
    this.comp = comp;
    if (this.frame > comp.durationFrames) this.frame = comp.durationFrames;
    this.releaseUnusedAudio();
    this.syncMedia(true);
    this.paintTimecode();
    this.paintPlayhead();
  }

  setGeometry(pixelsPerFrame: number, scrollX: number, gutter: number) {
    this.pixelsPerFrame = pixelsPerFrame;
    this.scrollX = scrollX;
    this.gutter = gutter;
    this.paintPlayhead();
  }

  setLoop(loop: { enabled: boolean; inFrame: number; outFrame: number }) {
    this.loop = loop;
  }

  setVolume(volume: number, muted: boolean) {
    this.masterVolume = volume;
    this.masterMuted = muted;
    this.applyVolumes();
  }

  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onPlayStateChange(cb: (playing: boolean) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /* ---------------- transport ---------------- */

  get currentFrame(): Frames {
    return this.frame;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  play() {
    if (this.playing || this.comp.durationFrames === 0) return;
    // Restart from the top when parked on the last frame.
    if (this.frame >= this.comp.durationFrames - 1) this.frame = this.loop.enabled ? this.loop.inFrame : 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.syncMedia(true);
    this.stateListeners.forEach((cb) => cb(true));
    this.startLoop();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.stopMediaPlayback();
    this.stateListeners.forEach((cb) => cb(false));
    this.stopLoop();
    this.emitFrame();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  /** Precise seek — used by clicks, shortcuts, and the end of a scrub. */
  seek(frame: Frames, scrub = false) {
    const clamped = Math.max(0, Math.min(Math.round(frame), Math.max(0, this.comp.durationFrames)));
    if (clamped === this.frame && !scrub) return;
    this.frame = clamped;
    this.paintPlayhead();
    this.paintTimecode();
    this.syncMedia(true, scrub);
    if (!this.playing) this.emitFrame();
  }

  /**
   * Scrub seek — visual position updates instantly, the decoder is asked at most
   * 4× per second and with `fastSeek` where available (Section 7).
   */
  private lastScrubSeek = 0;
  scrubTo(frame: Frames) {
    const clamped = Math.max(0, Math.min(Math.round(frame), Math.max(0, this.comp.durationFrames)));
    this.frame = clamped;
    this.paintPlayhead();
    this.paintTimecode();

    const now = performance.now();
    if (now - this.lastScrubSeek >= 250) {
      this.lastScrubSeek = now;
      this.syncMedia(true, true);
    }
  }

  /** Settle after a scrub: exact seek, then tell React where we landed. */
  endScrub() {
    this.syncMedia(true, false);
    this.emitFrame();
  }

  step(delta: number) {
    this.seek(this.frame + delta);
  }

  goToStart() {
    this.seek(0);
  }
  goToEnd() {
    this.seek(this.comp.durationFrames);
  }

  /** J/K/L shuttle. Negative rates scrub backwards. */
  private rate = 1;
  shuttle(rate: number) {
    this.rate = rate;
    if (rate === 0) this.pause();
    else if (!this.playing) this.play();
  }
  resetRate() {
    this.rate = 1;
  }
  get shuttleRate() {
    return this.rate;
  }

  /* ---------------- loop ---------------- */

  private startLoop() {
    if (this.raf !== null) return;
    const tick = () => {
      const now = performance.now();
      const dt = (now - this.lastTick) / 1000;
      this.lastTick = now;

      const active = this.activeVisual();
      const el = this.activeVideo();

      // Trust the decoder's clock while a single video plays forward at 1×;
      // it is more accurate than integrating deltas and keeps A/V locked.
      let nextFrame: number;
      if (active && active.kind === 'video' && el && !el.paused && this.rate === 1 && !active.reversed) {
        const sourceSeconds = el.currentTime;
        const elapsedSource = sourceSeconds - framesToSeconds(active.inPoint, this.comp.fps);
        nextFrame = active.start + (elapsedSource * this.comp.fps) / active.speed;
      } else {
        nextFrame = this.frame + dt * this.comp.fps * this.rate;
      }

      const end = this.loop.enabled ? this.loop.outFrame : this.comp.durationFrames;
      if (nextFrame >= end) {
        if (this.loop.enabled) {
          this.frame = this.loop.inFrame;
          this.syncMedia(true);
        } else {
          this.frame = this.comp.durationFrames;
          this.paintPlayhead();
          this.paintTimecode();
          this.pause();
          return;
        }
      } else if (nextFrame <= 0 && this.rate < 0) {
        this.frame = 0;
        this.pause();
        return;
      } else {
        this.frame = nextFrame;
      }

      this.paintPlayhead();
      this.paintTimecode();
      this.syncMedia(false);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /* ---------------- painting (no React involved) ---------------- */

  private paintPlayhead() {
    const x = this.frame * this.pixelsPerFrame - this.scrollX + this.gutter;
    const host = this.playheadHost ?? document.documentElement;
    host.style.setProperty('--playhead-x', `${x}px`);
  }

  private paintTimecode() {
    if (this.timecodeEl) {
      this.timecodeEl.textContent = formatTimecode(this.frame, this.comp.fps);
    }
  }

  private emitFrame() {
    const f = Math.round(this.frame);
    this.listeners.forEach((cb) => cb(f));
  }

  /* ---------------- media element management ---------------- */

  private activeVisual(): PlaybackClip | null {
    let best: PlaybackClip | null = null;
    for (const c of this.comp.visual) {
      if (this.frame >= c.start && this.frame < c.start + c.duration) {
        if (!best || c.layer > best.layer) best = c;
      }
    }
    return best;
  }

  /**
   * The clip a transition on `clip` hands over to: the next one along on the
   * same track that begins where this one ends. Junction tolerance matches
   * findJunctions, so a seam trimmed a frame loose still counts.
   */
  private successorOf(clip: PlaybackClip): PlaybackClip | null {
    const end = clip.start + clip.duration;
    let best: PlaybackClip | null = null;
    for (const c of this.comp.visual) {
      if (c.id === clip.id) continue;
      if (clip.trackId && c.trackId && c.trackId !== clip.trackId) continue;
      if (Math.abs(c.start - end) > 2) continue;
      if (!best || c.start < best.start) best = c;
    }
    return best;
  }

  /**
   * The transition straddling the playhead, if any.
   *
   * It occupies the tail of the outgoing clip, matching how export models it:
   * the incoming clip starts early and is revealed over the outgoing one. The
   * overlap can never exceed half of either clip.
   */
  private activeTransition(): { out: PlaybackClip; in: PlaybackClip; t: number; id: string } | null {
    const out = this.activeVisual();
    if (!out || !out.transitionOut || out.kind !== 'video') return null;

    const incoming = this.successorOf(out);
    if (!incoming || incoming.kind !== 'video') return null;

    const frames = Math.min(
      out.transitionOut.durationFrames,
      Math.floor(out.duration / 2),
      Math.floor(incoming.duration / 2)
    );
    if (frames <= 0) return null;

    const startsAt = out.start + out.duration - frames;
    if (this.frame < startsAt) return null;

    return {
      out,
      in: incoming,
      t: Math.max(0, Math.min(1, (this.frame - startsAt) / frames)),
      id: out.transitionOut.transitionId,
    };
  }

  private nextVisual(): PlaybackClip | null {
    let best: PlaybackClip | null = null;
    for (const c of this.comp.visual) {
      if (c.start > this.frame && (!best || c.start < best.start)) best = c;
    }
    return best;
  }

  private activeVideo(): HTMLVideoElement | null {
    return this.activeIsA ? this.videoA : this.videoB;
  }
  private idleVideo(): HTMLVideoElement | null {
    return this.activeIsA ? this.videoB : this.videoA;
  }

  /** Source time (seconds) for a clip at the current timeline frame. */
  private sourceSeconds(clip: PlaybackClip): number {
    const offset = this.frame - clip.start;
    const sourceFrame = clip.reversed
      ? clip.inPoint + (clip.duration - offset) * clip.speed
      : clip.inPoint + offset * clip.speed;
    return Math.max(0, framesToSeconds(sourceFrame, this.comp.fps));
  }

  /**
   * Reconcile every media element with the clock.
   * `force` re-seeks even when drift is small (after a jump); `scrub` prefers
   * `fastSeek`, which lands on the nearest keyframe but returns immediately.
   */
  private syncMedia(force = false, scrub = false) {
    this.syncVisual(force, scrub);
    this.syncAudio(force, scrub);
    this.applyVolumes();
  }

  private syncVisual(force: boolean, scrub: boolean) {
    const active = this.activeVisual();
    const el = this.activeVideo();
    const idle = this.idleVideo();
    if (!el) return;

    // A transition only exists while a video clip is active. The branches below
    // return early for "no clip" and "image clip", so the transition has to be
    // torn down here or the compositor keeps painting a frozen half-blend after
    // the playhead leaves the seam (e.g. seeking to the end of the timeline).
    if (this.transitionActive && (!active || active.kind !== 'video' || !this.activeTransition())) {
      this.clearTransitionStyles();
    }

    if (!active) {
      if (!el.paused) el.pause();
      this.activeClipId = null;
      el.style.opacity = '0';
      if (idle) idle.style.opacity = '0';
      return;
    }

    if (active.kind === 'image') {
      // Images are drawn by the compositor layer, not the video elements.
      if (!el.paused) el.pause();
      el.style.opacity = '0';
      this.activeClipId = active.id;
      return;
    }

    if (this.activeClipId !== active.id) {
      // Swap to the element that already has this clip loaded, if there is one.
      if (idle && this.preloadedClipId === active.id) {
        this.activeIsA = !this.activeIsA;
        this.preloadedClipId = null;
      }
      const target = this.activeVideo()!;
      const other = this.idleVideo();
      if (target.dataset.clipId !== active.id) {
        target.src = active.url;
        target.dataset.clipId = active.id;
        target.load();
        force = true;
      }
      target.style.opacity = '1';
      if (other) other.style.opacity = '0';
      this.activeClipId = active.id;
    }

    // A transition needs both clips on screen at once. The idle element already
    // holds the incoming clip (it was preloaded for the cut), so this drives it
    // in parallel and blends the pair instead of hard-switching.
    const trans = this.activeTransition();
    if (trans) {
      this.renderTransition(trans, force, scrub);
    } else if (this.transitionActive) {
      this.clearTransitionStyles();
    }

    const target = this.activeVideo()!;
    const want = this.sourceSeconds(active);
    if (force || Math.abs(target.currentTime - want) > DRIFT_TOLERANCE_S) {
      if (scrub && typeof (target as HTMLVideoElement & { fastSeek?(t: number): void }).fastSeek === 'function') {
        (target as HTMLVideoElement & { fastSeek(t: number): void }).fastSeek(want);
      } else {
        target.currentTime = want;
      }
    }

    const wantRate = Math.abs(active.speed * this.rate);
    // Chromium refuses rates outside this range and throws on assignment.
    target.playbackRate = Math.max(0.0625, Math.min(16, wantRate));

    if (this.playing && this.rate > 0 && !active.reversed) {
      if (target.paused) void target.play().catch(() => {});
    } else if (!target.paused) {
      target.pause();
    }

    // Preload whatever comes next on the idle element.
    const next = this.nextVisual();
    const other = this.idleVideo();
    if (next && other && next.kind === 'video' && this.preloadedClipId !== next.id && other.dataset.clipId !== next.id) {
      other.src = next.url;
      other.dataset.clipId = next.id;
      other.load();
      other.currentTime = framesToSeconds(next.inPoint, this.comp.fps);
      other.style.opacity = '0';
      this.preloadedClipId = next.id;
    }
  }

  /**
   * Drive both video elements through a transition.
   *
   * The incoming clip is stacked above the outgoing one and revealed according
   * to the transition, so z-order has to be set explicitly: which of A/B is
   * incoming flips every cut.
   */
  private renderTransition(
    trans: { out: PlaybackClip; in: PlaybackClip; t: number; id: string },
    force: boolean,
    scrub: boolean
  ) {
    const outEl = this.activeVideo();
    const inEl = this.idleVideo();
    if (!outEl || !inEl) return;

    // Make sure the incoming clip really is on the idle element.
    if (inEl.dataset.clipId !== trans.in.id) {
      inEl.src = trans.in.url;
      inEl.dataset.clipId = trans.in.id;
      inEl.load();
      this.preloadedClipId = trans.in.id;
      force = true;
    }

    // Seek the incoming clip to where it should be part-way through its own
    // head, not to its in-point: by the end of the overlap it must be exactly
    // where a hard cut would have left it.
    const framesIn = this.frame - trans.in.start;
    const wantIn = Math.max(
      0,
      framesToSeconds(trans.in.inPoint + framesIn * trans.in.speed, this.comp.fps)
    );
    if (force || Math.abs(inEl.currentTime - wantIn) > DRIFT_TOLERANCE_S) {
      if (scrub && typeof (inEl as HTMLVideoElement & { fastSeek?(t: number): void }).fastSeek === 'function') {
        (inEl as HTMLVideoElement & { fastSeek(t: number): void }).fastSeek(wantIn);
      } else {
        inEl.currentTime = wantIn;
      }
    }
    inEl.playbackRate = Math.max(0.0625, Math.min(16, Math.abs(trans.in.speed * this.rate)));
    if (this.playing && this.rate > 0 && !trans.in.reversed) {
      if (inEl.paused) void inEl.play().catch(() => {});
    } else if (!inEl.paused) {
      inEl.pause();
    }

    // Stacking only. Every visual property is painted by CompositorLayers,
    // which already owns transform, grade and opacity for these elements —
    // two writers on the same style would fight every frame.
    outEl.style.zIndex = '1';
    inEl.style.zIndex = '2';

    this.transition = { outClipId: trans.out.id, inClipId: trans.in.id, transitionId: trans.id, t: trans.t };
    this.transitionActive = true;
  }

  /** Hand the elements back to ordinary playback. */
  private clearTransitionStyles() {
    this.transitionActive = false;
    this.transition = null;
    for (const el of [this.videoA, this.videoB]) {
      if (!el) continue;
      el.style.zIndex = '';
      el.style.clipPath = '';
      el.style.transformOrigin = '';
    }
  }

  /**
   * The transition currently on screen, for the compositor to paint.
   * Read every frame from a RAF loop, so it allocates nothing.
   */
  currentTransition(): TransitionState | null {
    return this.transition;
  }

  private syncAudio(force: boolean, scrub: boolean) {
    for (const clip of this.comp.audio) {
      const live = this.frame >= clip.start && this.frame < clip.start + clip.duration;
      let el = this.audioPool.get(clip.id);

      if (!live) {
        if (el && !el.paused) el.pause();
        continue;
      }

      if (!el) {
        el = new Audio();
        el.preload = 'auto';
        el.src = clip.url;
        this.audioPool.set(clip.id, el);
        force = true;
      }

      const want = this.sourceSeconds(clip);
      if (force || Math.abs(el.currentTime - want) > DRIFT_TOLERANCE_S) {
        if (scrub && typeof (el as HTMLAudioElement & { fastSeek?(t: number): void }).fastSeek === 'function') {
          (el as HTMLAudioElement & { fastSeek(t: number): void }).fastSeek(want);
        } else {
          el.currentTime = want;
        }
      }
      el.playbackRate = Math.max(0.0625, Math.min(16, Math.abs(clip.speed * this.rate)));

      if (this.playing && this.rate > 0 && !clip.reversed) {
        if (el.paused) void el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    }
  }

  private applyVolumes() {
    const master = this.masterMuted ? 0 : this.masterVolume;
    const active = this.activeVisual();
    for (const el of [this.videoA, this.videoB]) {
      if (!el) continue;
      const isActive = el === this.activeVideo();
      el.volume = isActive && active && !active.muted ? Math.min(1, master * active.volume) : 0;
      el.muted = !isActive;
    }
    for (const clip of this.comp.audio) {
      const el = this.audioPool.get(clip.id);
      if (el) el.volume = clip.muted ? 0 : Math.min(1, master * clip.volume);
    }
  }

  private stopMediaPlayback() {
    for (const el of [this.videoA, this.videoB]) if (el && !el.paused) el.pause();
    for (const el of this.audioPool.values()) if (!el.paused) el.pause();
  }

  private releaseUnusedAudio() {
    const ids = new Set(this.comp.audio.map((c) => c.id));
    for (const [cid, el] of this.audioPool) {
      if (!ids.has(cid)) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        this.audioPool.delete(cid);
      }
    }
  }

  destroy() {
    this.pause();
    this.stopLoop();
    for (const el of this.audioPool.values()) {
      el.pause();
      el.removeAttribute('src');
    }
    this.audioPool.clear();
    this.listeners.clear();
    this.stateListeners.clear();
  }
}

/** One engine per app — the preview attaches to it, shortcuts drive it. */
export const playback = new PlaybackEngine();
