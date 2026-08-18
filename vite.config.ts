import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

/**
 * Deliberately NOT cross-origin isolated.
 *
 * COOP: same-origin + COEP: require-corp is the usual way to unlock
 * SharedArrayBuffer, but on Windows it also kills the custom title bar — a
 * cross-origin-isolated document's draggable regions never reach the browser
 * process, so the window hit-tests as HTCLIENT and will not drag. The app gets
 * SharedArrayBuffer from an Electron command-line switch instead; see the note
 * in electron/main.ts.
 *
 * CORP stays, since it costs nothing and keeps media loads well-formed.
 */
const devHeaders = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Native + Electron-only modules must stay external.
              // ffmpeg-static resolves a path to a real binary on disk; bundling
              // it would break that resolution.
              external: ['electron', 'better-sqlite3', 'ffmpeg-static'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@platform': path.resolve(__dirname, 'src/platform'),
      '@engine': path.resolve(__dirname, 'src/engine'),
    },
  },

  // Web Workers use ESM so they can `import` @ffmpeg/ffmpeg and friends directly.
  worker: { format: 'es' },

  assetsInclude: ['**/*.wasm', '**/*.cube'],

  optimizeDeps: {
    // ffmpeg.wasm ships its own workers; pre-bundling breaks the worker URLs.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@ffmpeg/core-mt'],
  },

  server: {
    port: 5173,
    strictPort: true,
    headers: devHeaders,
  },

  preview: {
    port: 4173,
    headers: devHeaders,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
});
