import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Fonts = typeof import('./fonts');

const fontsModule = async (): Promise<Fonts> => import('./fonts');

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => {
      res(undefined);
    };
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Stubs FontFace and document.fonts; returns the pending Bravura and Geist loads. */
function stubFontApis() {
  const bravura = deferred();
  const geist = deferred();
  const constructed: string[] = [];
  vi.stubGlobal(
    'FontFace',
    class {
      constructor(family: string, source: string) {
        constructed.push(`${family} ${source}`);
      }
      load() {
        return bravura.promise;
      }
    },
  );
  const fonts = { add: vi.fn(), load: vi.fn(() => geist.promise) };
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  return { bravura, geist, fonts, constructed };
}

describe('score fonts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'fonts');
    vi.restoreAllMocks();
  });

  it('is ready at once where the font APIs are missing', async () => {
    const { useScoreFonts, loadScoreFonts } = await fontsModule();
    const { result } = renderHook(() => useScoreFonts());
    expect(result.current).toBe(true);
    await expect(loadScoreFonts()).resolves.toBeUndefined();
  });

  it('waits for Bravura and Geist, loading Bravura from the base URL', async () => {
    const { bravura, geist, fonts, constructed } = stubFontApis();
    const { useScoreFonts } = await fontsModule();
    const { result } = renderHook(() => useScoreFonts());
    expect(result.current).toBe(false);
    expect(constructed).toEqual([
      `Bravura url(${import.meta.env.BASE_URL}fonts/bravura/Bravura.woff2) format('woff2')`,
    ]);
    expect(fonts.add).toHaveBeenCalledOnce();
    expect(fonts.load).toHaveBeenCalledWith('400 16px "Geist Variable"');

    await act(async () => {
      bravura.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
    await act(async () => {
      geist.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toBe(true);
  });

  it('ends ready with one warning when a load fails', async () => {
    const { bravura, geist } = stubFontApis();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loadScoreFonts } = await fontsModule();
    const done = loadScoreFonts();
    bravura.reject(new Error('offline'));
    geist.resolve();
    await done;
    expect(warn).toHaveBeenCalledOnce();
  });

  it('starts one load for every user', async () => {
    const { fonts, bravura, geist } = stubFontApis();
    const { useScoreFonts, loadScoreFonts } = await fontsModule();
    renderHook(() => useScoreFonts());
    renderHook(() => useScoreFonts());
    expect(fonts.add).toHaveBeenCalledOnce();
    bravura.resolve();
    geist.resolve();
    await act(() => loadScoreFonts());
  });
});
