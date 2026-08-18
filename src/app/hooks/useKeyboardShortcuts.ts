import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { playback } from '../../engine/playback';
import { saveCurrentProject } from '../services/projects';
import type { Clip } from '../../types/project';

/** Section 17 — the full shortcut table. */

let clipboard: Clip[] = [];

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
};

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const ui = useUIStore.getState();
      const editor = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const sel = ui.selection;
      const frame = playback.currentFrame;

      // Modal open: only Escape and the modal's own keys matter.
      if (ui.modal && e.key !== 'Escape') return;

      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      /* ---- modified ---- */
      if (mod) {
        switch (e.key.toLowerCase()) {
          case 'z':
            stop();
            e.shiftKey ? editor.redo() : editor.undo();
            return;
          case 'y':
            stop();
            editor.redo();
            return;
          case 'b':
            stop();
            editor.splitClips(sel.length ? sel : clipsUnderPlayhead(frame), frame);
            return;
          case 'a':
            stop();
            ui.select(Object.keys(editor.state.clips));
            return;
          case 'c':
            stop();
            clipboard = sel.map((cid) => structuredClone(editor.state.clips[cid])).filter(Boolean);
            return;
          case 'v': {
            stop();
            if (clipboard.length === 0) return;
            const earliest = Math.min(...clipboard.map((c) => c.start));
            editor.commit('Paste', (d) => {
              for (const c of clipboard) {
                const copy = structuredClone(c);
                copy.id = `${c.id}-${Math.random().toString(36).slice(2, 8)}`;
                copy.start = frame + (c.start - earliest);
                copy.linkedClipId = undefined;
                d.clips[copy.id] = copy;
              }
            });
            return;
          }
          case 'd':
            stop();
            if (sel.length) ui.select(editor.duplicateClips(sel));
            return;
          case 's':
            stop();
            void saveCurrentProject();
            return;
          case 'e':
            stop();
            ui.openModal('export');
            return;
          case 'n':
            stop();
            void import('../services/projects').then((m) => m.newProject());
            return;
          case 'o':
            stop();
            void import('../services/projects').then((m) => m.closeToHome());
            return;
          case 'i': {
            stop();
            void importViaDialog();
            return;
          }
          case '=':
          case '+':
            stop();
            ui.zoomBy(1.25);
            return;
          case '-':
            stop();
            ui.zoomBy(0.8);
            return;
          case 'f':
            if (e.shiftKey) {
              stop();
              window.dispatchEvent(new CustomEvent('toptrim:fit-timeline'));
            }
            return;
          case 'delete':
          case 'backspace':
            stop();
            editor.deleteClips(sel, true);
            ui.clearSelection();
            return;
          default:
            return;
        }
      }

      /* ---- unmodified ---- */
      switch (e.key) {
        case ' ':
          stop();
          playback.resetRate();
          playback.toggle();
          return;
        case 'j':
        case 'J':
          stop();
          playback.shuttle(playback.shuttleRate < 0 ? Math.max(-8, playback.shuttleRate * 2) : -1);
          return;
        case 'k':
        case 'K':
          stop();
          playback.resetRate();
          playback.pause();
          return;
        case 'l':
        case 'L':
          stop();
          playback.shuttle(playback.shuttleRate > 0 ? Math.min(8, playback.shuttleRate * 2) : 1);
          return;
        case 'ArrowLeft':
          stop();
          playback.step(e.shiftKey ? -10 : -1);
          return;
        case 'ArrowRight':
          stop();
          playback.step(e.shiftKey ? 10 : 1);
          return;
        case 'Home':
          stop();
          playback.goToStart();
          return;
        case 'End':
          stop();
          playback.goToEnd();
          return;
        case 'Delete':
          stop();
          editor.deleteClips(sel);
          ui.clearSelection();
          return;
        case 'Backspace':
          stop();
          editor.deleteClips(sel);
          ui.clearSelection();
          return;
        case 's':
        case 'S':
          stop();
          ui.toggleSnap();
          return;
        case 'i':
        case 'I':
          stop();
          editor.setLoop(frame, Math.max(frame + 1, editor.state.loop.outFrame), true);
          return;
        case 'o':
        case 'O':
          stop();
          editor.setLoop(Math.min(editor.state.loop.inFrame, frame - 1), frame, true);
          return;
        case 'f':
        case 'F':
          stop();
          ui.toggleFullscreenPreview();
          return;
        case 't':
        case 'T':
          stop();
          ui.select([editor.addTextClip(frame) ?? '']);
          ui.setAssetTab('text');
          return;
        case 'm':
        case 'M':
          stop();
          editor.addMarker(frame);
          return;
        case '?':
          stop();
          ui.openModal('shortcuts');
          return;
        case 'Escape':
          stop();
          if (ui.modal) ui.closeModal();
          else if (ui.fullscreenPreview) ui.toggleFullscreenPreview();
          else ui.clearSelection();
          return;
        default:
          return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Releasing J or L returns to normal speed, as in every NLE.
      if ((e.key === 'j' || e.key === 'J' || e.key === 'l' || e.key === 'L') && !isTypingTarget(e.target)) {
        playback.resetRate();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}

function clipsUnderPlayhead(frame: number): string[] {
  const clips = useEditorStore.getState().state.clips;
  return Object.values(clips)
    .filter((c) => frame > c.start && frame < c.start + c.duration)
    .map((c) => c.id);
}

async function importViaDialog() {
  const { platform } = await import('./usePlatform');
  const { importFiles, MEDIA_ACCEPT } = await import('../../engine/media');
  const editor = useEditorStore.getState();
  const files = await platform.openFile({ accept: MEDIA_ACCEPT, multiple: true });
  if (files.length === 0) return;
  const { assets } = await importFiles(files, platform, editor.meta?.fps ?? 30);
  editor.addAssets(assets);
}
