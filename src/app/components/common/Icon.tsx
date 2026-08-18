import { memo } from 'react';

/**
 * The whole icon set, hand-drawn on a 24×24 grid.
 * SVG only — no emoji anywhere in the UI, per the spec.
 */

const P = (d: string) => d;

const PATHS: Record<string, string | string[]> = {
  /* window */
  'win-minimize': 'M5 12h14',
  'win-maximize': 'M6 6h12v12H6z',
  'win-restore': ['M8 8V6h10v10h-2', 'M6 8h10v10H6z'],
  'win-close': ['M6 6l12 12', 'M18 6L6 18'],

  /* chevrons + arrows */
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'arrow-left': ['M19 12H5', 'M11 18l-6-6 6-6'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14', 'M6 13l6 6 6-6'],

  /* transport */
  play: 'M7 4.5l12 7.5-12 7.5z',
  pause: ['M8 5v14', 'M16 5v14'],
  'skip-start': ['M6 5v14', 'M19 5L9 12l10 7z'],
  'skip-end': ['M18 5v14', 'M5 5l10 7L5 19z'],
  rewind: ['M11 5L3 12l8 7z', 'M21 5l-8 7 8 7z'],
  forward: ['M3 5l8 7-8 7z', 'M13 5l8 7-8 7z'],
  'step-back': ['M8 5v14', 'M18 5l-8 7 8 7z'],
  'step-forward': ['M16 5v14', 'M6 5l8 7-8 7z'],

  /* audio */
  volume: ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 010 7', 'M19 6a8.5 8.5 0 010 12'],
  'volume-mute': ['M4 9v6h4l5 4V5L8 9z', 'M17 9l4 6', 'M21 9l-4 6'],
  music: ['M9 18V5l10-2v13', 'M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z', 'M19 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z'],
  mic: ['M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z', 'M5 11a7 7 0 0014 0', 'M12 18v3'],
  waveform: ['M3 12h2', 'M7 8v8', 'M11 5v14', 'M15 9v6', 'M19 11v2', 'M21 12h0'],

  /* view */
  fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  fit: ['M9 4H4v5', 'M15 4h5v5', 'M9 20H4v-5', 'M15 20h5v-5'],
  eye: ['M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],
  'eye-off': ['M4 4l16 16', 'M9.5 9.6A3 3 0 0012 15a3 3 0 002.4-1.2', 'M6.3 6.5C3.8 8.2 2 12 2 12s3.5 6.5 10 6.5c1.7 0 3.2-.4 4.5-1', 'M19.8 15.6C21.3 14.1 22 12 22 12s-3.5-6.5-10-6.5c-.8 0-1.6.1-2.3.3'],
  lock: ['M7 11V8a5 5 0 0110 0v3', 'M5 11h14v9H5z'],
  unlock: ['M7 11V8a5 5 0 019.6-2', 'M5 11h14v9H5z'],

  /* editing */
  plus: ['M12 5v14', 'M5 12h14'],
  minus: 'M5 12h14',
  x: ['M6 6l12 12', 'M18 6L6 18'],
  check: 'M4 12.5l5 5L20 6.5',
  search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  copy: ['M9 9h11v11H9z', 'M15 5H4v11h3'],
  duplicate: ['M9 9h11v11H9z', 'M15 5H4v11h3'],
  undo: ['M4 10h10a5 5 0 010 10h-6', 'M8 5l-4 5 4 5'],
  redo: ['M20 10H10a5 5 0 000 10h6', 'M16 5l4 5-4 5'],
  split: ['M12 3v18', 'M6 8l-3 4 3 4', 'M18 8l3 4-3 4'],
  freeze: ['M12 3v18', 'M4.5 7.5l15 9', 'M19.5 7.5l-15 9'],
  reverse: ['M20 8H8a4 4 0 000 8h2', 'M12 4l-4 4 4 4'],
  mirror: ['M12 3v18', 'M9 8L4 12l5 4z', 'M15 8l5 4-5 4z'],
  rotate: ['M20 12a8 8 0 11-2.3-5.7', 'M20 4v5h-5'],
  crop: ['M6 2v16h16', 'M2 6h16v16'],
  speed: ['M12 20a8 8 0 118-8', 'M12 12l5-3'],
  stabilize: ['M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z', 'M9.5 12l2 2 3.5-4'],
  reframe: ['M4 4h7v7H4z', 'M20 20v-6h-6', 'M13 11l7-7'],
  captions: ['M3 5h18v14H3z', 'M7 11h3', 'M14 11h3', 'M7 14.5h4', 'M14 14.5h3'],
  wand: ['M15 4l5 5', 'M4 20L16 8', 'M18 3v3', 'M21 6h-3', 'M6 3v3', 'M9 6H6'],
  sparkles: ['M12 3l1.7 4.8L18.5 9.5 13.7 11.2 12 16l-1.7-4.8L5.5 9.5l4.8-1.7z', 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  palette: ['M12 21a9 9 0 110-18c5 0 9 3.6 9 8 0 2.5-2 4-4.5 4H15a2 2 0 00-1.4 3.4A1.9 1.9 0 0112 21z', 'M7.5 12.5h.01', 'M9.5 8.5h.01', 'M14 7.5h.01', 'M17.5 10.5h.01'],
  sliders: ['M4 8h10', 'M18 8h2', 'M4 16h4', 'M12 16h8', 'M16 6v4', 'M8 14v4'],
  filter: ['M3 5h18l-7 8v6l-4 2v-8z'],
  transition: ['M4 5h7v14H4z', 'M20 5h-4v14h4', 'M13 12h4', 'M15 10l2 2-2 2'],
  effect: ['M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17l9 5 9-5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  magnet: ['M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z', 'M6 8h4', 'M14 8h4'],
  link: ['M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1', 'M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1'],
  unlink: ['M9 15l-1 1a4 4 0 01-5.7-5.7l2-2', 'M15 9l1-1a4 4 0 015.7 5.7l-2 2', 'M4 4l16 16'],
  'zoom-in': ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3', 'M8 11h6', 'M11 8v6'],
  'zoom-out': ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3', 'M8 11h6'],

  /* alignment */
  'align-left': ['M4 4v16', 'M8 9h9', 'M8 15h5'],
  'align-right': ['M20 4v16', 'M16 9H7', 'M16 15h-5'],
  'align-top': ['M4 4h16', 'M9 8v9', 'M15 8v5'],
  'align-bottom': ['M4 20h16', 'M9 16V7', 'M15 16v-5'],
  'align-center-h': ['M12 3v18', 'M6 9h12', 'M8 15h8'],
  'align-center-v': ['M3 12h18', 'M9 6v12', 'M15 8v8'],
  'flip-h': ['M12 3v18', 'M9 7L3 12l6 5z', 'M15 7l6 5-6 5z'],
  'flip-v': ['M3 12h18', 'M7 9l5-6 5 6z', 'M7 15l5 6 5-6z'],

  /* media types */
  video: ['M3 6h13v12H3z', 'M16 10l5-3v10l-5-3z'],
  film: ['M3 4h18v16H3z', 'M7 4v16', 'M17 4v16', 'M3 9h4', 'M3 15h4', 'M17 9h4', 'M17 15h4'],
  image: ['M3 4h18v16H3z', 'M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M21 15l-5-5-8 8'],
  type: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  star: 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z',
  folder: 'M3 6h6l2 2h10v11H3z',
  import: ['M12 3v11', 'M8 10l4 4 4-4', 'M4 19h16'],
  export: ['M12 15V4', 'M8 8l4-4 4 4', 'M4 19h16'],
  settings: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 14.5a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 01-4 0v-.1a1.7 1.7 0 00-3-1.2l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 010-4h.1A1.7 1.7 0 004.3 6l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V2a2 2 0 014 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9h.2a2 2 0 010 4h-.1a1.7 1.7 0 00-1.6 1.5z'],
  info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 8h.01'],
  keyboard: ['M2 6h20v12H2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  record: 'M12 19a7 7 0 100-14 7 7 0 000 14z',
  camera: ['M3 7h4l2-2h6l2 2h4v13H3z', 'M12 17a4 4 0 100-8 4 4 0 000 8z'],
  scissors: ['M6.5 8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', 'M6.5 20.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', 'M8.5 7l11 10', 'M8.5 17l11-10'],
  noise: ['M3 12h3l2-6 3 12 3-9 2 5h5'],
  save: ['M5 3h11l3 3v15H5z', 'M9 3v6h6V3', 'M8 14h8'],
};

const FILLED = new Set(['play', 'record', 'star', 'skip-start', 'skip-end', 'rewind', 'forward', 'step-back', 'step-forward', 'effect', 'win-maximize']);

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

export const Icon = memo(function Icon({ name, size = 16, className, strokeWidth = 1.6, style }: IconProps) {
  const raw = PATHS[name];
  if (!raw) return null;
  const paths = Array.isArray(raw) ? raw : [raw];

  // Filled glyphs use a single closed path; everything else is a stroke.
  const solid = FILLED.has(name);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={P(d)}
          fill={solid && i === 0 ? 'currentColor' : 'none'}
          stroke={solid && i === 0 ? 'none' : 'currentColor'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
});

/** Keyframe diamond — filled when a keyframe exists at the playhead. */
export const KeyframeDiamond = memo(function KeyframeDiamond({
  active,
  size = 10,
}: {
  active: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M5 0.6L9.4 5 5 9.4 0.6 5z"
        fill={active ? 'var(--keyframe)' : 'none'}
        stroke={active ? 'var(--keyframe)' : 'var(--text-tertiary)'}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
});

export const hasIcon = (name: string) => name in PATHS;
