import type { ColorGrade, TextProps } from '../types/project';

/**
 * Content libraries that ship with the app.
 *
 * Everything here is generated from code — SVG paths, colour maths, synthesised
 * audio — so the app has a real library with no bundled binary assets and no
 * licensing questions.
 */

/* ------------------------------------------------------------------ *
 * Filters — colour-grade presets (Section 5.3 "Filters" tab)
 * ------------------------------------------------------------------ */

export type FilterCategory = 'portrait' | 'film' | 'mono' | 'vibrant' | 'moody';

export interface FilterDef {
  id: string;
  name: string;
  category: FilterCategory;
  /** Applied on top of the clip's own grade at the given intensity. */
  grade: Partial<ColorGrade>;
  swatch: [string, string];
}

export const FILTERS: FilterDef[] = [
  { id: 'clean', name: 'Clean', category: 'portrait', swatch: ['#d8d4cc', '#f4f1ec'], grade: { contrast: 6, saturation: 4, clarity: 8 } },
  { id: 'soft-skin', name: 'Soft skin', category: 'portrait', swatch: ['#e8cfc0', '#f7e6dc'], grade: { exposure: 6, contrast: -6, temperature: 8, clarity: -12, vibrance: 8 } },
  { id: 'glow-up', name: 'Glow up', category: 'portrait', swatch: ['#f0d8e0', '#ffeef4'], grade: { exposure: 10, highlights: 12, shadows: 14, saturation: 8, clarity: -6 } },
  { id: 'kodak', name: 'Kodak', category: 'film', swatch: ['#4a3a20', '#e8c68a'], grade: { temperature: 14, contrast: 10, saturation: 6, highlights: -8, blacks: 6 } },
  { id: 'portra', name: 'Portra', category: 'film', swatch: ['#5a4436', '#eddcc8'], grade: { temperature: 8, contrast: -4, saturation: -6, shadows: 10, whites: -6 } },
  { id: 'cinestill', name: 'Cinestill', category: 'film', swatch: ['#2a1a30', '#ff9a7a'], grade: { temperature: -6, tint: 8, contrast: 14, highlights: 10, saturation: 10 } },
  { id: 'super8', name: 'Super 8', category: 'film', swatch: ['#4a3418', '#d8b06a'], grade: { temperature: 18, contrast: 16, saturation: -10, vignette: 30, blacks: 12 } },
  { id: 'noir', name: 'Noir', category: 'mono', swatch: ['#0a0a0a', '#e8e8e8'], grade: { saturation: -100, contrast: 26, blacks: -14, whites: 10, vignette: 25 } },
  { id: 'silver', name: 'Silver', category: 'mono', swatch: ['#2a2a2a', '#d0d0d0'], grade: { saturation: -100, contrast: 8, shadows: 12, highlights: -6 } },
  { id: 'ink', name: 'Ink', category: 'mono', swatch: ['#000000', '#ffffff'], grade: { saturation: -100, contrast: 44, clarity: 25 } },
  { id: 'punch', name: 'Punch', category: 'vibrant', swatch: ['#2a0a40', '#ff3ea5'], grade: { contrast: 18, saturation: 24, vibrance: 18, clarity: 12 } },
  { id: 'neon-city', name: 'Neon city', category: 'vibrant', swatch: ['#0a1030', '#00e0ff'], grade: { temperature: -20, tint: 14, contrast: 20, saturation: 26, shadows: 10 } },
  { id: 'tropic', name: 'Tropic', category: 'vibrant', swatch: ['#0a3a2a', '#4affb0'], grade: { temperature: 6, saturation: 20, vibrance: 14, highlights: 8 } },
  { id: 'teal-orange', name: 'Teal & orange', category: 'moody', swatch: ['#0d2030', '#e0a070'], grade: { temperature: 10, tint: -10, contrast: 16, shadows: 8, saturation: 8 } },
  { id: 'moody-blue', name: 'Moody blue', category: 'moody', swatch: ['#0a1420', '#5a90c0'], grade: { temperature: -22, contrast: 14, shadows: -10, saturation: -8, vignette: 22 } },
  { id: 'ash', name: 'Ash', category: 'moody', swatch: ['#20211f', '#a8a49a'], grade: { saturation: -32, contrast: 6, blacks: 14, whites: -10, clarity: 6 } },
  { id: 'ember', name: 'Ember', category: 'moody', swatch: ['#2a1006', '#ff8a3a'], grade: { temperature: 24, contrast: 18, highlights: -10, shadows: -6, vignette: 28 } },
];

export const FILTER_CATEGORIES: { id: FilterCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'film', label: 'Film' },
  { id: 'mono', label: 'Mono' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'moody', label: 'Moody' },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id);

/* ------------------------------------------------------------------ *
 * Stickers — drawn as SVG so nothing has to ship as a binary
 * ------------------------------------------------------------------ */

export type StickerCategory = 'shapes' | 'arrows' | 'badges' | 'social' | 'decor';

export interface StickerDef {
  id: string;
  name: string;
  category: StickerCategory;
  /** Complete SVG markup, 100×100 viewBox. */
  svg: string;
}

const sv = (body: string) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const STICKERS: StickerDef[] = [
  { id: 'circle', name: 'Circle', category: 'shapes', svg: sv('<circle cx="50" cy="50" r="38" fill="#00E676"/>') },
  { id: 'ring', name: 'Ring', category: 'shapes', svg: sv('<circle cx="50" cy="50" r="36" fill="none" stroke="#00E676" stroke-width="8"/>') },
  { id: 'square', name: 'Square', category: 'shapes', svg: sv('<rect x="16" y="16" width="68" height="68" rx="10" fill="#FFB300"/>') },
  { id: 'triangle', name: 'Triangle', category: 'shapes', svg: sv('<path d="M50 14L88 82H12z" fill="#FF5252"/>') },
  { id: 'heart', name: 'Heart', category: 'decor', svg: sv('<path d="M50 84C22 64 12 50 12 38a20 20 0 0138-10 20 20 0 0138 10c0 12-10 26-38 46z" fill="#FF5252"/>') },
  { id: 'star', name: 'Star', category: 'decor', svg: sv('<path d="M50 10l12 25 27 4-20 19 5 27-24-13-24 13 5-27L11 39l27-4z" fill="#FFB300"/>') },
  { id: 'sparkle', name: 'Sparkle', category: 'decor', svg: sv('<path d="M50 8l9 30 30 9-30 9-9 30-9-30-30-9 30-9z" fill="#00E676"/>') },
  { id: 'burst', name: 'Burst', category: 'decor', svg: sv('<path d="M50 6l8 20 19-11-8 21 22 3-18 13 18 13-22 3 8 21-19-11-8 20-8-20-19 11 8-21-22-3 18-13-18-13 22-3-8-21 19 11z" fill="#FF5252"/>') },
  { id: 'arrow-up', name: 'Arrow up', category: 'arrows', svg: sv('<path d="M50 12l30 34H62v42H38V46H20z" fill="#00E676"/>') },
  { id: 'arrow-right', name: 'Arrow right', category: 'arrows', svg: sv('<path d="M88 50L54 20v18H12v24h42v18z" fill="#00E676"/>') },
  { id: 'arrow-curve', name: 'Curved arrow', category: 'arrows', svg: sv('<path d="M18 76c0-30 22-46 48-46" fill="none" stroke="#FFB300" stroke-width="9" stroke-linecap="round"/><path d="M60 14l24 16-24 16z" fill="#FFB300"/>') },
  { id: 'pointer', name: 'Pointer', category: 'arrows', svg: sv('<path d="M28 12l46 32-20 5 12 24-11 6-12-24-15 14z" fill="#F0EDE8"/>') },
  { id: 'badge-new', name: 'NEW badge', category: 'badges', svg: sv('<circle cx="50" cy="50" r="40" fill="#FF5252"/><text x="50" y="58" font-family="Outfit,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">NEW</text>') },
  { id: 'badge-sale', name: 'SALE badge', category: 'badges', svg: sv('<path d="M50 6l11 12 16-3 3 16 12 11-12 11-3 16-16-3-11 12-11-12-16 3-3-16L8 50l12-11 3-16 16 3z" fill="#FFB300"/><text x="50" y="58" font-family="Outfit,sans-serif" font-size="20" font-weight="700" fill="#111113" text-anchor="middle">SALE</text>') },
  { id: 'badge-check', name: 'Verified', category: 'badges', svg: sv('<circle cx="50" cy="50" r="38" fill="#00E676"/><path d="M32 52l12 12 24-26" fill="none" stroke="#111113" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>') },
  { id: 'speech', name: 'Speech bubble', category: 'social', svg: sv('<path d="M14 20h72v46H48L30 84V66H14z" rx="8" fill="#F0EDE8"/>') },
  { id: 'like', name: 'Thumbs up', category: 'social', svg: sv('<path d="M30 44h12V22a8 8 0 0116 0c0 8-4 14-4 22h20a8 8 0 018 9l-5 27a8 8 0 01-8 6H30z" fill="#00E676"/><rect x="12" y="44" width="14" height="42" rx="3" fill="#00C15E"/>') },
  { id: 'play-btn', name: 'Play button', category: 'social', svg: sv('<circle cx="50" cy="50" r="38" fill="#FF5252"/><path d="M40 32l28 18-28 18z" fill="#fff"/>') },
  { id: 'progress-ring', name: 'Progress ring', category: 'decor', svg: sv('<circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="8"/><circle cx="50" cy="50" r="36" fill="none" stroke="#00E676" stroke-width="8" stroke-dasharray="170 60" stroke-linecap="round" transform="rotate(-90 50 50)"/>') },
  { id: 'dots', name: 'Dots', category: 'decor', svg: sv('<circle cx="22" cy="50" r="9" fill="#00E676"/><circle cx="50" cy="50" r="9" fill="#FFB300"/><circle cx="78" cy="50" r="9" fill="#FF5252"/>') },
];

export const STICKER_CATEGORIES: { id: StickerCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'badges', label: 'Badges' },
  { id: 'social', label: 'Social' },
  { id: 'decor', label: 'Decor' },
];

export const stickerById = (id: string) => STICKERS.find((s) => s.id === id);
export const stickerDataUrl = (s: StickerDef) => `data:image/svg+xml;utf8,${encodeURIComponent(s.svg)}`;

/* ------------------------------------------------------------------ *
 * Text presets
 * ------------------------------------------------------------------ */

export interface TextPresetDef {
  id: string;
  name: string;
  patch: Partial<TextProps>;
  /** CSS used to render the library thumbnail. */
  preview: React.CSSProperties;
}

export const TEXT_PRESETS: TextPresetDef[] = [
  {
    id: 'plain',
    name: 'Plain',
    patch: { fontFamily: 'DM Sans', fontWeight: 500, color: '#FFFFFF' },
    preview: { color: '#fff', fontFamily: 'DM Sans', fontWeight: 500 },
  },
  {
    id: 'bold-title',
    name: 'Bold title',
    patch: { fontFamily: 'Outfit', fontWeight: 700, fontSize: 84, letterSpacing: -1 },
    preview: { color: '#fff', fontFamily: 'Outfit', fontWeight: 700, letterSpacing: '-0.02em' },
  },
  {
    id: 'outlined',
    name: 'Outlined',
    patch: { fontFamily: 'Outfit', fontWeight: 700, color: '#FFFFFF', outline: { enabled: true, color: '#111113', width: 6 } },
    preview: { color: '#fff', fontFamily: 'Outfit', fontWeight: 700, WebkitTextStroke: '1.5px #111113' },
  },
  {
    id: 'shadowed',
    name: 'Drop shadow',
    patch: { fontWeight: 700, shadow: { enabled: true, color: 'rgba(0,0,0,0.7)', x: 0, y: 6, blur: 12 } },
    preview: { color: '#fff', fontWeight: 700, textShadow: '0 2px 6px rgba(0,0,0,0.8)' },
  },
  {
    id: 'boxed',
    name: 'Boxed',
    patch: { fontWeight: 600, background: { enabled: true, color: 'rgba(0,0,0,0.62)', padding: 20, radius: 8 } },
    preview: { color: '#fff', fontWeight: 600, background: 'rgba(0,0,0,0.62)', padding: '2px 7px', borderRadius: 4 },
  },
  {
    id: 'accent-box',
    name: 'Accent box',
    patch: { fontWeight: 700, color: '#111113', background: { enabled: true, color: '#00E676', padding: 20, radius: 6 } },
    preview: { color: '#111113', fontWeight: 700, background: '#00E676', padding: '2px 7px', borderRadius: 4 },
  },
  {
    id: 'gradient',
    name: 'Gradient',
    patch: { fontWeight: 700, gradient: { enabled: true, from: '#00E676', to: '#00B4FF', angle: 90 } },
    preview: {
      fontWeight: 700,
      background: 'linear-gradient(90deg,#00E676,#00B4FF)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    },
  },
  {
    id: 'caption',
    name: 'Caption',
    patch: {
      fontFamily: 'DM Sans',
      fontWeight: 700,
      fontSize: 48,
      color: '#FFFFFF',
      outline: { enabled: true, color: '#000000', width: 5 },
      background: { enabled: false, color: 'rgba(0,0,0,0.5)', padding: 12, radius: 4 },
    },
    preview: { color: '#fff', fontFamily: 'DM Sans', fontWeight: 700, WebkitTextStroke: '1.2px #000' },
  },
  {
    id: 'mono-tag',
    name: 'Mono tag',
    patch: { fontFamily: 'JetBrains Mono', fontWeight: 500, fontSize: 40, letterSpacing: 2, color: '#00E676' },
    preview: { color: '#00E676', fontFamily: 'JetBrains Mono', letterSpacing: '0.08em' },
  },
];

/* ------------------------------------------------------------------ *
 * Animation presets — generate keyframes on the clip's own properties
 * ------------------------------------------------------------------ */

export interface AnimationPresetDef {
  id: string;
  name: string;
  slot: 'in' | 'out' | 'loop';
  /** Property path -> keyframe values across the animation, normalised 0..1 time. */
  tracks: Record<string, { t: number; v: number }[]>;
  defaultFrames: number;
}

export const ANIMATION_PRESETS: AnimationPresetDef[] = [
  { id: 'fade-in', name: 'Fade in', slot: 'in', defaultFrames: 15, tracks: { 'transform.opacity': [{ t: 0, v: 0 }, { t: 1, v: 100 }] } },
  { id: 'zoom-in', name: 'Zoom in', slot: 'in', defaultFrames: 18, tracks: { 'transform.scale': [{ t: 0, v: 60 }, { t: 1, v: 100 }], 'transform.opacity': [{ t: 0, v: 0 }, { t: 0.6, v: 100 }] } },
  { id: 'slide-in-left', name: 'Slide in left', slot: 'in', defaultFrames: 18, tracks: { 'transform.x': [{ t: 0, v: -600 }, { t: 1, v: 0 }] } },
  { id: 'slide-in-up', name: 'Slide in up', slot: 'in', defaultFrames: 18, tracks: { 'transform.y': [{ t: 0, v: 400 }, { t: 1, v: 0 }] } },
  { id: 'pop-in', name: 'Pop in', slot: 'in', defaultFrames: 14, tracks: { 'transform.scale': [{ t: 0, v: 40 }, { t: 0.65, v: 112 }, { t: 1, v: 100 }] } },
  { id: 'spin-in', name: 'Spin in', slot: 'in', defaultFrames: 20, tracks: { 'transform.rotation': [{ t: 0, v: -180 }, { t: 1, v: 0 }], 'transform.scale': [{ t: 0, v: 50 }, { t: 1, v: 100 }] } },

  { id: 'fade-out', name: 'Fade out', slot: 'out', defaultFrames: 15, tracks: { 'transform.opacity': [{ t: 0, v: 100 }, { t: 1, v: 0 }] } },
  { id: 'zoom-out', name: 'Zoom out', slot: 'out', defaultFrames: 18, tracks: { 'transform.scale': [{ t: 0, v: 100 }, { t: 1, v: 55 }], 'transform.opacity': [{ t: 0.4, v: 100 }, { t: 1, v: 0 }] } },
  { id: 'slide-out-right', name: 'Slide out right', slot: 'out', defaultFrames: 18, tracks: { 'transform.x': [{ t: 0, v: 0 }, { t: 1, v: 600 }] } },
  { id: 'slide-out-down', name: 'Slide out down', slot: 'out', defaultFrames: 18, tracks: { 'transform.y': [{ t: 0, v: 0 }, { t: 1, v: 400 }] } },
  { id: 'spin-out', name: 'Spin out', slot: 'out', defaultFrames: 20, tracks: { 'transform.rotation': [{ t: 0, v: 0 }, { t: 1, v: 180 }], 'transform.opacity': [{ t: 0.5, v: 100 }, { t: 1, v: 0 }] } },

  { id: 'pulse', name: 'Pulse', slot: 'loop', defaultFrames: 30, tracks: { 'transform.scale': [{ t: 0, v: 100 }, { t: 0.5, v: 108 }, { t: 1, v: 100 }] } },
  { id: 'wobble', name: 'Wobble', slot: 'loop', defaultFrames: 30, tracks: { 'transform.rotation': [{ t: 0, v: -4 }, { t: 0.5, v: 4 }, { t: 1, v: -4 }] } },
  { id: 'float', name: 'Float', slot: 'loop', defaultFrames: 45, tracks: { 'transform.y': [{ t: 0, v: 0 }, { t: 0.5, v: -22 }, { t: 1, v: 0 }] } },
  { id: 'blink', name: 'Blink', slot: 'loop', defaultFrames: 24, tracks: { 'transform.opacity': [{ t: 0, v: 100 }, { t: 0.5, v: 35 }, { t: 1, v: 100 }] } },
];

export const animationsForSlot = (slot: 'in' | 'out' | 'loop') => ANIMATION_PRESETS.filter((a) => a.slot === slot);

/* ------------------------------------------------------------------ *
 * Sound effects — synthesised on demand with the Web Audio API
 * ------------------------------------------------------------------ */

export type SfxKind = 'whoosh' | 'pop' | 'click' | 'riser' | 'impact' | 'sweep' | 'blip' | 'sub-drop';

export interface SfxDef {
  id: SfxKind;
  name: string;
  seconds: number;
}

export const SOUND_EFFECTS: SfxDef[] = [
  { id: 'whoosh', name: 'Whoosh', seconds: 0.7 },
  { id: 'pop', name: 'Pop', seconds: 0.25 },
  { id: 'click', name: 'Click', seconds: 0.12 },
  { id: 'riser', name: 'Riser', seconds: 2.0 },
  { id: 'impact', name: 'Impact', seconds: 1.2 },
  { id: 'sweep', name: 'Sweep', seconds: 1.0 },
  { id: 'blip', name: 'Blip', seconds: 0.2 },
  { id: 'sub-drop', name: 'Sub drop', seconds: 1.5 },
];

/** Render one of the built-in effects to a WAV blob, entirely offline. */
export async function renderSfx(kind: SfxKind, seconds: number): Promise<Blob> {
  const sampleRate = 48000;
  const length = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const now = 0;

  const noiseBuffer = () => {
    const buf = ctx.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  switch (kind) {
    case 'whoosh':
    case 'sweep': {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.6;
      filter.frequency.setValueAtTime(kind === 'whoosh' ? 300 : 5200, now);
      filter.frequency.exponentialRampToValueAtTime(kind === 'whoosh' ? 5200 : 260, now + seconds);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.6, now + seconds * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      src.connect(filter).connect(gain);
      src.start(now);
      break;
    }
    case 'riser': {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(1800, now + seconds);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(9000, now + seconds);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + seconds * 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      osc.connect(filter).connect(gain);
      osc.start(now);
      break;
    }
    case 'sub-drop': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + seconds);
      gain.gain.setValueAtTime(0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      osc.connect(gain);
      osc.start(now);
      break;
    }
    case 'impact': {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + seconds * 0.6);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + seconds * 0.5);
      gain.gain.setValueAtTime(0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      src.connect(filter).connect(gain);
      osc.connect(gain);
      src.start(now);
      osc.start(now);
      break;
    }
    default: {
      // pop / click / blip — short tonal transients
      const osc = ctx.createOscillator();
      osc.type = kind === 'blip' ? 'square' : 'sine';
      const f0 = kind === 'click' ? 2400 : kind === 'blip' ? 900 : 620;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'pop' ? 180 : f0 * 1.6, now + seconds);
      gain.gain.setValueAtTime(0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      osc.connect(gain);
      osc.start(now);
    }
  }

  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

/** Minimal 16-bit PCM WAV writer — enough for the generated effects. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));

  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  str(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, bytes, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------ *
 * Voice changer presets — Section 9.10
 * ------------------------------------------------------------------ */

export const VOICE_PRESETS: { id: string; name: string; pitch: number; formant: number; ring?: number; delay?: number }[] = [
  { id: 'none', name: 'None', pitch: 0, formant: 0 },
  { id: 'deep', name: 'Deep', pitch: -6, formant: -2 },
  { id: 'chipmunk', name: 'Chipmunk', pitch: 8, formant: 4 },
  { id: 'robot', name: 'Robot', pitch: 0, formant: 0, ring: 60 },
  { id: 'echo', name: 'Echo', pitch: 0, formant: 0, delay: 0.28 },
  { id: 'helium', name: 'Helium', pitch: 12, formant: 6 },
];
