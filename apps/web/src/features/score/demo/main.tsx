// Must stay first: it configures zod before any module builds a schema.
import '@/zod-config';
import { createRoot } from 'react-dom/client';

import { initialTheme } from '@/state/theme';

import { EditDemo } from '@/features/editor/demo/edit-demo';

import { parseDemoParams } from './demo-params';
import { loadScore, ScoreDemo } from './score-demo';

import '@/index.css';

const root = document.querySelector('#root');
if (!root) throw new Error('dev/score.html has no #root element');

const params = parseDemoParams(window.location.search, initialTheme());
document.documentElement.dataset['theme'] = params.theme;

// No StrictMode: its double render and effect replay would double every measurement.
const reactRoot = createRoot(root);
if (new URLSearchParams(window.location.search).get('edit') === '1') {
  // `?edit=1`: the edit cursor and range over the same score and view, not the performance panel.
  void loadScore(params.fixture).then((score) => {
    reactRoot.render(<EditDemo score={score} mode={params.mode} notation={params.notation} />);
  });
} else {
  reactRoot.render(<ScoreDemo initial={params} />);
}
