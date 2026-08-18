/**
 * Transitions, rendered live in the preview with CSS.
 *
 * Export composites transitions with ffmpeg, and the WebGL path uses the shader
 * carried by each definition. Neither can drive the preview, which is two
 * stacked <video> elements — so this maps a transition onto the properties
 * those elements can actually take: opacity, transform, clip-path, filter.
 *
 * That makes it an approximation, deliberately. Wipes, slides, pushes, irises
 * and dissolves come out exact. The 3D and stylised sets are suggested rather
 * than simulated, because a shader is the only honest way to draw them and
 * running one per frame would cost more than a preview is worth. What matters
 * is that each one reads as the right *kind* of transition at the right moment
 * — the export is the thing that has to be exact.
 *
 * `t` runs 0 -> 1 across the transition. The incoming clip is stacked above the
 * outgoing one, so most of these are expressed as "how the incoming clip is
 * revealed".
 */

export interface TransitionStyle {
  opacity: number;
  transform: string;
  clipPath: string;
  filter: string;
  /** Pivot for the transform. Hinged transitions rotate about an edge. */
  transformOrigin: string;
}

export interface TransitionPair {
  outgoing: TransitionStyle;
  incoming: TransitionStyle;
}

const NONE: TransitionStyle = { opacity: 1, transform: '', clipPath: '', filter: '', transformOrigin: 'center center' };
const style = (s: Partial<TransitionStyle>): TransitionStyle => ({ ...NONE, ...s });

/** Ease the raw progress so slides and wipes do not start and stop abruptly. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Triangle: 0 at both ends, 1 in the middle. Drives every "through" effect. */
const peak = (t: number) => 1 - Math.abs(t - 0.5) * 2;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const n = (v: number) => v.toFixed(3);

/** Incoming slides in from a direction; the outgoing clip stays put. */
const slideIn = (dx: number, dy: number, t: number): TransitionPair => {
  const e = 1 - ease(t);
  return { outgoing: NONE, incoming: style({ transform: `translate(${pct(dx * e)}, ${pct(dy * e)})` }) };
};

/** Both clips travel together, as though on a filmstrip. */
const pushIn = (dx: number, dy: number, t: number): TransitionPair => {
  const e = ease(t);
  return {
    outgoing: style({ transform: `translate(${pct(-dx * e)}, ${pct(-dy * e)})` }),
    incoming: style({ transform: `translate(${pct(dx * (1 - e))}, ${pct(dy * (1 - e))})` }),
  };
};

/** Incoming revealed by an edge sweeping across. `inset` order: top right bottom left. */
const wipeIn = (edge: 'left' | 'right' | 'up' | 'down', t: number): TransitionPair => {
  const open = pct(1 - ease(t));
  const inset =
    edge === 'left' ? `0 ${open} 0 0`
    : edge === 'right' ? `0 0 0 ${open}`
    : edge === 'up' ? `0 0 ${open} 0`
    : `${open} 0 0 0`;
  return { outgoing: NONE, incoming: style({ clipPath: `inset(${inset})` }) };
};

/** Diagonal reveal growing out of one corner. */
const wipeCorner = (corner: 'tl' | 'tr' | 'bl' | 'br', t: number): TransitionPair => {
  // 2x overshoot so the opposite corner is fully cleared by t=1.
  const e = ease(t) * 2;
  const a = pct(e);
  const b = pct(1 - e);
  const poly =
    corner === 'tl' ? `polygon(0 0, ${a} 0, 0 ${a})`
    : corner === 'tr' ? `polygon(100% 0, 100% ${a}, ${b} 0)`
    : corner === 'bl' ? `polygon(0 100%, ${a} 100%, 0 ${b})`
    : `polygon(100% 100%, ${b} 100%, 100% ${b})`;
  return { outgoing: NONE, incoming: style({ clipPath: poly }) };
};

/** Circular reveal. 78% radius clears the corners of a 16:9 frame. */
const irisIn = (t: number): TransitionPair => ({
  outgoing: NONE,
  incoming: style({ clipPath: `circle(${pct(ease(t) * 0.78)} at 50% 50%)` }),
});

/**
 * Through-colour transitions: the outgoing clip sinks into the colour over the
 * first half and the incoming clip rises out of it over the second. Done with
 * brightness, so no extra element is needed.
 */
const dipTo = (dir: 'black' | 'white', t: number): TransitionPair => {
  const k = peak(t);
  const b = dir === 'black' ? n(1 - k) : n(1 + k * 3);
  return {
    outgoing: style({ filter: `brightness(${b})` }),
    incoming: style({ opacity: t < 0.5 ? 0 : 1, filter: `brightness(${b})` }),
  };
};

/** Plain crossfade — also the fallback for anything only a shader can draw. */
const crossfade = (t: number): TransitionPair => ({ outgoing: NONE, incoming: style({ opacity: t }) });

export function transitionStyles(transitionId: string, tRaw: number): TransitionPair {
  const t = Math.max(0, Math.min(1, tRaw));
  const k = peak(t);

  switch (transitionId) {
    /* ---------------- basic ---------------- */
    case 'cut':
      return { outgoing: NONE, incoming: style({ opacity: t < 0.5 ? 0 : 1 }) };
    case 'dissolve':
      return crossfade(t);
    case 'fade-black':
    case 'dip-color':
      return dipTo('black', t);
    case 'fade-white':
      return dipTo('white', t);
    case 'flash': {
      const b = n(1 + k * 2.5);
      return {
        outgoing: style({ filter: `brightness(${b})` }),
        incoming: style({ opacity: t, filter: `brightness(${b})` }),
      };
    }

    /* ---------------- motion ---------------- */
    case 'slide-left': return slideIn(1, 0, t);
    case 'slide-right': return slideIn(-1, 0, t);
    case 'slide-up': return slideIn(0, 1, t);
    case 'slide-down': return slideIn(0, -1, t);
    case 'push-left': return pushIn(1, 0, t);
    case 'push-right': return pushIn(-1, 0, t);
    case 'push-up': return pushIn(0, 1, t);
    case 'push-down': return pushIn(0, -1, t);
    case 'roll': return pushIn(0, 1, t);
    case 'wipe-left': return wipeIn('left', t);
    case 'wipe-right': return wipeIn('right', t);
    case 'wipe-up': return wipeIn('up', t);
    case 'wipe-down': return wipeIn('down', t);
    case 'wipe-tl': return wipeCorner('tl', t);
    case 'wipe-tr': return wipeCorner('tr', t);
    case 'wipe-bl': return wipeCorner('bl', t);
    case 'wipe-br': return wipeCorner('br', t);

    case 'zoom-in':
      return {
        outgoing: style({ transform: `scale(${n(1 + ease(t) * 1.4)})`, filter: `blur(${(t * 3).toFixed(2)}px)` }),
        incoming: style({ opacity: t }),
      };
    case 'zoom-out':
      return {
        outgoing: style({ transform: `scale(${n(1 - ease(t) * 0.45)})` }),
        incoming: style({ opacity: t, transform: `scale(${n(1.5 - ease(t) * 0.5)})` }),
      };
    case 'rotate':
      return {
        outgoing: style({ transform: `rotate(${n(ease(t) * 45)}deg) scale(${n(1 - ease(t) * 0.3)})` }),
        incoming: style({ opacity: t, transform: `rotate(${n((1 - ease(t)) * -45)}deg)` }),
      };
    case 'squeeze':
      return {
        outgoing: style({ transform: `scaleX(${n(1 - ease(t))})` }),
        incoming: style({ opacity: t < 0.5 ? 0 : 1, transform: `scaleX(${n(ease(t))})` }),
      };
    case 'whip-pan':
    case 'vhs-rewind':
      // Motion blur peaking mid-swipe is what sells a whip.
      return {
        outgoing: style({ transform: `translateX(${pct(-ease(t))})`, filter: `blur(${(k * 14).toFixed(2)}px)` }),
        incoming: style({ transform: `translateX(${pct(1 - ease(t))})`, filter: `blur(${(k * 14).toFixed(2)}px)` }),
      };

    /* ---------------- cinematic ---------------- */
    case 'iris-wipe':
    case 'ink-spread':
    case 'star-wipe':
    case 'radial-wipe':
      return irisIn(t);
    case 'blur-wipe':
    case 'dream-blur':
      return {
        outgoing: style({ filter: `blur(${(k * 18).toFixed(2)}px)` }),
        incoming: style({ opacity: t, filter: `blur(${(k * 18).toFixed(2)}px)` }),
      };
    case 'radial-blur':
    case 'spin-blur':
      return {
        outgoing: style({
          transform: `rotate(${n(ease(t) * 25)}deg) scale(${n(1 + k * 0.2)})`,
          filter: `blur(${(k * 12).toFixed(2)}px)`,
        }),
        incoming: style({
          opacity: t,
          transform: `rotate(${n((1 - ease(t)) * -25)}deg)`,
          filter: `blur(${(k * 12).toFixed(2)}px)`,
        }),
      };
    case 'film-burn':
    case 'light-leak-t':
      return {
        outgoing: style({
          filter: `brightness(${n(1 + k * 1.8)}) sepia(${(k * 0.6).toFixed(2)}) saturate(${n(1 + k)})`,
        }),
        incoming: style({
          opacity: t,
          filter: `brightness(${n(1 + k * 1.8)}) sepia(${(k * 0.6).toFixed(2)})`,
        }),
      };

    /* ---------------- glitch ---------------- */
    case 'glitch-burst':
    case 'static':
    case 'signal-loss-t':
    case 'rgb-split-t':
    case 'pixel-sort-t':
    case 'datamosh': {
      // Jitter rather than a smooth blend, so it reads as broken signal.
      const jitter = Math.sin(t * 97) * k * 2.2;
      return {
        outgoing: style({
          transform: `translateX(${jitter.toFixed(2)}%)`,
          filter: `saturate(${n(1 + k * 2)}) contrast(${n(1 + k * 0.6)})`,
        }),
        incoming: style({
          opacity: t,
          transform: `translateX(${(-jitter).toFixed(2)}%)`,
          filter: `saturate(${n(1 + k * 2)})`,
        }),
      };
    }

    /* ---------------- 3d ----------------
     *
     * These hinge about an EDGE, not about the centre. Rotating both faces
     * around their own middle put them edge-on at the same instant, which
     * showed a blank frame halfway through instead of a cube — the two panels
     * have to pivot on the seam they share, so one is always facing the
     * viewer.
     */
    case 'cube': {
      const e = ease(t);
      return {
        outgoing: style({
          transform: `perspective(1400px) rotateY(${n(e * -90)}deg)`,
          transformOrigin: 'left center',
        }),
        incoming: style({
          transform: `perspective(1400px) rotateY(${n((1 - e) * 90)}deg)`,
          transformOrigin: 'right center',
        }),
      };
    }
    case 'door-open': {
      // Opens from the middle outwards, like ffmpeg's horzopen.
      const gap = (1 - ease(t)) * 50;
      return { outgoing: NONE, incoming: style({ clipPath: `inset(0 ${gap.toFixed(2)}% 0 ${gap.toFixed(2)}%)` }) };
    }
    case 'fold': {
      const e = ease(t);
      return {
        outgoing: style({ transform: `perspective(1400px) scaleX(${n(1 - e)})`, transformOrigin: 'left center' }),
        incoming: style({ transform: `perspective(1400px) scaleX(${n(e)})`, transformOrigin: 'right center' }),
      };
    }
    case 'page-turn':
    case 'book-flip': {
      // The outgoing page lifts off a spine, revealing the incoming one that
      // was underneath all along — so the incoming clip never hides.
      const e = ease(t);
      const spine = transitionId === 'page-turn' ? 'left center' : 'right center';
      const dir = transitionId === 'page-turn' ? -1 : 1;
      return {
        outgoing: style({
          transform: `perspective(1400px) rotateY(${n(e * 100 * dir)}deg)`,
          transformOrigin: spine,
          filter: `brightness(${n(1 - e * 0.35)})`,
        }),
        incoming: NONE,
      };
    }
    case 'flip': {
      // A genuine card flip: the card really is edge-on at the midpoint, so
      // the swap there is correct rather than a glitch.
      const e = ease(t);
      return {
        outgoing: style({ opacity: t < 0.5 ? 1 : 0, transform: `perspective(1400px) rotateX(${n(e * 90)}deg)` }),
        incoming: style({ opacity: t < 0.5 ? 0 : 1, transform: `perspective(1400px) rotateX(${n((1 - e) * -90)}deg)` }),
      };
    }
    case 'shatter':
      return {
        outgoing: style({
          opacity: 1 - ease(t),
          transform: `scale(${n(1 + ease(t) * 0.25)})`,
          filter: `contrast(${n(1 + ease(t))})`,
        }),
        incoming: style({ opacity: t }),
      };

    /* ---------------- stylized ---------------- */
    case 'paint-brush':
    case 'paper-rip':
      return wipeIn('left', t);
    case 'grunge-wipe':
      return crossfade(t);

    default:
      return crossfade(t);
  }
}
