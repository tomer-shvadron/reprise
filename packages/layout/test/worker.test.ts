/** Layout has no DOM dependency: it runs in a Web Worker and its result survives structured cloning. */
import { largeScore } from '@reprise/model/testing';
import { expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from '../src/index';
import { stable } from '../src/test/check-result';

interface Reply {
  result: LayoutResult;
  document: string;
  window: string;
}

const options: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

it('lays out in a Web Worker, with no document or window, as on the main thread', async () => {
  const score = largeScore(2, 16, { structure: true });
  const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
  try {
    const reply = await new Promise<Reply>((resolve, reject) => {
      worker.addEventListener('message', (event: MessageEvent<Reply>) => {
        resolve(event.data);
      });
      worker.addEventListener('error', (event) => {
        reject(new Error(event.message));
      });
      worker.postMessage({ score, options });
    });
    expect(reply.document).toBe('undefined');
    expect(reply.window).toBe('undefined');
    expect(stable(reply.result)).toBe(stable(layout(score, options)));
  } finally {
    worker.terminate();
  }
});
