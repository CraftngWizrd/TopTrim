import { Modal } from '../common/Modal';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Playback',
    rows: [
      ['Play / pause', 'Space'],
      ['Rewind (shuttle)', 'J'],
      ['Pause', 'K'],
      ['Fast forward (shuttle)', 'L'],
      ['Frame back / forward', '← →'],
      ['10 frames back / forward', 'Shift+← →'],
      ['Go to start / end', 'Home / End'],
      ['Fullscreen preview', 'F'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Split at playhead', 'Ctrl+B'],
      ['Delete selected', 'Delete'],
      ['Ripple delete', 'Ctrl+Delete'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'],
      ['Select all', 'Ctrl+A'],
      ['Copy / paste', 'Ctrl+C / Ctrl+V'],
      ['Duplicate', 'Ctrl+D'],
      ['Add text', 'T'],
      ['Add marker', 'M'],
    ],
  },
  {
    title: 'Timeline',
    rows: [
      ['Toggle snapping', 'S'],
      ['Set loop in / out', 'I / O'],
      ['Zoom in / out', 'Ctrl+= / Ctrl+-'],
      ['Fit timeline', 'Ctrl+Shift+F'],
    ],
  },
  {
    title: 'Project',
    rows: [
      ['New project', 'Ctrl+N'],
      ['Open project', 'Ctrl+O'],
      ['Save', 'Ctrl+S'],
      ['Import media', 'Ctrl+I'],
      ['Export', 'Ctrl+E'],
    ],
  },
];

export function ShortcutsModal({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={560}>
      <div className="shortcut-grid">
        {GROUPS.map((g) => (
          <div key={g.title} className="shortcut-group">
            <div className="section-label">{g.title}</div>
            {g.rows.map(([label, keys]) => (
              <div key={label} className="shortcut-row">
                <span>{label}</span>
                <span className="mono shortcut-keys">{keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
