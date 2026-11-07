import type { Score } from '@reprise/model';

import { layout, type LayoutOptions } from '../src/index';

interface Request {
  score: Score;
  options: LayoutOptions;
}

addEventListener('message', (event: MessageEvent<Request>) => {
  const { score, options } = event.data;
  postMessage({
    result: layout(score, options),
    document: typeof document,
    window: typeof window,
  });
});
