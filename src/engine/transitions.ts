/**
 * Transition registry — Section 11.
 *
 * `glsl` is the body of a function with `a` (outgoing), `b` (incoming),
 * `uv`, and `t` (0..1) in scope; it assigns to `result`.
 * `xfade` is the ffmpeg equivalent used at export, and every transition has
 * one. The 3D set has no exact ffmpeg counterpart, so those name the closest
 * available motion (a cube slides, a door opens horizontally) rather than
 * falling back to a dissolve — exporting eleven different transitions as the
 * same cross-fade made them indistinguishable in the finished file.
 */

export type TransitionCategory = 'basic' | 'motion' | 'glitch' | 'cinematic' | '3d' | 'stylized';

export interface TransitionDef {
  id: string;
  name: string;
  category: TransitionCategory;
  glsl: string;
  /** ffmpeg `xfade=transition=` name, or null when only the shader can do it. */
  xfade: string | null;
  defaultFrames: number;
  swatch: [string, string];
}

const T = (
  id: string,
  name: string,
  category: TransitionCategory,
  xfade: string | null,
  glsl: string,
  swatch: [string, string] = ['#1a2a24', '#00e676'],
  defaultFrames = 20
): TransitionDef => ({ id, name, category, xfade, glsl, swatch, defaultFrames });

/* Reusable shader bodies. */
const slide = (dx: number, dy: number) => `
  vec2 d = vec2(${dx.toFixed(1)}, ${dy.toFixed(1)});
  vec4 fa = texture2D(u_a, uv - d * t);
  vec4 fb = texture2D(u_b, uv + d * (1.0 - t));
  vec2 pa = uv - d * t;
  result = (pa.x < 0.0 || pa.x > 1.0 || pa.y < 0.0 || pa.y > 1.0) ? fb : fa;`;

const push = (dx: number, dy: number) => `
  vec2 d = vec2(${dx.toFixed(1)}, ${dy.toFixed(1)});
  vec2 pa = uv + d * t;
  vec2 pb = uv + d * (t - 1.0);
  bool inA = pa.x >= 0.0 && pa.x <= 1.0 && pa.y >= 0.0 && pa.y <= 1.0;
  result = inA ? texture2D(u_a, pa) : texture2D(u_b, pb);`;

const wipe = (expr: string) => `
  float edge = ${expr};
  result = mix(a, b, smoothstep(edge - 0.03, edge + 0.03, 0.0) > 0.5 ? 1.0 : 0.0);`;

const wipeSmooth = (coord: string, invert = false) => `
  float p = ${invert ? `1.0 - ${coord}` : coord};
  result = mix(b, a, smoothstep(t - 0.08, t + 0.08, p));`;

export const TRANSITIONS: TransitionDef[] = [
  /* ---------------- basic ---------------- */
  T('cut', 'Cut', 'basic', 'fade', `result = t < 0.5 ? a : b;`, ['#151515', '#e8e8e8'], 1),
  T('fade-black', 'Fade to black', 'basic', 'fadeblack', `
    float k = abs(t - 0.5) * 2.0;
    result = vec4(mix(vec3(0.0), (t < 0.5 ? a : b).rgb, k), 1.0);`, ['#000000', '#888888']),
  T('fade-white', 'Fade to white', 'basic', 'fadewhite', `
    float k = abs(t - 0.5) * 2.0;
    result = vec4(mix(vec3(1.0), (t < 0.5 ? a : b).rgb, k), 1.0);`, ['#ffffff', '#999999']),
  T('dissolve', 'Dissolve', 'basic', 'dissolve', `
    float n = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    result = n < t ? b : a;`),
  T('flash', 'Flash', 'basic', 'fadewhite', `
    float k = 1.0 - abs(t - 0.5) * 2.0;
    result = vec4(mix(mix(a, b, step(0.5, t)).rgb + k * 1.4, vec3(1.0), k * 0.6), 1.0);`, ['#ffffff', '#ffe9a8'], 10),
  T('dip-color', 'Dip to color', 'basic', 'fadeblack', `
    float k = abs(t - 0.5) * 2.0;
    result = vec4(mix(vec3(0.0, 0.9, 0.46), (t < 0.5 ? a : b).rgb, k), 1.0);`, ['#00e676', '#004d28']),

  /* ---------------- motion ---------------- */
  T('slide-left', 'Slide left', 'motion', 'slideleft', slide(1, 0)),
  T('slide-right', 'Slide right', 'motion', 'slideright', slide(-1, 0)),
  T('slide-up', 'Slide up', 'motion', 'slideup', slide(0, 1)),
  T('slide-down', 'Slide down', 'motion', 'slidedown', slide(0, -1)),
  T('push-left', 'Push left', 'motion', 'coverleft', push(1, 0)),
  T('push-right', 'Push right', 'motion', 'coverright', push(-1, 0)),
  T('push-up', 'Push up', 'motion', 'coverup', push(0, 1)),
  T('push-down', 'Push down', 'motion', 'coverdown', push(0, -1)),
  T('wipe-left', 'Wipe left', 'motion', 'wipeleft', wipeSmooth('uv.x', true)),
  T('wipe-right', 'Wipe right', 'motion', 'wiperight', wipeSmooth('uv.x')),
  T('wipe-up', 'Wipe up', 'motion', 'wipeup', wipeSmooth('uv.y', true)),
  T('wipe-down', 'Wipe down', 'motion', 'wipedown', wipeSmooth('uv.y')),
  T('wipe-tl', 'Wipe top-left', 'motion', 'wipetl', wipeSmooth('(uv.x + uv.y) * 0.5')),
  T('wipe-tr', 'Wipe top-right', 'motion', 'wipetr', wipeSmooth('(1.0 - uv.x + uv.y) * 0.5')),
  T('wipe-bl', 'Wipe bottom-left', 'motion', 'wipebl', wipeSmooth('(uv.x + 1.0 - uv.y) * 0.5')),
  T('wipe-br', 'Wipe bottom-right', 'motion', 'wipebr', wipeSmooth('(2.0 - uv.x - uv.y) * 0.5')),
  T('zoom-in', 'Zoom in', 'motion', 'zoomin', `
    vec2 ca = (uv - 0.5) / (1.0 + t * 1.4) + 0.5;
    vec2 cb = (uv - 0.5) * (1.0 + (1.0 - t) * 0.6) + 0.5;
    result = mix(texture2D(u_a, ca), texture2D(u_b, cb), t);`),
  T('zoom-out', 'Zoom out', 'motion', 'circleclose', `
    vec2 ca = (uv - 0.5) * (1.0 + t * 0.9) + 0.5;
    vec2 cb = (uv - 0.5) / (1.0 + (1.0 - t) * 1.4) + 0.5;
    result = mix(texture2D(u_a, ca), texture2D(u_b, cb), t);`),
  T('rotate', 'Rotate', 'motion', 'radial', `
    float ang = t * 3.14159;
    vec2 c = uv - 0.5;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    result = mix(texture2D(u_a, R * c + 0.5), texture2D(u_b, R * c + 0.5), t);`),
  T('flip', 'Flip', 'motion', 'vertopen', `
    float s = cos(t * 3.14159);
    vec2 p = vec2((uv.x - 0.5) / max(abs(s), 0.02) + 0.5, uv.y);
    result = (p.x < 0.0 || p.x > 1.0) ? vec4(0.0, 0.0, 0.0, 1.0) : (s > 0.0 ? texture2D(u_a, p) : texture2D(u_b, p));`),
  T('roll', 'Roll', 'motion', 'slideup', `
    vec2 p = vec2(uv.x, fract(uv.y + t));
    result = mix(texture2D(u_a, p), texture2D(u_b, p), step(1.0 - t, uv.y));`),
  T('squeeze', 'Squeeze', 'motion', 'squeezeh', `
    vec2 pa = vec2((uv.x - 0.5) / max(1.0 - t, 0.02) + 0.5, uv.y);
    vec2 pb = vec2((uv.x - 0.5) / max(t, 0.02) + 0.5, uv.y);
    bool inA = pa.x >= 0.0 && pa.x <= 1.0;
    result = inA ? texture2D(u_a, pa) : (pb.x >= 0.0 && pb.x <= 1.0 ? texture2D(u_b, pb) : vec4(0.0, 0.0, 0.0, 1.0));`),
  T('whip-pan', 'Whip pan', 'motion', 'hlwind', `
    float blur = sin(t * 3.14159) * 0.12;
    vec4 sa = vec4(0.0); vec4 sb = vec4(0.0);
    for (int i = 0; i < 8; i++) {
      float o = (float(i) / 7.0 - 0.5) * blur;
      sa += texture2D(u_a, vec2(uv.x + t + o, uv.y));
      sb += texture2D(u_b, vec2(uv.x + t - 1.0 + o, uv.y));
    }
    result = uv.x + t <= 1.0 ? sa / 8.0 : sb / 8.0;`, ['#1a1a20', '#c0c0d0'], 12),

  /* ---------------- glitch ---------------- */
  T('glitch-burst', 'Glitch burst', 'glitch', 'pixelize', `
    float k = sin(t * 3.14159);
    float band = step(0.7, fract(sin(floor(uv.y * 30.0) * 27.3 + floor(t * 20.0)) * 4375.85));
    vec2 o = vec2(band * k * 0.14, 0.0);
    result = mix(texture2D(u_a, uv + o), texture2D(u_b, uv - o), t);`, ['#2a0a2a', '#ff2d95'], 12),
  T('static', 'Static', 'glitch', 'dissolve', `
    float n = fract(sin(dot(uv * 300.0 + t * 50.0, vec2(12.99, 78.23))) * 43758.55);
    float k = sin(t * 3.14159);
    result = mix(mix(a, b, step(0.5, t)), vec4(vec3(n), 1.0), k);`, ['#101010', '#e0e0e0'], 12),
  T('signal-loss-t', 'Signal loss', 'glitch', 'fadegrays', `
    float k = sin(t * 3.14159);
    vec2 p = uv + vec2(sin(uv.y * 90.0 + t * 30.0) * k * 0.05, 0.0);
    result = mix(texture2D(u_a, p), texture2D(u_b, p), smoothstep(0.35, 0.65, t));`, ['#1a1a1a', '#9a9a9a'], 14),
  T('rgb-split-t', 'RGB split', 'glitch', 'hlslice', `
    float k = sin(t * 3.14159) * 0.06;
    vec4 fa = vec4(texture2D(u_a, uv + vec2(k, 0.0)).r, texture2D(u_a, uv).g, texture2D(u_a, uv - vec2(k, 0.0)).b, 1.0);
    vec4 fb = vec4(texture2D(u_b, uv + vec2(k, 0.0)).r, texture2D(u_b, uv).g, texture2D(u_b, uv - vec2(k, 0.0)).b, 1.0);
    result = mix(fa, fb, t);`, ['#ff2d55', '#00e0ff'], 12),
  T('pixel-sort-t', 'Pixel sort', 'glitch', 'vuslice', `
    float k = sin(t * 3.14159);
    float cells = mix(1.0, 60.0, 1.0 - k);
    vec2 p = floor(uv * cells) / cells;
    result = mix(texture2D(u_a, p), texture2D(u_b, p), t);`, ['#2a1030', '#ff8a3d'], 14),
  T('datamosh', 'Datamosh', 'glitch', 'distance', `
    float k = sin(t * 3.14159);
    vec2 flow = vec2(sin(uv.y * 12.0), cos(uv.x * 9.0)) * k * 0.06;
    result = mix(texture2D(u_a, uv + flow), texture2D(u_b, uv + flow), t);`, ['#160a2a', '#8f5cff'], 16),

  /* ---------------- cinematic ---------------- */
  T('film-burn', 'Film burn', 'cinematic', 'fadewhite', `
    float k = sin(t * 3.14159);
    float burn = smoothstep(0.35, 0.0, distance(uv, vec2(0.5 + sin(t * 4.0) * 0.1, 0.5))) * k;
    result = mix(mix(a, b, smoothstep(0.3, 0.7, t)), vec4(1.0, 0.75, 0.35, 1.0), burn);`, ['#3a1000', '#ffb060'], 18),
  T('light-leak-t', 'Light leak', 'cinematic', 'fadewhite', `
    float k = sin(t * 3.14159);
    float leak = exp(-distance(uv, vec2(1.1, 0.15)) * 2.0) * k * 2.2;
    result = mix(a, b, smoothstep(0.3, 0.7, t)) + vec4(1.0, 0.55, 0.3, 0.0) * leak;`, ['#3a1010', '#ffb36b'], 18),
  T('blur-wipe', 'Blur wipe', 'cinematic', 'hblur', `
    float k = sin(t * 3.14159) * 0.02;
    vec4 sa = vec4(0.0); vec4 sb = vec4(0.0);
    for (int i = 0; i < 6; i++) {
      vec2 o = vec2(float(i) - 2.5, 0.0) * k;
      sa += texture2D(u_a, uv + o); sb += texture2D(u_b, uv + o);
    }
    result = mix(sa / 6.0, sb / 6.0, t);`),
  T('radial-blur', 'Radial blur', 'cinematic', 'radial', `
    float k = sin(t * 3.14159) * 0.16;
    vec4 sa = vec4(0.0); vec4 sb = vec4(0.0);
    for (int i = 0; i < 8; i++) {
      float s = 1.0 + (float(i) / 7.0 - 0.5) * k;
      vec2 p = (uv - 0.5) * s + 0.5;
      sa += texture2D(u_a, p); sb += texture2D(u_b, p);
    }
    result = mix(sa / 8.0, sb / 8.0, t);`),
  T('spin-blur', 'Spin blur', 'cinematic', 'radial', `
    float k = sin(t * 3.14159) * 0.5;
    vec4 sa = vec4(0.0); vec4 sb = vec4(0.0);
    for (int i = 0; i < 8; i++) {
      float ang = (float(i) / 7.0 - 0.5) * k;
      mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 p = R * (uv - 0.5) + 0.5;
      sa += texture2D(u_a, p); sb += texture2D(u_b, p);
    }
    result = mix(sa / 8.0, sb / 8.0, t);`),
  T('iris-wipe', 'Iris wipe', 'cinematic', 'circleopen', `
    float r = distance(uv, vec2(0.5)) * 1.42;
    result = mix(b, a, smoothstep(t - 0.05, t + 0.05, r));`),
  T('radial-wipe', 'Radial wipe', 'cinematic', 'radial', `
    float ang = (atan(uv.y - 0.5, uv.x - 0.5) + 3.14159) / 6.28318;
    result = mix(b, a, smoothstep(t - 0.03, t + 0.03, ang));`),
  T('star-wipe', 'Star wipe', 'cinematic', 'circleopen', `
    vec2 c = uv - 0.5;
    float ang = atan(c.y, c.x);
    float r = length(c) / (0.42 + 0.18 * cos(ang * 5.0));
    result = mix(b, a, smoothstep(t * 1.5 - 0.05, t * 1.5 + 0.05, r));`),
  T('dream-blur', 'Dream blur', 'cinematic', 'fadegrays', `
    float k = sin(t * 3.14159) * 0.03;
    vec4 sa = vec4(0.0); vec4 sb = vec4(0.0);
    for (int i = 0; i < 6; i++) {
      float ang = float(i) / 6.0 * 6.28318;
      vec2 o = vec2(cos(ang), sin(ang)) * k;
      sa += texture2D(u_a, uv + o); sb += texture2D(u_b, uv + o);
    }
    result = mix(sa / 6.0, sb / 6.0, t) * (1.0 + sin(t * 3.14159) * 0.15);`, ['#2a2440', '#d8c8ff'], 24),

  /* ---------------- 3D ---------------- */
  T('cube', 'Cube rotation', '3d', 'slideleft', `
    float ang = t * 1.5708;
    float persp = 1.0 - t * 0.4;
    vec2 pa = vec2((uv.x - t) / max(1.0 - t, 0.02), (uv.y - 0.5) / persp + 0.5);
    vec2 pb = vec2((uv.x - t + 1.0) / max(t, 0.02) - (1.0 - t) / max(t, 0.02) + uv.x, uv.y);
    result = uv.x > t ? texture2D(u_a, vec2((uv.x - t) / max(1.0 - t, 0.02), uv.y))
                      : texture2D(u_b, vec2(uv.x / max(t, 0.02), uv.y));`, ['#141a24', '#6fa8ff'], 22),
  T('page-turn', 'Page turn', '3d', 'revealright', `
    float fold = t * 1.3;
    if (uv.x < fold - 0.15) { result = texture2D(u_b, uv); }
    else if (uv.x < fold) {
      float k = (fold - uv.x) / 0.15;
      vec2 p = vec2(fold + (fold - uv.x), uv.y + (uv.x - fold) * 0.1);
      result = texture2D(u_a, clamp(p, 0.0, 1.0)) * (1.0 - k * 0.55);
    } else { result = texture2D(u_a, uv); }`, ['#241c14', '#e0c69a'], 24),
  T('book-flip', 'Book flip', '3d', 'vertopen', `
    float s = cos(t * 3.14159);
    vec2 p = vec2(0.5 + (uv.x - 0.5) / max(abs(s), 0.04), uv.y);
    result = (p.x < 0.0 || p.x > 1.0) ? vec4(0.02, 0.02, 0.03, 1.0) : (s > 0.0 ? texture2D(u_a, p) : texture2D(u_b, p));`, ['#1a1410', '#c8a878'], 24),
  T('fold', 'Fold', '3d', 'squeezeh', `
    float f = t;
    vec2 p = vec2(uv.x, abs(fract(uv.y * (1.0 + f * 3.0)) - 0.5) * 2.0);
    result = mix(texture2D(u_a, mix(uv, p, f)), texture2D(u_b, uv), smoothstep(0.55, 1.0, t));`, ['#1c2028', '#9ab8d8'], 22),
  T('door-open', 'Door open', '3d', 'horzopen', `
    float half_ = 0.5;
    float open = t * 0.5;
    if (uv.x < half_) {
      vec2 p = vec2((uv.x + open) / max(half_, 0.02) * half_, uv.y);
      result = uv.x + open < half_ ? texture2D(u_a, p) : texture2D(u_b, uv);
    } else {
      vec2 p = vec2((uv.x - open), uv.y);
      result = uv.x - open > half_ ? texture2D(u_a, p) : texture2D(u_b, uv);
    }`, ['#20180f', '#d8b070'], 22),
  T('shatter', 'Shatter', '3d', 'pixelize', `
    vec2 cell = floor(uv * 12.0);
    float r = fract(sin(dot(cell, vec2(12.99, 78.23))) * 43758.55);
    float local = clamp((t - r * 0.4) / 0.6, 0.0, 1.0);
    vec2 dir = normalize(vec2(r - 0.5, fract(r * 7.0) - 0.5) + 1e-5);
    vec2 pa = uv + dir * local * 0.5;
    result = local >= 1.0 ? texture2D(u_b, uv)
      : ((pa.x < 0.0 || pa.x > 1.0 || pa.y < 0.0 || pa.y > 1.0) ? texture2D(u_b, uv) : mix(texture2D(u_a, pa), texture2D(u_b, uv), local));`, ['#1a1a20', '#c8d8e8'], 20),

  /* ---------------- stylized ---------------- */
  T('paint-brush', 'Paint brush', 'stylized', 'wiperight', `
    float edge = uv.x + sin(uv.y * 28.0) * 0.045 + sin(uv.y * 71.0) * 0.018;
    result = mix(b, a, smoothstep(t * 1.15 - 0.04, t * 1.15 + 0.04, edge));`, ['#241a10', '#e0a860'], 20),
  T('ink-spread', 'Ink spread', 'stylized', 'circleopen', `
    float n = fract(sin(dot(floor(uv * 40.0), vec2(12.99, 78.23))) * 43758.55);
    float r = distance(uv, vec2(0.5)) * 1.42 - n * 0.16;
    result = mix(b, a, smoothstep(t * 1.2 - 0.06, t * 1.2 + 0.06, r));`, ['#0a0a12', '#5a6a8a'], 20),
  T('paper-rip', 'Paper rip', 'stylized', 'wiperight', `
    float tear = uv.x + (fract(sin(floor(uv.y * 60.0) * 91.7) * 4375.85) - 0.5) * 0.07;
    result = mix(b, a, smoothstep(t * 1.1 - 0.015, t * 1.1 + 0.015, tear));`, ['#20201c', '#e8e4d8'], 16),
  T('grunge-wipe', 'Grunge wipe', 'stylized', 'dissolve', `
    float n = fract(sin(dot(floor(uv * 90.0), vec2(41.7, 17.3))) * 8375.13);
    result = (uv.x * 0.7 + n * 0.3) < t ? b : a;`, ['#1a1814', '#8a7c60'], 18),
  T('vhs-rewind', 'VHS rewind', 'stylized', 'hlwind', `
    float k = sin(t * 3.14159);
    float band = step(0.55, fract(uv.y * 14.0 + t * 6.0));
    vec2 o = vec2(band * k * 0.1 - k * 0.03, 0.0);
    result = mix(texture2D(u_a, uv + o), texture2D(u_b, uv + o), smoothstep(0.35, 0.65, t));`, ['#241a3a', '#b06cff'], 16),
];

export const TRANSITION_CATEGORIES: { id: TransitionCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'motion', label: 'Motion' },
  { id: 'glitch', label: 'Glitch' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: '3d', label: '3D' },
  { id: 'stylized', label: 'Stylized' },
];

export const transitionById = (id: string): TransitionDef | undefined => TRANSITIONS.find((t) => t.id === id);
