import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUIStore, type ContextMenuEntry } from '../../stores/uiStore';

/**
 * The app's only context menu. `window.oncontextmenu` is suppressed globally in
 * App.tsx so the OS menu never appears — Section 15.
 */
export function ContextMenu() {
  const menu = useUIStore((s) => s.contextMenu);
  const close = useUIStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    // Flip against the viewport edges so the menu is never clipped.
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((item: ContextMenuEntry, i) =>
        'separator' in item && item.separator ? (
          <div key={i} className="context-sep" />
        ) : (
          <div
            key={i}
            role="menuitem"
            className={`context-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="context-shortcut">{item.shortcut}</span>}
          </div>
        )
      )}
    </div>
  );
}

/** Helper for wiring a right-click handler on any element. */
export function useContextMenu() {
  const open = useUIStore((s) => s.openContextMenu);
  return (items: ContextMenuEntry[]) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open(e.clientX, e.clientY, items);
  };
}
