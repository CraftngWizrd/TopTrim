import React from 'react';
import { createRoot } from 'react-dom/client';

// Outfit + DM Sans + JetBrains Mono only. No Inter anywhere.
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/cursors.css';
import './styles/layout.css';
import './styles/home.css';
import './styles/asset.css';
import './styles/preview.css';
import './styles/properties.css';
import './styles/timeline.css';

import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
