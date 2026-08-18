import { useId } from 'react';

/**
 * The TopTrim wordmark and logo mark.
 *
 * "Top" in muted grey, "Trim" in electric green — the same two-tone split as
 * the app icon, so the title bar and the taskbar read as one identity.
 *
 * Note the grey is `--text-secondary`, not a true dark grey: on a #111113
 * background an actually-dark grey drops below readable contrast. This keeps
 * the two-tone intent while staying legible.
 */
export function Wordmark({ size = 13, showMark = false }: { size?: number; showMark?: boolean }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      {showMark && <LogoMark size={size * 1.5} />}
      <span className="wordmark-top">Top</span>
      <span className="wordmark-trim">Trim</span>
    </span>
  );
}

/** The icon glyph: a play triangle sliced by a diagonal cut, halves slid apart. */
export function LogoMark({ size = 20, rounded = true }: { size?: number; rounded?: boolean }) {
  // clipPath ids are document-global. Two marks on one page with hardcoded ids
  // would have the first definition silently win for both.
  const uid = useId().replace(/:/g, '');
  const squircle = `wm-sq-${uid}`;
  const top = `wm-top-${uid}`;
  const bottom = `wm-bot-${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" className="logo-mark">
      <defs>
        <clipPath id={squircle}>
          <rect x="0" y="0" width="1024" height="1024" rx="232" ry="232" />
        </clipPath>
        <clipPath id={top}>
          <polygon points="-661,1060 1513,44 1513,-420 -661,-420" />
        </clipPath>
        <clipPath id={bottom}>
          <polygon points="-643,1100 1531,84 1531,1440 -643,1440" />
        </clipPath>
      </defs>
      <g clipPath={rounded ? `url(#${squircle})` : undefined}>
        {rounded && <rect width="1024" height="1024" fill="#111113" />}
        <g clipPath={`url(#${top})`}>
          <polygon
            points="235,182 235,842 835,512"
            fill="var(--accent)"
            stroke="var(--accent)"
            strokeWidth="34"
            strokeLinejoin="round"
            transform="translate(-10,-21)"
          />
        </g>
        <g clipPath={`url(#${bottom})`}>
          <polygon
            points="235,182 235,842 835,512"
            fill="#55555F"
            stroke="#55555F"
            strokeWidth="34"
            strokeLinejoin="round"
            transform="translate(10,21)"
          />
        </g>
      </g>
    </svg>
  );
}
