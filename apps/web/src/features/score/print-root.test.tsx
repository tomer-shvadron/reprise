import { act, render } from '@testing-library/react';
import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { PrintRoot } from './print-root';
import { createPrintStore } from './print-store';

/** Whether `target` is reachable from `from` through object properties, DOM nodes excluded. */
function reaches(from: unknown, target: object): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [from];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next !== 'object' || next === null || seen.has(next)) continue;
    if (next === target) return true;
    seen.add(next);
    if (next instanceof Node && next !== from) continue;
    for (const key of Reflect.ownKeys(next)) {
      stack.push(Reflect.get(next, key));
    }
  }
  return false;
}

describe('PrintRoot', () => {
  it('mounts a job as a child of body, whose render lets the print go ahead', async () => {
    const services = createTestServices();
    const { bytes } = await write(score().track('guitar').build(), 'reprise');
    await services.document.getState().openBytes('song.reprise', bytes);
    const seen: (Element | null)[] = [];
    // The store prints only after the job's `rendered` signal, so this sees what printing sees.
    const print = vi.fn(() => {
      seen.push(document.querySelector('body > .score-print'));
      return Promise.resolve();
    });
    const store = createPrintStore({
      document: services.document,
      ui: services.ui,
      platform: { print },
      fonts: () => Promise.resolve(),
      nextPaint: () => Promise.resolve(),
    });
    render(<PrintRoot store={store} />);
    expect(document.querySelector('.score-print')).toBeNull();

    store.getState().open();
    await act(async () => {
      await store.getState().print();
    });
    expect(print).toHaveBeenCalledOnce();
    const [mounted] = seen;
    expect(mounted).toBeTruthy();
    expect(mounted?.getAttribute('aria-hidden')).toBe('true');
    expect(mounted?.querySelectorAll('.score-page').length).toBeGreaterThan(0);
    expect(document.querySelector('.score-print')).toBeNull();
  });

  it('keeps no reference to the last job once the print ends', async () => {
    const services = createTestServices();
    const { bytes } = await write(score().track('guitar').build(), 'reprise');
    await services.document.getState().openBytes('song.reprise', bytes);
    let job: object | undefined;
    const store = createPrintStore({
      document: services.document,
      ui: services.ui,
      platform: {
        print: () => {
          job = store.getState().job;
          return Promise.resolve();
        },
      },
      fonts: () => Promise.resolve(),
      nextPaint: () => Promise.resolve(),
    });
    const { container } = render(<PrintRoot store={store} />);
    store.getState().open();
    await act(async () => {
      await store.getState().print();
    });
    expect(job).toBeDefined();
    expect(document.querySelector('.score-print')).toBeNull();
    // React keeps the previous render's fiber as `alternate`, so state read through a hook
    // there would hold the job and its layout until the next print.
    if (job) expect(reaches(container, job)).toBe(false);
  });
});
