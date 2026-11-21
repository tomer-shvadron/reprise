import { unzipSync } from 'fflate';
import { largeScore, note, score } from '@reprise/model/testing';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { fakePlatform } from '@/test/services';

import { exportImages, renderImages, type ImageExportRequest } from './image-export';
import { loadOutlines } from './outlines';
import { svgToPng } from './rasterise';

function oneBar(): Score {
  return score()
    .title('Rasterise')
    .track('guitar', { display: { notation: 'both', octaveShift: 1 } })
    .bar()
    .beat('4', [note(2, 5)])
    .beat('4', [note(1, 3)])
    .beat('2', [note(4, 0)])
    .build({ ids: 'sequential' });
}

function requestFor(built: Score, extra: Partial<ImageExportRequest> = {}): ImageExportRequest {
  return {
    score: built,
    scope: { kind: 'score' },
    format: 'png',
    scale: 1,
    background: 'white',
    paper: 'a4',
    tracks: built.tracks.map(({ id }) => id),
    notation: {},
    ...extra,
  };
}

async function decode(bytes: Uint8Array): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

const alphaAt = (image: ImageData, x: number, y: number): number =>
  image.data[(y * image.width + x) * 4 + 3] ?? 0;

function inkPixels(image: ImageData): number {
  let ink = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if ((image.data[i + 3] ?? 0) > 128 && (image.data[i] ?? 255) < 128) ink++;
  }
  return ink;
}

function ihdr(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('svgToPng in Chromium', () => {
  it.each([1, 2, 3] as const)('makes a page-sized PNG at %ix', async (scale) => {
    const { images } = await renderImages(requestFor(oneBar(), { scale }), {});
    const [image] = images;
    expect(image).toBeDefined();
    expect(ihdr(image?.bytes ?? new Uint8Array(40))).toEqual({
      width: Math.round(794 * scale),
      height: Math.round(1123 * scale),
    });
  });

  it('is transparent in the margin on a transparent background and white on white', async () => {
    const white = await renderImages(requestFor(oneBar()), {});
    const clear = await renderImages(requestFor(oneBar(), { background: 'transparent' }), {});
    const whitePixels = await decode(white.images[0]?.bytes ?? new Uint8Array());
    const clearPixels = await decode(clear.images[0]?.bytes ?? new Uint8Array());
    expect(alphaAt(whitePixels, 5, 5)).toBe(255);
    expect(whitePixels.data.slice(20, 24)).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
    expect(alphaAt(clearPixels, 5, 5)).toBe(0);
    // Ink is ink in both: outlines rasterise with no font loaded.
    expect(inkPixels(whitePixels)).toBeGreaterThan(500);
    expect(inkPixels(clearPixels)).toBeGreaterThan(500);
  });

  it('records the density: 96 dpi times the scale', async () => {
    const { images } = await renderImages(requestFor(oneBar(), { scale: 2 }), {});
    const bytes = images[0]?.bytes ?? new Uint8Array();
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(String.fromCharCode(...bytes.subarray(37, 41))).toBe('pHYs');
    expect(view.getUint32(41)).toBe(7559);
    // The spec allows one: a future encoder that writes its own would make two.
    let chunks = 0;
    for (let at = 8; at < bytes.length;) {
      if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'pHYs') chunks++;
      at += 12 + view.getUint32(at);
    }
    expect(chunks).toBe(1);
  });

  it.each([1, 2, 3] as const)(
    'sizes a cropped bar range to round(crop x %i) with a transparent margin',
    async (scale) => {
      const built = oneBar();
      const range = await renderImages(
        requestFor(built, {
          scale,
          background: 'transparent',
          scope: { kind: 'bars', start: 0, end: 1 },
        }),
        {},
      );
      const [image] = range.images;
      expect(image).toBeDefined();
      const bytes = image?.bytes ?? new Uint8Array(40);
      expect(ihdr(bytes)).toEqual({
        width: Math.round((image?.width ?? 0) * scale),
        height: Math.round((image?.height ?? 0) * scale),
      });
      expect(image?.height).toBeLessThan(400);
      const pixels = await decode(bytes);
      // The 24 px margin is empty, and the mask meets the crop without painting a white patch.
      expect(alphaAt(pixels, 3 * scale, 3 * scale)).toBe(0);
      expect(inkPixels(pixels)).toBeGreaterThan(100);
    },
  );

  it('puts ink inside a known glyph box', async () => {
    const outlines = await loadOutlines();
    expect(outlines.bravura.glyphs['57424']).toBeDefined();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ffffff"/>' +
      `<defs><path id="g" d="${outlines.bravura.glyphs['57424']?.d ?? ''}"/></defs>` +
      '<use xlink:href="#g" transform="translate(20 60) scale(0.04 -0.04)" fill="#000000"/></svg>';
    const pixels = await decode(await svgToPng(svg, { width: 100, height: 100, scale: 1 }));
    expect(inkPixels(pixels)).toBeGreaterThan(50);
    // The rows above the glyph stay white.
    expect(inkPixels(new ImageData(pixels.data.slice(0, 4 * 100 * 10), 100, 10))).toBe(0);
  });

  it('saves a multi-page score as one zip of valid PNGs', async () => {
    const big = largeScore(2, 120);
    let saved: Uint8Array | undefined;
    await exportImages(requestFor(big, { scale: 1, tracks: [big.tracks[0]?.id ?? ''] }), {
      platform: fakePlatform({
        saveFile: (_name, bytes) => {
          saved = bytes;
          return Promise.resolve(undefined);
        },
      }),
    });
    const entries = Object.values(unzipSync(saved ?? new Uint8Array()));
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      expect(ihdr(entry)).toEqual({ width: 794, height: 1123 });
    }
  }, 60_000);
});
