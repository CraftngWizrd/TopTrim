import { useCallback, useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useEditorStore } from '../stores/editorStore';
import { TitleBar } from '../components/TitleBar';
import { AssetTabBar } from '../components/AssetTabBar';
import { AssetPanel } from '../components/asset/AssetPanel';
import { PreviewMonitor } from '../components/preview/PreviewMonitor';
import { PropertiesPanel } from '../components/properties/PropertiesPanel';
import { TimelineToolbar } from '../components/timeline/TimelineToolbar';
import { Timeline } from '../components/timeline/Timeline';
import { Divider } from '../components/common/Divider';
import { JobsOverlay } from '../components/common/JobsOverlay';
import { ExportModal } from '../components/export/ExportModal';
import { ShortcutsModal } from '../components/modals/ShortcutsModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { AboutModal } from '../components/modals/AboutModal';
import { KeyframeEditorModal } from '../components/properties/KeyframeEditorModal';
import { useAutoSave } from '../hooks/useAutoSave';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useStoryboardReporter } from '../hooks/useStoryboardReporter';
import { warmCapabilities } from '../../engine/ffmpegCapabilities';

export function EditorPage() {
  const leftPanelWidth = useUIStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const timelineHeight = useUIStore((s) => s.timelineHeight);
  const setLeftPanelWidth = useUIStore((s) => s.setLeftPanelWidth);
  const setRightPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const setTimelineHeight = useUIStore((s) => s.setTimelineHeight);
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);
  const fullscreenPreview = useUIStore((s) => s.fullscreenPreview);
  const meta = useEditorStore((s) => s.meta);

  useAutoSave();
  useKeyboardShortcuts();
  useStoryboardReporter();

  // Ask the ffmpeg core what filters it has, once, in the background. The AI
  // tab uses the answer to disable what this build cannot do instead of
  // starting a job that can never finish.
  useEffect(() => {
    warmCapabilities();
  }, []);

  const resizeLeft = useCallback((pos: number) => setLeftPanelWidth(pos), [setLeftPanelWidth]);
  const resizeRight = useCallback(
    (pos: number) => setRightPanelWidth(window.innerWidth - pos),
    [setRightPanelWidth]
  );
  const resizeTimeline = useCallback(
    (pos: number) => setTimelineHeight(window.innerHeight - pos),
    [setTimelineHeight]
  );

  useEffect(() => {
    if (!meta) useUIStore.getState().setRoute('home');
  }, [meta]);

  return (
    <div className={`editor${fullscreenPreview ? ' is-preview-full' : ''}`}>
      <TitleBar />

      {/* Full-width strip; the tabs themselves occupy only the left panel width. */}
      <div className="editor-tabrow">
        <div className="editor-tabrow-left" style={{ width: leftPanelWidth }}>
          <AssetTabBar />
        </div>
        {/*
          Not a drag region. This row belongs to the editor, not the title bar,
          and a draggable area swallows every pointer event inside it.
        */}
        <div className="editor-tabrow-rest" />
      </div>

      <div className="editor-body">
        <div className="editor-left" style={{ width: leftPanelWidth }}>
          <AssetPanel />
        </div>
        <Divider orientation="vertical" onResize={resizeLeft} />

        <div className="editor-center">
          <PreviewMonitor />
        </div>

        <Divider orientation="vertical" onResize={resizeRight} />
        <div className="editor-right" style={{ width: rightPanelWidth }}>
          <PropertiesPanel />
        </div>
      </div>

      <Divider orientation="horizontal" onResize={resizeTimeline} />
      <TimelineToolbar />
      <div className="editor-timeline" style={{ height: timelineHeight }}>
        <Timeline />
      </div>

      <JobsOverlay />

      {modal === 'export' && <ExportModal onClose={closeModal} />}
      {modal === 'shortcuts' && <ShortcutsModal onClose={closeModal} />}
      {modal === 'settings' && <SettingsModal onClose={closeModal} />}
      {modal === 'about' && <AboutModal onClose={closeModal} />}
      {modal === 'keyframes' && <KeyframeEditorModal onClose={closeModal} />}
    </div>
  );
}
