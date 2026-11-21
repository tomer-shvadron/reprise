import { afterEach, describe, expect, it } from 'vitest';

import { copyImage, copyText } from './system-clipboard';

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

describe('copyImage', () => {
  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('hands the clipboard an image/png item whose blob is still a promise', async () => {
    const items: unknown[][] = [];
    class FakeItem {
      constructor(readonly parts: Record<string, Promise<Blob>>) {}
    }
    Object.defineProperty(globalThis, 'ClipboardItem', { value: FakeItem, configurable: true });
    provide({
      write: (written: unknown[]) => {
        items.push(written);
        return Promise.resolve();
      },
    });
    try {
      let release: (blob: Blob) => void = () => undefined;
      const pending = new Promise<Blob>((resolve) => {
        release = resolve;
      });
      const copying = copyImage(pending);
      // The write began before the image existed.
      expect(items).toHaveLength(1);
      const [item] = items[0] as FakeItem[];
      expect(Object.keys(item?.parts ?? {})).toEqual(['image/png']);
      release(png());
      await copying;
    } finally {
      Reflect.deleteProperty(globalThis, 'ClipboardItem');
    }
  });

  it('rejects with the reason when the platform refuses', async () => {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      value: function ClipboardItemStub() {
        return undefined;
      },
      configurable: true,
    });
    provide({ write: () => Promise.reject(new Error('NotAllowedError')) });
    try {
      await expect(copyImage(Promise.resolve(png()))).rejects.toThrow(
        'the clipboard refused the image (NotAllowedError)',
      );
    } finally {
      Reflect.deleteProperty(globalThis, 'ClipboardItem');
    }
  });

  it('rejects when there is no clipboard', async () => {
    await expect(copyImage(Promise.resolve(png()))).rejects.toThrow(
      'this browser cannot copy images',
    );
  });
});
