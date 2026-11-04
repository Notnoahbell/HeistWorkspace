import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { bodies } from './board/body';
import { useBoard } from './board/store';
import { useUi } from './board/ui';
import { useLayout } from './board/layout';
import { installCursor } from './lib/cursor';
import { connect } from './sync/client';
import { usePresence } from './sync/presence';
import { camera } from './canvas/camera';
import { currentBoardId } from './board/nav';
import { registerMediaCache } from './lib/mediaCache';

// Handy for poking at state from the console while developing.
if (import.meta.env.DEV) Object.assign(window, { heist: { bodies, useBoard, useUi, useLayout, usePresence, camera, currentBoardId } });

installCursor();
connect();
registerMediaCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
