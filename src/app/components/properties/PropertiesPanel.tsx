import { useEffect, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useUIStore } from '../../stores/uiStore';
import { playback } from '../../../engine/playback';
import { DetailsPanel } from './DetailsPanel';
import { ClipProperties } from './ClipProperties';

export function PropertiesPanel() {
  const selection = useUIStore((s) => s.selection);
  const clips = useEditorStore((s) => s.state.clips);
  const [frame, setFrame] = useState(0);

  // The panel follows the playhead when it settles; during playback it is
  // deliberately left alone so nothing re-renders.
  useEffect(() => playback.onFrame(setFrame), []);

  const selected = selection.length === 1 ? clips[selection[0]] : null;

  if (!selected) {
    return <DetailsPanel multiSelectCount={selection.length} />;
  }
  return <ClipProperties clip={selected} frame={frame} />;
}
