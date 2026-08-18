import { useEditorStore } from '../../stores/editorStore';
import { useUIStore, ZOOM_MAX, ZOOM_MIN } from '../../stores/uiStore';
import { useMediaImport } from '../../hooks/useMediaImport';
import { IconButton } from '../common/Controls';
import { Icon } from '../common/Icon';
import { playback } from '../../../engine/playback';

/** 30px strip above the tracks — Section 6.1. */
export function TimelineToolbar() {
  const editor = useEditorStore();
  const selection = useUIStore((s) => s.selection);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const select = useUIStore((s) => s.select);
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const snapEnabled = useUIStore((s) => s.snapEnabled);
  const magnetEnabled = useUIStore((s) => s.magnetEnabled);
  const linkEnabled = useUIStore((s) => s.linkEnabled);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const toggleMagnet = useUIStore((s) => s.toggleMagnet);
  const toggleLink = useUIStore((s) => s.toggleLink);
  const setAssetTab = useUIStore((s) => s.setAssetTab);
  const setPropertyTab = useUIStore((s) => s.setPropertyTab);
  const cropMode = useUIStore((s) => s.cropMode);
  const toggleCropMode = useUIStore((s) => s.toggleCropMode);
  const { pickAndImport } = useMediaImport();

  const frame = () => Math.round(playback.currentFrame);
  const has = selection.length > 0;
  const one = selection.length === 1 ? editor.state.clips[selection[0]] : null;

  const splitTargets = () => {
    if (has) return selection;
    const f = frame();
    return Object.values(editor.state.clips)
      .filter((c) => f > c.start && f < c.start + c.duration)
      .map((c) => c.id);
  };

  return (
    <div className="tl-toolbar">
      <div className="tl-tool-group">
        <button className="tl-add-btn" onClick={() => void pickAndImport()}>
          <Icon name="plus" size={13} />
          Add
        </button>
        <div className="tl-sep" />
        <IconButton icon="undo" title="Undo" shortcut="Ctrl+Z" disabled={!editor.canUndo()} onClick={editor.undo} />
        <IconButton icon="redo" title="Redo" shortcut="Ctrl+Shift+Z" disabled={!editor.canRedo()} onClick={editor.redo} />
        <div className="tl-sep" />
        <IconButton icon="split" title="Split at playhead" shortcut="Ctrl+B" onClick={() => editor.splitClips(splitTargets(), frame())} />
        <IconButton
          icon="trash"
          title="Delete"
          shortcut="Del"
          danger
          disabled={!has}
          onClick={() => {
            editor.deleteClips(selection);
            clearSelection();
          }}
        />
        <IconButton
          icon="freeze"
          title="Freeze frame"
          disabled={!one || one.kind !== 'video'}
          onClick={() => {
            if (!one) return;
            // A freeze is a 2-second still: split at the playhead, then pin the
            // right half's in-point and drop its speed to zero-motion.
            const created = editor.splitClips([one.id], frame());
            const target = created[0];
            if (!target) return;
            const inPoint = editor.state.clips[target]?.inPoint ?? 0;
            editor.commit('Freeze frame', (d) => {
              const c = d.clips[target];
              if (!c) return;
              c.duration = 60;
              c.inPoint = inPoint;
              c.speed = 0.0001;
              c.name = `${c.name} (freeze)`;
            });
            select([target]);
          }}
        />
        <IconButton
          icon="reverse"
          title="Reverse"
          disabled={!has}
          onClick={() =>
            editor.commit('Reverse', (d) => {
              for (const cid of selection) {
                const c = d.clips[cid];
                if (c) c.reversed = !c.reversed;
              }
            })
          }
        />
        <IconButton
          icon="mirror"
          title="Mirror horizontally"
          disabled={!has}
          onClick={() =>
            editor.commit('Mirror', (d) => {
              for (const cid of selection) {
                const c = d.clips[cid];
                if (c) c.transform.flipH = !c.transform.flipH;
              }
            })
          }
        />
        <IconButton
          icon="rotate"
          title="Rotate 90°"
          disabled={!has}
          onClick={() =>
            editor.commit('Rotate', (d) => {
              for (const cid of selection) {
                const c = d.clips[cid];
                if (c) c.transform.rotation = (c.transform.rotation + 90) % 360;
              }
            })
          }
        />
        <IconButton
          icon="crop"
          title={cropMode ? 'Exit crop mode' : 'Crop on canvas'}
          active={cropMode}
          disabled={!has}
          onClick={() => {
            setPropertyTab('basic');
            toggleCropMode();
          }}
        />
        <IconButton icon="captions" title="Captions" onClick={() => setAssetTab('captions')} />
        <div className="tl-sep" />
        <IconButton icon="speed" title="Speed" disabled={!has} onClick={() => setPropertyTab('speed')} />
        <IconButton icon="stabilize" title="Stabilise" disabled={!has} onClick={() => setPropertyTab('ai')} />
        <IconButton icon="reframe" title="Auto reframe" disabled={!has} onClick={() => setPropertyTab('ai')} />
      </div>

      <div className="tl-tool-group" style={{ marginLeft: 'auto' }}>
        <IconButton icon="mic" title="Record voiceover" onClick={() => setAssetTab('audio')} />
        <IconButton icon="magnet" title="Magnet" active={magnetEnabled} onClick={toggleMagnet} />
        <IconButton icon="grid" title="Snapping" shortcut="S" active={snapEnabled} onClick={toggleSnap} />
        <IconButton icon={linkEnabled ? 'link' : 'unlink'} title="Link audio to video" active={linkEnabled} onClick={toggleLink} />
        <div className="tl-sep" />
        <IconButton
          icon="fit"
          title="Fit to window"
          shortcut="Ctrl+Shift+F"
          onClick={() => window.dispatchEvent(new CustomEvent('toptrim:fit-timeline'))}
        />
        <IconButton icon="zoom-out" title="Zoom out" shortcut="Ctrl+-" onClick={() => setZoom(zoom * 0.8)} />
        <input
          className="tl-zoom-slider"
          type="range"
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
          aria-label="Timeline zoom"
        />
        <IconButton icon="zoom-in" title="Zoom in" shortcut="Ctrl+=" onClick={() => setZoom(zoom * 1.25)} />
      </div>
    </div>
  );
}
