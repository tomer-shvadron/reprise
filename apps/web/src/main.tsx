import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/app';
import { detectKeyboardPlatform } from '@/app/keyboard';
import { createAppServices } from '@/app/services';
import { platform } from '@/platform/select-platform';
import { useUiStore } from '@/state/ui';

import './index.css';

const root = document.querySelector('#root');
if (!root) throw new Error('index.html has no #root element');

// Outside React, so StrictMode's double effects and re-renders never make a second AudioContext.
const services = createAppServices({ platform: platform(), ui: useUiStore });
import.meta.hot?.dispose(() => {
  services.dispose();
});

createRoot(root).render(
  <StrictMode>
    <App
      services={services}
      keyboard={detectKeyboardPlatform()}
      onMenuCommand={window.reprise?.onMenuCommand}
    />
  </StrictMode>,
);
