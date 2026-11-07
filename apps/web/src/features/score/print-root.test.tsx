import { act, render } from '@testing-library/react';
import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { PrintRoot } from './print-root';
import { createPrintStore } from './print-store';

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
});
