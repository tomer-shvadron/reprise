import { createRoot } from 'react-dom/client';

import { initialTheme } from '@/state/theme';

import { parseDemoParams } from './demo-params';
import { ScoreDemo } from './score-demo';

import '@/index.css';

const root = document.querySelector('#root');
if (!root) throw new Error('dev/score.html has no #root element');

const params = parseDemoParams(window.location.search, initialTheme());
document.documentElement.dataset['theme'] = params.theme;

// No StrictMode: its double render and effect replay would double every measurement.
createRoot(root).render(<ScoreDemo initial={params} />);
