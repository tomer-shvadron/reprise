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
 * the two captures are compared here: the ink pixels with no ink within a pixel of them in the
 * other image, counted both ways, may be at most `MAX_DIFFERING`. It is measured 0 on this scene,
 * on the reference Mac and on CI; the bound is an absolute count, not a share of the page's ink,
 * because a missing single-digit fret number is 11 px, an accidental more and a clef 100 to 200, which a share
 * of 32,000 px would let through. A second test proves the comparison can fail. The exported PNG
 * also has an ordinary baseline of its own.
 */
const MAX_DIFFERING = 8;
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

function inkBelow(image: ImageData, row: number): number {
  let ink = 0;
  for (let i = row * image.width * 4; i < image.data.length; i += 4) {
    if (luma(image.data, i) < INK_LUMA) ink++;
  }
  return ink;
}

/** A copy with a box painted white: what a dropped glyph leaves. */
function blanked(
  image: ImageData,
  box: { x: number; y: number; width: number; height: number },
): ImageData {
  const copy = new ImageData(image.data.slice(), image.width, image.height);
  for (
    let y = Math.max(0, Math.floor(box.y));
    y < Math.min(image.height, Math.ceil(box.y + box.height));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(box.x));
      x < Math.min(image.width, Math.ceil(box.x + box.width));
      x++
    ) {
      copy.data.fill(255, (y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
    }
  }
  return copy;
}

/** A copy moved right and down by whole pixels. */
function shifted(image: ImageData, dx: number, dy: number): ImageData {
  const copy = new ImageData(image.width, image.height);
  copy.data.fill(255);
  for (let y = 0; y < image.height - dy; y++) {
    const from = y * image.width * 4;
    const to = ((y + dy) * image.width + dx) * 4;
    copy.data.set(image.data.subarray(from, from + (image.width - dx) * 4), to);
  }
  return copy;
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
    // The painter's capture is cropped to its systems, the export is the whole sheet: same width,
    // the export is the A4 sheet, and below the painter's last row it is empty.
    expect(exportedPixels.width).toBe(paintedPixels.width);
    expect([exportedPixels.width, exportedPixels.height]).toEqual([794, 1123]);
    expect(inkBelow(exportedPixels, paintedPixels.height)).toBe(0);
    const { ink, differing } = compare(paintedPixels, exportedPixels);
    console.info(JSON.stringify({ ink, differing }));
    expect(ink).toBeGreaterThan(1000);
    expect(differing).toBeLessThanOrEqual(MAX_DIFFERING);

    cleanup();
    document.body.style.margin = '0';
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([exported.bytes.slice().buffer]));
    image.style.display = 'block';
    document.body.replaceChildren(image);
    await image.decode();
    try {
      await expect.element(image).toMatchScreenshot('export-effects-both-a4-p1');
    } finally {
      // Nothing of this test may push the next one's page down.
      image.remove();
      URL.revokeObjectURL(image.src);
    }
  });

  it('the comparison fails on a broken export: a dropped glyph, a missing number, a 2 px shift', async () => {
    const built = sourceScore();
    const notation = uniformNotation(built, 'both');
    const tracks = built.tracks.map(({ id }) => id);
    const { result } = layoutForPrint(
      built,
      { tracks, paper: 'a4', header: true, pageNumbers: false },
      notation,
      undefined,
    );
    const shot = await paintPage(result, 0, 'light').screenshot({ base64: true, save: false });
    const base64 = typeof shot === 'string' ? shot : shot.base64;
    const painted = await pixelsOf(
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
    const exported = await pixelsOf(
      new Blob([(images[0]?.bytes ?? new Uint8Array()).slice().buffer]),
    );
    expect(compare(painted, exported).differing).toBeLessThanOrEqual(MAX_DIFFERING);

    const page = result.pages[0];
    const onPage = result.primitives.slice(
      result.systems[page?.systems.start ?? 0]?.primitives.start ?? 0,
      result.systems[(page?.systems.end ?? 1) - 1]?.primitives.end ?? 0,
    );
    const clef = onPage.find((p) => p.kind === 'glyph' && p.glyph.endsWith('Clef8vb'));
    const number = onPage.find((p) => p.kind === 'text' && /^\d$/.test(p.text));
    if (!clef || !number) throw new Error('the scene has no clef or fret number to drop');
    expect(
      compare(painted, blanked(exported, clef.bbox)).differing,
      'a dropped clef',
    ).toBeGreaterThan(MAX_DIFFERING);
    expect(
      compare(painted, blanked(exported, number.bbox)).differing,
      'a dropped fret number',
    ).toBeGreaterThan(MAX_DIFFERING);
    expect(compare(painted, shifted(exported, 2, 0)).differing, 'a 2 px shift').toBeGreaterThan(
      MAX_DIFFERING,
    );
  });
});
