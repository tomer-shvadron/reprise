import { afterEach, describe, expect, it } from 'vitest';

import { copyText } from './system-clipboard';

const provide = (clipboard: unknown) => {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyText', () => {
  it('writes the text to the system clipboard', async () => {
    const written: string[] = [];
    provide({
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    });
    await copyText('e|--0--|');
    expect(written).toEqual(['e|--0--|']);
  });

  it('rejects with the reason when the platform refuses', async () => {
    provide({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
    await expect(copyText('x')).rejects.toThrow('the clipboard refused the text (NotAllowedError)');
  });

  it('rejects when there is no clipboard at all', async () => {
    await expect(copyText('x')).rejects.toThrow('this browser has no clipboard access');
  });
});
