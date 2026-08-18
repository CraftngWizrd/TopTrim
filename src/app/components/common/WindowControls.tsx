import { useEffect, useState } from 'react';
import { usePlatform } from '../../hooks/usePlatform';

/**
 * Windows-style window controls: minimise / maximise / close, right-aligned,
 * full-height hit targets, red close.
 *
 * Sizing follows the Windows 11 title bar (46×32 per button) so the buttons sit
 * where the muscle memory expects and are as easy to hit as the real ones.
 */
export function WindowControls() {
  const platform = usePlatform();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void platform.isMaximized().then(setMaximized);
    return platform.onWindowState(({ maximized: m }) => setMaximized(m));
  }, [platform]);

  return (
    <div className="win-controls no-drag">
      <button className="win-btn" onClick={() => platform.minimize()} aria-label="Minimise" title="Minimise">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      <button
        className="win-btn"
        onClick={() => platform.maximize()}
        aria-label={maximized ? 'Restore' : 'Maximise'}
        title={maximized ? 'Restore down' : 'Maximise'}
      >
        {maximized ? (
          // Restore: the offset double-square Windows uses.
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>

      <button className="win-btn is-close" onClick={() => platform.close()} aria-label="Close" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
