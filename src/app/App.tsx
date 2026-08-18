import { useEffect } from 'react';
import { useUIStore } from './stores/uiStore';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { ContextMenu } from './components/common/ContextMenu';

export function App() {
  const route = useUIStore((s) => s.route);

  useEffect(() => {
    // The OS context menu never appears — every right-click is ours.
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', block);

    // Dropping a file anywhere outside a registered drop zone must not
    // navigate the window to that file.
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);

    return () => {
      document.removeEventListener('contextmenu', block);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  return (
    <>
      {route === 'home' ? <HomePage /> : <EditorPage />}
      <ContextMenu />
    </>
  );
}
