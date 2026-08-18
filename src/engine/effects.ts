/**
 * Effect registry — Section 10.
 *
 * Every effect declares both halves of its implementation:
 *   `glsl`    fragment shader body for the real-time WebGL preview
 *   `ffmpeg`  filter chain that must produce a visually matching export
 *
 * Effects whose `glsl` is null fall back to rendering preview frames through
 * the same ffmpeg chain (slower, but never wrong). Effects whose `ffmpeg` is
 * null are exported by reading back the WebGL result frame by frame.
 */

export type EffectCategory = 'basic' | 'color' | 'glitch' | 'light' | 'distortion' | 'style';

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

/**
 * How an effect previews in real time.
 *
 * The compositor drives the preview with CSS filters, which cover more than
 * they look like they should. `css` builds that declaration from the effect's
 * own parameters; effects that genuinely cannot be expressed leave it null and
 * are marked in the library as export-only rather than silently doing nothing.
 */
export type CssPreview = ((p: Record<string, number>) => string) | null;

export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  /** Real-time preview via CSS filters. Null = applied at export only. */
  css?: CssPreview;
  /** Fragment shader body. Receives `vec4 color`, `vec2 uv`, uniforms `u_p0..u_p3`, `u_time`, `u_res`. */
  glsl: string | null;
  /** Builds the ffmpeg filter fragment for the given params. */
  ffmpeg: ((p: Record<string, number>) => string) | null;
  params: EffectParamDef[];
  /** Swatch colours for the library thumbnail, no external assets needed. */
  swatch: [string, string];
}

const amount = (def = 50): EffectParamDef => ({ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: def, unit: '%' });
const n = (p: Record<string, number>, k: string, d: number) => (p[k] ?? d) / 100;

/**
 * CSS preview builders.
 *
 * Composed from primitives so most of the library previews for free rather
 * than only the handful that happened to be hardcoded in the compositor.
 */
const cssPreviews: Record<string, CssPreview> = {
  'blur-gaussian': (p) => `blur(${((p.radius ?? 6) / 2.4).toFixed(2)}px)`,
  'blur-motion': (p) => `blur(${((p.length ?? 16) / 12).toFixed(2)}px)`,
  sharpen: (p) => `contrast(${(1 + n(p, 'amount', 60) * 0.35).toFixed(3)}) saturate(${(1 + n(p, 'amount', 60) * 0.1).toFixed(3)})`,
  vignette: (p) => `brightness(${(1 - n(p, 'amount', 50) * 0.18).toFixed(3)})`,
  'film-grain': (p) => `contrast(${(1 + n(p, 'amount', 35) * 0.12).toFixed(3)}) sepia(${(n(p, 'amount', 35) * 0.12).toFixed(3)})`,

  'black-white': (p) => `grayscale(${n(p, 'amount', 100).toFixed(3)})`,
  sepia: (p) => `sepia(${n(p, 'amount', 100).toFixed(3)})`,
  duotone: (p) => `grayscale(${n(p, 'amount', 100).toFixed(3)}) sepia(${n(p, 'amount', 100).toFixed(3)}) hue-rotate(${(p.hue ?? 150) - 40}deg) saturate(2)`,
  infrared: (p) => `hue-rotate(${(n(p, 'amount', 80) * 200).toFixed(0)}deg) saturate(1.5)`,
  'bleach-bypass': (p) => `saturate(${(1 - n(p, 'amount', 70) * 0.6).toFixed(3)}) contrast(${(1 + n(p, 'amount', 70) * 0.5).toFixed(3)}) brightness(1.05)`,
  'cross-process': (p) => `hue-rotate(${(-n(p, 'amount', 60) * 18).toFixed(0)}deg) saturate(${(1 + n(p, 'amount', 60) * 0.5).toFixed(3)}) contrast(1.1)`,
  'faded-matte': (p) => `contrast(${(1 - n(p, 'amount', 55) * 0.25).toFixed(3)}) brightness(${(1 + n(p, 'amount', 55) * 0.1).toFixed(3)}) saturate(0.88)`,
  vintage: (p) => `sepia(${(n(p, 'amount', 70) * 0.45).toFixed(3)}) contrast(1.08) saturate(0.85)`,
  warm: (p) => `sepia(${(n(p, 'amount', 50) * 0.32).toFixed(3)}) saturate(1.15)`,
  cool: (p) => `hue-rotate(${(-n(p, 'amount', 50) * 22).toFixed(0)}deg) saturate(1.08)`,
  vivid: (p) => `saturate(${(1 + n(p, 'amount', 60)).toFixed(3)}) contrast(${(1 + n(p, 'amount', 60) * 0.3).toFixed(3)})`,
  cinematic: (p) => `contrast(${(1 + n(p, 'amount', 65) * 0.2).toFixed(3)}) saturate(${(1 + n(p, 'amount', 65) * 0.15).toFixed(3)}) sepia(${(n(p, 'amount', 65) * 0.16).toFixed(3)})`,

  'digital-noise': (p) => `contrast(${(1 + n(p, 'amount', 40) * 0.3).toFixed(3)})`,
  holographic: (p) => `hue-rotate(${(n(p, 'amount', 55) * 90).toFixed(0)}deg) saturate(${(1 + n(p, 'amount', 55)).toFixed(3)})`,
  crt: (p) => `contrast(${(1 + n(p, 'amount', 60) * 0.25).toFixed(3)}) brightness(0.94) saturate(1.15)`,
  'signal-loss': (p) => `contrast(${(1 + n(p, 'amount', 50) * 0.4).toFixed(3)}) grayscale(${(n(p, 'amount', 50) * 0.3).toFixed(3)})`,

  'lens-flare': (p) => `brightness(${(1 + n(p, 'amount', 60) * 0.14).toFixed(3)}) contrast(0.96)`,
  'light-leak': (p) => `sepia(${(n(p, 'amount', 55) * 0.3).toFixed(3)}) brightness(${(1 + n(p, 'amount', 55) * 0.12).toFixed(3)})`,
  bokeh: (p) => `blur(${((p.radius ?? 10) / 5).toFixed(2)}px) brightness(1.05)`,
  glow: (p) => `brightness(${(1 + n(p, 'amount', 55) * 0.18).toFixed(3)}) contrast(0.95) saturate(1.1)`,
  anamorphic: (p) => `brightness(${(1 + n(p, 'amount', 60) * 0.1).toFixed(3)}) saturate(1.2)`,

  watercolor: (p) => `blur(${(n(p, 'amount', 60) * 1.2).toFixed(2)}px) saturate(1.25) contrast(0.94)`,
  'oil-paint': (p) => `blur(${(((p.radius ?? 3) / 4)).toFixed(2)}px) saturate(1.2) contrast(1.06)`,
  sketch: (p) => `grayscale(${n(p, 'amount', 70).toFixed(3)}) invert(${(n(p, 'amount', 70) * 0.85).toFixed(3)}) contrast(2.4) brightness(1.3)`,
  halftone: () => `grayscale(1) contrast(2.2)`,
  'neon-glow': (p) => `saturate(${(1 + n(p, 'amount', 70) * 1.6).toFixed(3)}) contrast(1.5) brightness(0.9)`,
  thermal: () => `grayscale(1) sepia(1) hue-rotate(-40deg) saturate(6) contrast(1.4)`,
  'night-vision': () => `grayscale(1) sepia(1) hue-rotate(50deg) saturate(5) brightness(1.1)`,
  'tilt-shift': (p) => `blur(${(n(p, 'amount', 70) * 0.9).toFixed(2)}px) saturate(1.12)`,

  // Geometry — CSS filters cannot displace pixels, so these are export-only.
  'rgb-split': null,
  vhs: null,
  'scan-lines': null,
  'pixel-sort': null,
  'chromatic-aberration': null,
  'lens-distortion': null,
  prism: null,
  wave: null,
  bulge: null,
  fisheye: null,
  kaleidoscope: null,
  shockwave: null,
  liquify: null,
  'fade-in': null,
  'fade-out': null,
};

/** Real-time CSS preview for an effect instance, or null when export-only. */
export function effectCss(effectId: string, params: Record<string, number>): string | null {
  const build = cssPreviews[effectId];
  return build ? build(params) : null;
}

/** True when the effect only shows up in the exported file. */
export const isExportOnly = (effectId: string) => cssPreviews[effectId] === null;

export const EFFECTS: EffectDef[] = [
  /* ---------------- basic ---------------- */
  {
    id: 'blur-gaussian',
    name: 'Blur',
    category: 'basic',
    swatch: ['#2b3a44', '#5b7a8c'],
    params: [{ key: 'radius', label: 'Radius', min: 0, max: 40, step: 0.5, default: 6, unit: 'px' }],
    glsl: `
      vec4 sum = vec4(0.0);
      float r = u_p0;
      float total = 0.0;
      for (int i = -6; i <= 6; i++) {
        for (int j = -6; j <= 6; j++) {
          vec2 off = vec2(float(i), float(j)) * r / u_res;
          float w = exp(-(float(i*i + j*j)) / 18.0);
          sum += texture2D(u_texture, uv + off) * w;
          total += w;
        }
      }
      color = sum / total;`,
    ffmpeg: (p) => `gblur=sigma=${(p.radius ?? 6).toFixed(2)}`,
  },
  {
    id: 'blur-motion',
    name: 'Motion blur',
    category: 'basic',
    swatch: ['#22262e', '#6d7684'],
    params: [
      { key: 'length', label: 'Length', min: 0, max: 60, step: 1, default: 16, unit: 'px' },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    ],
    glsl: `
      float a = radians(u_p1);
      vec2 dir = vec2(cos(a), sin(a)) * u_p0 / u_res;
      vec4 sum = vec4(0.0);
      for (int i = 0; i < 12; i++) {
        float t = (float(i) / 11.0 - 0.5);
        sum += texture2D(u_texture, uv + dir * t);
      }
      color = sum / 12.0;`,
    ffmpeg: (p) => `tblend=all_mode=average,gblur=sigma=${((p.length ?? 16) / 8).toFixed(2)}:sigmaV=0`,
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    category: 'basic',
    swatch: ['#2f3a2f', '#8fbf7f'],
    params: [amount(60)],
    glsl: `
      vec2 px = 1.0 / u_res;
      vec4 c = texture2D(u_texture, uv);
      vec4 blur = (
        texture2D(u_texture, uv + vec2(px.x, 0.0)) +
        texture2D(u_texture, uv - vec2(px.x, 0.0)) +
        texture2D(u_texture, uv + vec2(0.0, px.y)) +
        texture2D(u_texture, uv - vec2(0.0, px.y))) * 0.25;
      color = vec4(mix(c.rgb, c.rgb + (c.rgb - blur.rgb) * 2.0, u_p0 / 100.0), c.a);`,
    ffmpeg: (p) => `unsharp=5:5:${(n(p, 'amount', 60) * 2).toFixed(2)}`,
  },
  {
    id: 'vignette',
    name: 'Vignette',
    category: 'basic',
    swatch: ['#141414', '#3a3a3a'],
    params: [amount(50), { key: 'feather', label: 'Feather', min: 1, max: 100, step: 1, default: 55 }],
    glsl: `
      float d = distance(uv, vec2(0.5));
      float f = smoothstep(0.75, 0.75 - u_p1 / 140.0, d);
      color = vec4(color.rgb * mix(1.0, f, u_p0 / 100.0), color.a);`,
    ffmpeg: (p) => `vignette=angle=${(Math.PI / 5 + n(p, 'amount', 50) * 0.6).toFixed(3)}`,
  },
  {
    id: 'film-grain',
    name: 'Film grain',
    category: 'basic',
    swatch: ['#2a2722', '#6b6459'],
    params: [amount(35)],
    glsl: `
      float g = fract(sin(dot(uv * u_res + u_time, vec2(12.9898, 78.233))) * 43758.5453);
      color = vec4(color.rgb + (g - 0.5) * u_p0 / 200.0, color.a);`,
    ffmpeg: (p) => `noise=alls=${Math.round(n(p, 'amount', 35) * 40)}:allf=t+u`,
  },
  {
    id: 'fade-in',
    name: 'Fade in',
    category: 'basic',
    swatch: ['#000000', '#8a8a8a'],
    params: [{ key: 'duration', label: 'Duration', min: 1, max: 120, step: 1, default: 20, unit: 'f' }],
    glsl: `color = vec4(color.rgb * clamp(u_progress * 100.0 / max(u_p0, 1.0), 0.0, 1.0), color.a);`,
    ffmpeg: (p) => `fade=t=in:st=0:d=${((p.duration ?? 20) / 30).toFixed(2)}`,
  },
  {
    id: 'fade-out',
    name: 'Fade out',
    category: 'basic',
    swatch: ['#8a8a8a', '#000000'],
    params: [{ key: 'duration', label: 'Duration', min: 1, max: 120, step: 1, default: 20, unit: 'f' }],
    glsl: `color = vec4(color.rgb * clamp((1.0 - u_progress) * 100.0 / max(u_p0, 1.0), 0.0, 1.0), color.a);`,
    ffmpeg: (p) => `fade=t=out:d=${((p.duration ?? 20) / 30).toFixed(2)}`,
  },

  /* ---------------- color ---------------- */
  {
    id: 'black-white',
    name: 'Black & white',
    category: 'color',
    swatch: ['#111111', '#e8e8e8'],
    params: [amount(100)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color = vec4(mix(color.rgb, vec3(l), u_p0 / 100.0), color.a);`,
    ffmpeg: (p) => `colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3,eq=saturation=${(1 - n(p, 'amount', 100)).toFixed(2)}`,
  },
  {
    id: 'sepia',
    name: 'Sepia',
    category: 'color',
    swatch: ['#3a2c1c', '#c9a877'],
    params: [amount(100)],
    glsl: `
      vec3 s = vec3(
        dot(color.rgb, vec3(0.393, 0.769, 0.189)),
        dot(color.rgb, vec3(0.349, 0.686, 0.168)),
        dot(color.rgb, vec3(0.272, 0.534, 0.131)));
      color = vec4(mix(color.rgb, s, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`,
  },
  {
    id: 'duotone',
    name: 'Duotone',
    category: 'color',
    swatch: ['#12233a', '#00e676'],
    params: [amount(100), { key: 'hue', label: 'Hue', min: 0, max: 360, step: 1, default: 150, unit: '°' }],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float h = u_p1 / 360.0;
      vec3 lo = vec3(0.05, 0.08, 0.15);
      vec3 hi = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      color = vec4(mix(color.rgb, mix(lo, hi, l), u_p0 / 100.0), color.a);`,
    ffmpeg: () => `format=gray,colorchannelmixer=.1:.1:.1:0:.55:.85:.45:0:.35:.35:.6`,
  },
  { id: 'infrared', name: 'Infrared', category: 'color', swatch: ['#3d0a2a', '#ff5fa2'], params: [amount(80)],
    glsl: `
      vec3 ir = vec3(color.g * 1.2, color.b * 0.6, color.r * 1.1);
      color = vec4(mix(color.rgb, ir, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `colorchannelmixer=0:1.2:0:0:0:0:0.6:0:1.1:0:0` },
  { id: 'bleach-bypass', name: 'Bleach bypass', category: 'color', swatch: ['#3a3a34', '#d8d6c8'], params: [amount(70)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 b = mix(color.rgb, vec3(l), 0.6) * 1.15 - 0.05;
      color = vec4(mix(color.rgb, b, u_p0 / 100.0), color.a);`,
    ffmpeg: (p) => `eq=saturation=${(1 - n(p, 'amount', 70) * 0.6).toFixed(2)}:contrast=${(1 + n(p, 'amount', 70) * 0.5).toFixed(2)}` },
  { id: 'cross-process', name: 'Cross process', category: 'color', swatch: ['#1f3a2c', '#c8d84a'], params: [amount(60)],
    glsl: `
      vec3 x = vec3(pow(color.r, 1.25), pow(color.g, 0.85), pow(color.b, 1.4));
      color = vec4(mix(color.rgb, x, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `curves=r='0/0 0.5/0.42 1/1':g='0/0.05 0.5/0.55 1/1':b='0/0.1 0.5/0.5 1/0.9'` },
  { id: 'faded-matte', name: 'Faded matte', category: 'color', swatch: ['#3b3b3f', '#c9c4bb'], params: [amount(55)],
    glsl: `color = vec4(mix(color.rgb, color.rgb * 0.85 + 0.12, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `curves=all='0/0.09 1/0.93',eq=saturation=0.85` },
  { id: 'vintage', name: 'Vintage', category: 'color', swatch: ['#4a3520', '#d9b98a'], params: [amount(70)],
    glsl: `
      vec3 v = color.rgb * vec3(1.08, 0.98, 0.82) + vec3(0.04, 0.02, 0.0);
      color = vec4(mix(color.rgb, v, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `curves=all='0/0.06 1/0.95',eq=saturation=0.8:gamma_r=1.06:gamma_b=0.94` },
  { id: 'warm', name: 'Warm', category: 'color', swatch: ['#3d2a18', '#ffb765'], params: [amount(50)],
    glsl: `color = vec4(color.rgb + vec3(0.06, 0.015, -0.05) * u_p0 / 50.0, color.a);`,
    ffmpeg: (p) => `colortemperature=temperature=${Math.round(6500 - n(p, 'amount', 50) * 2200)}` },
  { id: 'cool', name: 'Cool', category: 'color', swatch: ['#16283d', '#7fc4ff'], params: [amount(50)],
    glsl: `color = vec4(color.rgb + vec3(-0.05, 0.0, 0.07) * u_p0 / 50.0, color.a);`,
    ffmpeg: (p) => `colortemperature=temperature=${Math.round(6500 + n(p, 'amount', 50) * 3500)}` },
  { id: 'vivid', name: 'Vivid', category: 'color', swatch: ['#2a1440', '#ff3ea5'], params: [amount(60)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color = vec4(mix(vec3(l), color.rgb, 1.0 + u_p0 / 100.0), color.a);`,
    ffmpeg: (p) => `eq=saturation=${(1 + n(p, 'amount', 60)).toFixed(2)}:contrast=${(1 + n(p, 'amount', 60) * 0.3).toFixed(2)}` },
  { id: 'cinematic', name: 'Cinematic', category: 'color', swatch: ['#0d2030', '#e0a070'], params: [amount(65)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 teal = vec3(0.0, 0.42, 0.46);
      vec3 orange = vec3(1.0, 0.62, 0.28);
      vec3 grade = mix(mix(color.rgb, teal, 0.28), mix(color.rgb, orange, 0.22), l);
      color = vec4(mix(color.rgb, grade, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `curves=b='0/0.08 0.5/0.5 1/0.92':r='0/0 0.5/0.53 1/1',eq=contrast=1.12:saturation=1.08` },

  /* ---------------- glitch ---------------- */
  { id: 'rgb-split', name: 'RGB split', category: 'glitch', swatch: ['#ff2d55', '#00e0ff'], params: [{ key: 'offset', label: 'Offset', min: 0, max: 40, step: 0.5, default: 8, unit: 'px' }],
    glsl: `
      vec2 o = vec2(u_p0 / u_res.x, 0.0);
      color = vec4(texture2D(u_texture, uv + o).r, texture2D(u_texture, uv).g, texture2D(u_texture, uv - o).b, color.a);`,
    ffmpeg: (p) => `rgbashift=rh=${Math.round(p.offset ?? 8)}:bh=-${Math.round(p.offset ?? 8)}` },
  { id: 'vhs', name: 'VHS', category: 'glitch', swatch: ['#241a3a', '#b06cff'], params: [amount(60)],
    glsl: `
      float a = u_p0 / 100.0;
      float wob = sin(uv.y * 220.0 + u_time * 6.0) * 0.0018 * a;
      vec2 p = uv + vec2(wob, 0.0);
      vec3 c = vec3(texture2D(u_texture, p + vec2(0.0022 * a, 0.0)).r, texture2D(u_texture, p).g, texture2D(u_texture, p - vec2(0.0022 * a, 0.0)).b);
      c *= 0.92 + 0.08 * sin(uv.y * u_res.y * 1.6);
      color = vec4(c, color.a);`,
    ffmpeg: (p) => `rgbashift=rh=${Math.round(n(p, 'amount', 60) * 5)}:bh=-${Math.round(n(p, 'amount', 60) * 5)},noise=alls=12:allf=t,eq=saturation=1.2` },
  { id: 'scan-lines', name: 'Scan lines', category: 'glitch', swatch: ['#101418', '#3ad6a0'], params: [amount(50), { key: 'density', label: 'Density', min: 50, max: 800, step: 10, default: 300 }],
    glsl: `
      float s = 0.5 + 0.5 * sin(uv.y * u_p1);
      color = vec4(color.rgb * mix(1.0, s, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `geq=lum='p(X,Y)*(0.75+0.25*sin(Y*3.14159))':cb='p(X,Y)':cr='p(X,Y)'` },
  { id: 'pixel-sort', name: 'Pixel sort', category: 'glitch', swatch: ['#2a1030', '#ff8a3d'], params: [amount(45)],
    glsl: `
      float a = u_p0 / 100.0;
      float band = step(0.75 - a * 0.5, fract(sin(floor(uv.y * 90.0) * 91.7 + u_time) * 4375.85));
      vec2 p = vec2(mix(uv.x, floor(uv.x * 24.0) / 24.0, band), uv.y);
      color = texture2D(u_texture, p);`,
    ffmpeg: () => `noise=alls=20:allf=t,tmix=frames=2` },
  { id: 'digital-noise', name: 'Digital noise', category: 'glitch', swatch: ['#101010', '#00ff9d'], params: [amount(40)],
    glsl: `
      float r = fract(sin(dot(floor(uv * u_res / 3.0) + u_time, vec2(12.9898, 78.233))) * 43758.5453);
      color = vec4(mix(color.rgb, vec3(r), u_p0 / 200.0), color.a);`,
    ffmpeg: (p) => `noise=alls=${Math.round(n(p, 'amount', 40) * 80)}:allf=t+u` },
  { id: 'holographic', name: 'Holographic', category: 'glitch', swatch: ['#12143a', '#66f0ff'], params: [amount(55)],
    glsl: `
      float h = fract(uv.y * 3.0 + u_time * 0.15);
      vec3 rain = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      color = vec4(mix(color.rgb, color.rgb * rain * 1.6, u_p0 / 160.0), color.a);`,
    ffmpeg: () => `hue=H='2*PI*t/4',eq=saturation=1.5` },
  { id: 'crt', name: 'CRT monitor', category: 'glitch', swatch: ['#0a0f0a', '#5effa0'], params: [amount(60)],
    glsl: `
      vec2 c = uv * 2.0 - 1.0;
      c *= 1.0 + 0.06 * (u_p0 / 100.0) * dot(c, c);
      vec2 p = c * 0.5 + 0.5;
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { color = vec4(0.0, 0.0, 0.0, color.a); }
      else {
        vec3 s = texture2D(u_texture, p).rgb;
        s *= 0.85 + 0.15 * sin(p.y * u_res.y * 3.14159);
        color = vec4(s, color.a);
      }`,
    ffmpeg: () => `lenscorrection=k1=-0.08:k2=-0.02,geq=lum='p(X,Y)*(0.85+0.15*sin(Y*3.14159))':cb='p(X,Y)':cr='p(X,Y)'` },
  { id: 'signal-loss', name: 'Signal loss', category: 'glitch', swatch: ['#1a1a1a', '#dcdcdc'], params: [amount(50)],
    glsl: `
      float a = u_p0 / 100.0;
      float band = step(0.92 - a * 0.3, fract(sin(floor(uv.y * 40.0) * 27.3 + floor(u_time * 8.0)) * 4375.85));
      float shift = band * a * 0.08;
      vec3 c = texture2D(u_texture, uv + vec2(shift, 0.0)).rgb;
      float snow = fract(sin(dot(uv * u_res + u_time * 40.0, vec2(12.99, 78.23))) * 43758.55);
      color = vec4(mix(c, vec3(snow), band * a * 0.6), color.a);`,
    ffmpeg: () => `noise=alls=40:allf=t,rgbashift=rh=6:bh=-6` },

  /* ---------------- light ---------------- */
  { id: 'lens-flare', name: 'Lens flare', category: 'light', swatch: ['#2a1c05', '#ffd27f'], params: [amount(60), { key: 'x', label: 'Position X', min: 0, max: 100, step: 1, default: 30 }],
    glsl: `
      vec2 src = vec2(u_p1 / 100.0, 0.35);
      float d = distance(uv, src);
      float glow = exp(-d * 6.0) * u_p0 / 100.0;
      vec2 g = (uv - src) * -0.6 + src;
      float ghost = exp(-distance(uv, g) * 14.0) * u_p0 / 180.0;
      color = vec4(color.rgb + vec3(1.0, 0.86, 0.6) * glow + vec3(0.5, 0.8, 1.0) * ghost, color.a);`,
    ffmpeg: (p) => `colorlevels=rimin=-0.0${Math.round(n(p, 'amount', 60) * 6)}` },
  { id: 'anamorphic', name: 'Anamorphic streaks', category: 'light', swatch: ['#0a1830', '#5fa8ff'], params: [amount(60)],
    glsl: `
      vec4 sum = vec4(0.0);
      for (int i = -10; i <= 10; i++) {
        vec2 off = vec2(float(i) * 2.5 / u_res.x, 0.0);
        vec4 s = texture2D(u_texture, uv + off);
        float l = max(0.0, dot(s.rgb, vec3(0.3, 0.6, 0.1)) - 0.72);
        sum.rgb += vec3(0.3, 0.6, 1.0) * l * (1.0 - abs(float(i)) / 11.0);
      }
      color = vec4(color.rgb + sum.rgb * u_p0 / 100.0, color.a);`,
    ffmpeg: () => `split[a][b];[b]gblur=sigma=24:sigmaV=0,colorchannelmixer=.2:.2:.6[g];[a][g]blend=all_mode=screen` },
  { id: 'chromatic-aberration', name: 'Chromatic aberration', category: 'light', swatch: ['#1a1030', '#ff6ec7'], params: [amount(45)],
    glsl: `
      vec2 dir = uv - 0.5;
      float a = u_p0 / 3000.0;
      color = vec4(texture2D(u_texture, uv + dir * a).r, color.g, texture2D(u_texture, uv - dir * a).b, color.a);`,
    ffmpeg: (p) => `chromashift=cbh=${Math.round(n(p, 'amount', 45) * 8)}:crh=-${Math.round(n(p, 'amount', 45) * 8)}` },
  { id: 'lens-distortion', name: 'Lens distortion', category: 'light', swatch: ['#1c1c22', '#9aa4b8'], params: [{ key: 'k', label: 'Distortion', min: -60, max: 60, step: 1, default: 25 }],
    glsl: `
      vec2 c = uv * 2.0 - 1.0;
      c *= 1.0 + (u_p0 / 200.0) * dot(c, c);
      vec2 p = c * 0.5 + 0.5;
      color = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) ? vec4(0.0, 0.0, 0.0, color.a) : texture2D(u_texture, p);`,
    ffmpeg: (p) => `lenscorrection=k1=${((p.k ?? 25) / 200).toFixed(3)}:k2=0` },
  { id: 'prism', name: 'Prism', category: 'light', swatch: ['#101030', '#a0ffe0'], params: [amount(50)],
    glsl: `
      float a = u_p0 / 400.0;
      vec2 d = normalize(uv - 0.5 + 1e-5) * a;
      color = vec4(texture2D(u_texture, uv + d).r, texture2D(u_texture, uv).g, texture2D(u_texture, uv - d).b, color.a);`,
    ffmpeg: (p) => `rgbashift=rh=${Math.round(n(p, 'amount', 50) * 10)}:rv=2:bh=-${Math.round(n(p, 'amount', 50) * 10)}:bv=-2` },
  { id: 'light-leak', name: 'Light leak', category: 'light', swatch: ['#3a1010', '#ffb36b'], params: [amount(55)],
    glsl: `
      float leak = exp(-distance(uv, vec2(1.05, 0.1)) * 2.4);
      color = vec4(color.rgb + vec3(1.0, 0.55, 0.28) * leak * u_p0 / 100.0, color.a);`,
    ffmpeg: (p) => `colorlevels=romin=0.0${Math.round(n(p, 'amount', 55) * 8)}:gomin=0.0${Math.round(n(p, 'amount', 55) * 3)}` },
  { id: 'bokeh', name: 'Bokeh', category: 'light', swatch: ['#101822', '#ffe9a8'], params: [amount(55), { key: 'radius', label: 'Radius', min: 1, max: 30, step: 0.5, default: 10 }],
    glsl: `
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 16; i++) {
        float a = float(i) / 16.0 * 6.2831853;
        vec2 off = vec2(cos(a), sin(a)) * u_p1 / u_res;
        vec3 s = texture2D(u_texture, uv + off).rgb;
        float w = 1.0 + pow(max(0.0, dot(s, vec3(0.3, 0.6, 0.1)) - 0.7) * 8.0, 2.0);
        sum += s * w;
        total += w;
      }
      color = vec4(mix(color.rgb, sum / total, u_p0 / 100.0), color.a);`,
    ffmpeg: (p) => `gblur=sigma=${(p.radius ?? 10).toFixed(1)}` },
  { id: 'glow', name: 'Glow', category: 'light', swatch: ['#12241c', '#7dffc0'], params: [amount(55)],
    glsl: `
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) / 12.0 * 6.2831853;
        vec2 off = vec2(cos(a), sin(a)) * 6.0 / u_res;
        vec3 s = texture2D(u_texture, uv + off).rgb;
        sum += max(vec3(0.0), s - 0.62);
      }
      color = vec4(color.rgb + sum / 12.0 * u_p0 / 25.0, color.a);`,
    ffmpeg: () => `split[a][b];[b]gblur=sigma=14[g];[a][g]blend=all_mode=screen:all_opacity=0.55` },

  /* ---------------- distortion ---------------- */
  { id: 'wave', name: 'Wave', category: 'distortion', swatch: ['#10222a', '#63d8ff'], params: [amount(40), { key: 'freq', label: 'Frequency', min: 1, max: 60, step: 1, default: 14 }],
    glsl: `
      vec2 p = uv + vec2(sin(uv.y * u_p1 + u_time * 2.0) * u_p0 / 2000.0, 0.0);
      color = texture2D(u_texture, p);`,
    ffmpeg: () => `geq=lum='p(X+8*sin(Y/12+T*2),Y)':cb='p(X,Y)':cr='p(X,Y)'` },
  { id: 'bulge', name: 'Bulge', category: 'distortion', swatch: ['#1c1424', '#c98cff'], params: [{ key: 'strength', label: 'Strength', min: -100, max: 100, step: 1, default: 45 }],
    glsl: `
      vec2 c = uv - 0.5;
      float r = length(c);
      float f = 1.0 + (u_p0 / 100.0) * (1.0 - smoothstep(0.0, 0.55, r)) * 0.6;
      color = texture2D(u_texture, clamp(c / f + 0.5, 0.0, 1.0));`,
    ffmpeg: (p) => `lenscorrection=k1=${(-(p.strength ?? 45) / 300).toFixed(3)}` },
  { id: 'fisheye', name: 'Fisheye', category: 'distortion', swatch: ['#141c24', '#7fd0ff'], params: [amount(60)],
    glsl: `
      vec2 c = uv * 2.0 - 1.0;
      float r = length(c);
      float t = atan(r * (1.0 + u_p0 / 100.0));
      vec2 p = (r > 0.0 ? c / r * t / 1.2 : c) * 0.5 + 0.5;
      color = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) ? vec4(0.0, 0.0, 0.0, color.a) : texture2D(u_texture, p);`,
    ffmpeg: (p) => `lenscorrection=k1=${(n(p, 'amount', 60) * 0.4).toFixed(3)}:k2=0.05` },
  { id: 'kaleidoscope', name: 'Kaleidoscope', category: 'distortion', swatch: ['#241030', '#ff9de0'], params: [{ key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, default: 6 }],
    glsl: `
      vec2 c = uv - 0.5;
      float a = atan(c.y, c.x);
      float r = length(c);
      float seg = 6.2831853 / u_p0;
      a = abs(mod(a, seg) - seg * 0.5);
      color = texture2D(u_texture, vec2(cos(a), sin(a)) * r + 0.5);`,
    // No kaleidoscope filter in this build, and geq cannot express the polar
    // fold. Preview-only: export reports it as skipped rather than silently
    // dropping it.
    ffmpeg: null },
  { id: 'shockwave', name: 'Shockwave', category: 'distortion', swatch: ['#101828', '#8fd3ff'], params: [amount(60)],
    glsl: `
      float r = distance(uv, vec2(0.5));
      float w = sin((r - u_progress) * 40.0) * exp(-abs(r - u_progress) * 18.0) * u_p0 / 1200.0;
      color = texture2D(u_texture, uv + normalize(uv - 0.5 + 1e-5) * w);`,
    ffmpeg: () => `geq=lum='p(X+4*sin(hypot(X-W/2,Y-H/2)/6-T*10),Y)':cb='p(X,Y)':cr='p(X,Y)'` },
  { id: 'liquify', name: 'Liquify', category: 'distortion', swatch: ['#122024', '#66e0c0'], params: [amount(45)],
    glsl: `
      vec2 p = uv + vec2(
        sin(uv.y * 9.0 + u_time) * 0.5 + sin(uv.y * 21.0 - u_time * 1.7) * 0.5,
        cos(uv.x * 11.0 - u_time * 1.3) * 0.5) * u_p0 / 2400.0;
      color = texture2D(u_texture, p);`,
    ffmpeg: () => `geq=lum='p(X+6*sin(Y/9+T),Y+6*cos(X/11-T))':cb='p(X,Y)':cr='p(X,Y)'` },

  /* ---------------- style ---------------- */
  { id: 'oil-paint', name: 'Oil paint', category: 'style', swatch: ['#2c2210', '#e0b05a'], params: [{ key: 'radius', label: 'Radius', min: 1, max: 8, step: 1, default: 3 }],
    glsl: `
      // Kuwahara: pick the quadrant with lowest variance, giving painterly flats.
      vec3 best = color.rgb;
      float bestVar = 1e9;
      for (int q = 0; q < 4; q++) {
        vec2 dir = vec2(q == 0 || q == 3 ? 1.0 : -1.0, q < 2 ? 1.0 : -1.0);
        vec3 sum = vec3(0.0); vec3 sum2 = vec3(0.0); float cnt = 0.0;
        for (int i = 0; i <= 4; i++) {
          for (int j = 0; j <= 4; j++) {
            if (float(i) > u_p0 || float(j) > u_p0) continue;
            vec3 s = texture2D(u_texture, uv + dir * vec2(float(i), float(j)) / u_res).rgb;
            sum += s; sum2 += s * s; cnt += 1.0;
          }
        }
        vec3 mean = sum / cnt;
        vec3 vr = sum2 / cnt - mean * mean;
        float v = vr.r + vr.g + vr.b;
        if (v < bestVar) { bestVar = v; best = mean; }
      }
      color = vec4(best, color.a);`,
    // kuwahara is not in this ffmpeg build. smartblur flattens gradients while
    // keeping edges, which is the painterly quality that matters here.
    ffmpeg: (p) => `smartblur=luma_radius=${(1 + (p.radius ?? 3) * 0.6).toFixed(2)}:luma_strength=1:luma_threshold=-30,eq=saturation=1.15` },
  { id: 'watercolor', name: 'Watercolor', category: 'style', swatch: ['#1c2a30', '#a8dcd0'], params: [amount(60)],
    glsl: `
      vec3 q = floor(texture2D(u_texture, uv).rgb * 7.0 + 0.5) / 7.0;
      vec3 blur = (
        texture2D(u_texture, uv + vec2(2.0, 0.0) / u_res).rgb +
        texture2D(u_texture, uv - vec2(2.0, 0.0) / u_res).rgb +
        texture2D(u_texture, uv + vec2(0.0, 2.0) / u_res).rgb +
        texture2D(u_texture, uv - vec2(0.0, 2.0) / u_res).rgb) * 0.25;
      color = vec4(mix(color.rgb, mix(q, blur, 0.35), u_p0 / 100.0), color.a);`,
    ffmpeg: () => `smartblur=luma_radius=3:luma_strength=1:luma_threshold=-30,gblur=sigma=1.2,eq=saturation=1.2` },
  { id: 'sketch', name: 'Sketch', category: 'style', swatch: ['#f2f0ec', '#2a2a2a'], params: [amount(70)],
    glsl: `
      vec2 px = 1.0 / u_res;
      float l = dot(texture2D(u_texture, uv).rgb, vec3(0.299, 0.587, 0.114));
      float lx = dot(texture2D(u_texture, uv + vec2(px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float ly = dot(texture2D(u_texture, uv + vec2(0.0, px.y)).rgb, vec3(0.299, 0.587, 0.114));
      float edge = 1.0 - clamp(length(vec2(l - lx, l - ly)) * 14.0, 0.0, 1.0);
      color = vec4(mix(color.rgb, vec3(edge), u_p0 / 100.0), color.a);`,
    ffmpeg: () => `format=gray,edgedetect=low=0.1:high=0.3,negate` },
  { id: 'halftone', name: 'Comic halftone', category: 'style', swatch: ['#1a1a1a', '#ffd93d'], params: [{ key: 'size', label: 'Dot size', min: 2, max: 24, step: 1, default: 7 }],
    glsl: `
      vec2 grid = u_res / u_p0;
      vec2 cell = floor(uv * grid) / grid + 0.5 / grid;
      float l = dot(texture2D(u_texture, cell).rgb, vec3(0.299, 0.587, 0.114));
      float d = distance(fract(uv * grid), vec2(0.5));
      float dot_ = step(d, sqrt(1.0 - l) * 0.62);
      color = vec4(mix(texture2D(u_texture, cell).rgb, vec3(0.05), dot_), color.a);`,
    ffmpeg: () => `format=gray,eq=contrast=1.8,noise=alls=8` },
  { id: 'neon-glow', name: 'Neon glow', category: 'style', swatch: ['#0d0a20', '#00ffd0'], params: [amount(70)],
    glsl: `
      vec2 px = 1.0 / u_res;
      float l = dot(texture2D(u_texture, uv).rgb, vec3(0.299, 0.587, 0.114));
      float lx = dot(texture2D(u_texture, uv + vec2(px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
      float ly = dot(texture2D(u_texture, uv + vec2(0.0, px.y)).rgb, vec3(0.299, 0.587, 0.114));
      float edge = clamp(length(vec2(l - lx, l - ly)) * 18.0, 0.0, 1.0);
      vec3 neon = mix(vec3(0.0, 1.0, 0.55), vec3(0.4, 0.2, 1.0), uv.y) * edge;
      color = vec4(mix(color.rgb * 0.3, color.rgb * 0.3 + neon, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `edgedetect=mode=colormix:high=0.2,eq=saturation=2:brightness=0.05` },
  { id: 'thermal', name: 'Thermal', category: 'style', swatch: ['#100030', '#ff3300'], params: [amount(100)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 t = clamp(vec3(l * 3.0 - 1.2, l * 3.0 - 0.4, 1.6 - l * 3.0), 0.0, 1.0);
      color = vec4(mix(color.rgb, t, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `format=gray,pseudocolor=preset=magma` },
  { id: 'night-vision', name: 'Night vision', category: 'style', swatch: ['#04140a', '#4bff6a'], params: [amount(100)],
    glsl: `
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float g = fract(sin(dot(uv * u_res + u_time, vec2(12.99, 78.23))) * 43758.55);
      vec3 nv = vec3(0.05, 1.0, 0.25) * (l * 1.3 + (g - 0.5) * 0.12);
      float vig = smoothstep(0.72, 0.3, distance(uv, vec2(0.5)));
      color = vec4(mix(color.rgb, nv * vig, u_p0 / 100.0), color.a);`,
    ffmpeg: () => `format=gray,colorchannelmixer=0:0:0:0:1.2:1.2:1.2:0:0.2:0.2:0.2,noise=alls=14:allf=t,vignette` },
  { id: 'tilt-shift', name: 'Tilt shift', category: 'style', swatch: ['#1a2430', '#9fd6ff'], params: [amount(70), { key: 'band', label: 'Focus band', min: 5, max: 80, step: 1, default: 28 }],
    glsl: `
      float d = abs(uv.y - 0.5) * 200.0 / u_p1;
      float blurAmt = clamp(d - 1.0, 0.0, 1.0) * u_p0 / 100.0;
      vec3 sum = vec3(0.0);
      for (int i = -4; i <= 4; i++) {
        for (int j = -4; j <= 4; j++) {
          sum += texture2D(u_texture, uv + vec2(float(i), float(j)) * 2.0 * blurAmt / u_res).rgb;
        }
      }
      color = vec4(mix(color.rgb, sum / 81.0, blurAmt), color.a);`,
    ffmpeg: () => `split[a][b];[b]gblur=sigma=8[bl];[a][bl]blend=all_expr='A*(1-clip(abs(Y-H/2)/(H/3),0,1))+B*clip(abs(Y-H/2)/(H/3),0,1)'` },
];

export const EFFECT_CATEGORIES: { id: EffectCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'color', label: 'Color' },
  { id: 'light', label: 'Light' },
  { id: 'distortion', label: 'Distortion' },
  { id: 'style', label: 'Style' },
];

export const effectById = (id: string): EffectDef | undefined => EFFECTS.find((e) => e.id === id);

export const defaultEffectParams = (def: EffectDef): Record<string, number> =>
  Object.fromEntries(def.params.map((p) => [p.key, p.default]));
