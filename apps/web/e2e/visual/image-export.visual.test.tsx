import { cleanup } from '@testing-library/react';
import { parseNative, type Score } from '@reprise/model';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { layoutForPrint, uniformNotation } from '@/features/score';
import { renderImages } from '@/features/score/image/image-export';

import { expectScoreFonts, paintPage } from './test/paint-page';

import '@/index.css';

/**
 * The exported PNG against the painter. Outlined shapes and hinted text rasterise differently at
 * the edges, so this is not a screenshot matcher (whose tolerance is set once in the config):
 * the two captures are compared here: the share of ink with none within a pixel of it in the other
 * image (measured 0 on this scene) may be at most
 * `MAX_DIFFERING_SHARE`. The exported PNG also has an ordinary baseline of its own.
 */
const MAX_DIFFERING_SHARE = 0.005;
/** Luminance, of 255, under which a pixel is ink, and what counts as ink near it in the other image. */
const INK_LUMA = 128;
const NEAR_LUMA = 200;
const FIXTURE = 'gp5/effects.gp5';

function sourceScore(): Score {
  const found = inject('scoreFixtures').find(({ path }) => path === FIXTURE);
  if (!found) throw new Error(`the corpus has no fixture ${FIXTURE}`);
  const { score } = parseNative(new TextEncoder().encode(found.native));
  // No title, byline or file name: the painter's page has no heading, so neither has the export.
  return { ...score, meta: { ...score.meta, title: '', artist: '', album: '' } };
}

async function pixelsOf(source: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(source);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Ink in one image with none within a pixel of it in the other, both ways. The painter's system
 * `<svg>`s sit on whole pixels and the export's shapes on fractions, so a hairline lands up to half
 * a pixel apart, which a pixel-for-pixel comparison would count as two missing rows.
 */
function compare(a: ImageData, b: ImageData): { ink: number; differing: number } {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const near = (from: ImageData, x: number, y: number): number => {
    let darkest = 255;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
        darkest = Math.min(darkest, luma(from.data, ((y + dy) * from.width + x + dx) * 4));
      }
    }
    return darkest;
  };
  let ink = 0;
  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inA = luma(a.data, (y * a.width + x) * 4) < INK_LUMA;
      const inB = luma(b.data, (y * b.width + x) * 4) < INK_LUMA;
      if (inA) ink++;
      if (inA && near(b, x, y) >= NEAR_LUMA) differing++;
      if (inB && near(a, x, y) >= NEAR_LUMA) differing++;
    }
  }
  return { ink, differing };
}

const luma = (data: Uint8ClampedArray, i: number): number =>
  0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);

beforeAll(expectScoreFonts);
afterEach(cleanup);

describe('image export against the painter', () => {
  it('draws page 1 of effects.gp5 as the painter does, and holds its own baseline', async () => {
    const built = sourceScore();
    const notation = uniformNotation(built, 'both');
    const tracks = built.tracks.map(({ id }) => id);
    const { result } = layoutForPrint(
      built,
      { tracks, paper: 'a4', header: true, pageNumbers: false },
      notation,
      undefined,
    );
    const painted = paintPage(result, 0, 'light');
    const shot = await painted.screenshot({ base64: true, save: false });
    const base64 = typeof shot === 'string' ? shot : shot.base64;
    const paintedPixels = await pixelsOf(
      new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }),
    );

    const { images } = await renderImages(
      {
        score: built,
        scope: { kind: 'page', page: 1 },
        format: 'png',
        scale: 1,
        background: 'white',
        paper: 'a4',
        tracks,
        notation,
      },
      {},
    );
    const exported = images[0];
    if (!exported) throw new Error('no image');
    const exportedPixels = await pixelsOf(new Blob([exported.bytes.slice().buffer]));
    const { ink, differing } = compare(paintedPixels, exportedPixels);
    const share = differing / ink;
    console.info(JSON.stringify({ ink, differing, share }));
    expect(ink).toBeGreaterThan(1000);
    expect(share).toBeLessThanOrEqual(MAX_DIFFERING_SHARE);

    cleanup();
    document.body.style.margin = '0';
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([exported.bytes.slice().buffer]));
    image.style.display = 'block';
    document.body.replaceChildren(image);
    await image.decode();
    await expect.element(image).toMatchScreenshot('export-effects-both-a4-p1');
  });
});
