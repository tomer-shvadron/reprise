import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/app';
import { detectKeyboardPlatform } from '@/app/keyboard';
import { browserPlatform } from '@/platform/browser-platform';
import { useUiStore } from '@/state/ui';

import './index.css';

const root = document.querySelector('#root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App ui={useUiStore} platform={browserPlatform} keyboard={detectKeyboardPlatform()} />
  </StrictMode>,
);
