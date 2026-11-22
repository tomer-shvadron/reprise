import { unzipSync } from 'fflate';
import { largeScore, note, score } from '@reprise/model/testing';
import type { Score } from '@reprise/model';
import { describe, expect, it, vi } from 'vitest';

import { layoutForPrint } from '../print-layout';
import { fakePlatform } from '@/test/services';

import { exportImages, pageOfBar, renderImages, type ImageExportRequest } from './image-export';
import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';

const outlines = parseOutlines(bravuraJson, geistJson);

function small(title = 'Small song'): Score {
  const builder = score()
    .title(title)
    .track('guitar', { display: { notation: 'both', octaveShift: 1 } });
  for (let bar = 0; bar < 4; bar++) {
    builder
      .bar()
      .beat('4', [note(2, bar)])
      .beat('4', [note(3, 5)])
      .beat('2', [note(1, 0)]);
  }
  return builder.build({ ids: 'sequential' });
}

function requestFor(built: Score, extra: Partial<ImageExportRequest> = {}): ImageExportRequest {
  return {
    score: built,
    scope: { kind: 'score' },
    format: 'svg',
    scale: 2,
    background: 'white',
    paper: 'a4',
    tracks: built.tracks.map(({ id }) => id),
    notation: {},
    ...extra,
  };
}

const rasterise = vi.fn((svg: string) =>
  Promise.resolve(new TextEncoder().encode(`png:${String(svg.length)}`)),
);
const deps = {
  outlines: () => Promise.resolve(outlines),
  rasterise,
  yieldFrame: () => Promise.resolve(),
};

describe('the chord strip in an export (#352)', () => {
  function chorded(): Score {
    const builder = score().title('Chords').track('guitar');
    builder
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
      .beat('4', [note(1, 0)], { chord: { name: 'G' } })
      .rest('2');
    return builder.build({ ids: 'sequential' });
  }

  it('draws the strip on a whole-score image when asked, which pushes the first system down', async () => {
    const built = chorded();
    const without = await renderImages(requestFor(built), deps);
    const withStrip = await renderImages(requestFor(built, { chordStrip: true }), deps);
    const text = (r: typeof without) => new TextDecoder().decode(r.images[0]?.bytes);
    expect(text(withStrip).length).toBeGreaterThan(text(without).length);
    // The strip's rows are written as outlines inside the page; the layout test pins the first
    // system's drop by exactly their height.
    expect((text(withStrip).match(/<use /g) ?? []).length).toBeGreaterThan(
      (text(without).match(/<use /g) ?? []).length,
    );
  });

  it('leaves a bar range without one, as it has no heading', async () => {
    const built = chorded();
    const range = { kind: 'bars', start: 0, end: 1 } as const;
    const a = await renderImages(requestFor(built, { scope: range }), deps);
    const b = await renderImages(requestFor(built, { scope: range, chordStrip: true }), deps);
    expect(new TextDecoder().decode(b.images[0]?.bytes)).toBe(
      new TextDecoder().decode(a.images[0]?.bytes),
    );
  });
});

describe('exportImages', () => {
  it('saves a one-page score as one plain svg', async () => {
    const saveFile = vi.fn(() => Promise.resolve('/x/Small song.svg'));
    const result = await exportImages(requestFor(small()), {
      ...deps,
      platform: fakePlatform({ saveFile }),
    });
    expect(result).toMatchObject({ status: 'saved', files: 1, path: '/x/Small song.svg' });
    const [name, bytes, filters] = saveFile.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      unknown,
    ];
    expect(name).toBe('Small song.svg');
    expect(filters).toEqual([{ name: 'SVG image', extensions: ['svg'] }]);
    expect(new TextDecoder().decode(bytes)).toMatch(/^<\?xml[\s\S]*<svg /);
  });

  it('names a page and a scale: a single png of page 1 at 2x', async () => {
    const rendered = await renderImages(
      requestFor(small(), { format: 'png', scope: { kind: 'page', page: 1 } }),
      deps,
    );
    expect(rendered.fileName).toBe('Small song p1@2x.png');
    expect(rasterise).toHaveBeenLastCalledWith(expect.any(String), {
      width: 794,
      height: 1123,
      scale: 2,
    });
  });

  it('names a bar range from 1 and crops it to its content', async () => {
    const rendered = await renderImages(
      requestFor(small(), { format: 'png', scale: 1, scope: { kind: 'bars', start: 1, end: 3 } }),
      deps,
    );
    expect(rendered.fileName).toBe('Small song bars 2-3.png');
    const [image] = rendered.images;
    expect(image?.height).toBeLessThan(400);
    expect(image?.width).toBeLessThanOrEqual(794);
    expect(rendered.images).toHaveLength(1);
  });

  it('falls back to the file name, then to Untitled, and keeps the name safe', async () => {
    const named = await renderImages(requestFor(small(''), { fileName: 'riff: a/b.gp5' }), deps);
    expect(named.fileName).toBe('riff_ a_b.svg');
    const bare = await renderImages(requestFor(small('')), deps);
    expect(bare.fileName).toBe('Untitled.svg');
  });

  it('puts several pages in one zip, in order, with the PNGs stored', async () => {
    const big = largeScore(2, 120);
    const saveFile = vi.fn(() => Promise.resolve(undefined));
    const request = requestFor(big, { format: 'png', scale: 3, tracks: [big.tracks[0]?.id ?? ''] });
    const result = await exportImages(request, { ...deps, platform: fakePlatform({ saveFile }) });
    expect(result).toMatchObject({ status: 'saved' });
    const [name, bytes, filters] = saveFile.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      unknown,
    ];
    expect(name).toBe('Untitled (png@3x).zip');
    expect(filters).toEqual([{ name: 'ZIP archive', extensions: ['zip'] }]);
    const entries = Object.keys(unzipSync(bytes));
    expect(entries.length).toBeGreaterThan(1);
    const width = String(entries.length).length;
    expect(entries[0]).toBe(`Untitled p${'1'.padStart(width, '0')}@3x.png`);
    expect(entries).toEqual([...entries].sort());
  });

  it('writes nothing when aborted mid-run', async () => {
    const saveFile = vi.fn(() => Promise.resolve(undefined));
    const controller = new AbortController();
    const big = largeScore(2, 120);
    const result = await exportImages(
      requestFor(big, { format: 'png', tracks: [big.tracks[0]?.id ?? ''] }),
      {
        ...deps,
        platform: fakePlatform({ saveFile }),
        signal: controller.signal,
        onProgress: ({ done }) => {
          if (done === 1) controller.abort();
        },
      },
    );
    expect(result).toEqual({ status: 'cancelled' });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('reports progress page by page', async () => {
    const big = largeScore(2, 120);
    const progress = vi.fn();
    await renderImages(requestFor(big, { tracks: [big.tracks[0]?.id ?? ''] }), {
      ...deps,
      onProgress: progress,
    });
    const total = (progress.mock.calls.at(-1)?.[0] as { total: number }).total;
    expect(total).toBeGreaterThan(1);
    expect(progress.mock.calls.map(([p]) => (p as { done: number }).done)).toEqual(
      Array.from({ length: total + 1 }, (_, i) => i),
    );
  });

  it('does not touch the score it was given', async () => {
    const built = small();
    const before = JSON.stringify(built);
    await renderImages(requestFor(built, { scope: { kind: 'bars', start: 1, end: 3 } }), deps);
    expect(JSON.stringify(built)).toBe(before);
  });

  it('zips a several-page svg export, deflated, with the svgs back out', async () => {
    const big = largeScore(2, 120);
    let saved: Uint8Array | undefined;
    let name = '';
    await exportImages(requestFor(big, { tracks: [big.tracks[0]?.id ?? ''] }), {
      ...deps,
      platform: fakePlatform({
        saveFile: (suggested, bytes) => {
          name = suggested;
          saved = bytes;
          return Promise.resolve(undefined);
        },
      }),
    });
    expect(name).toBe('Untitled (svg).zip');
    const entries = unzipSync(saved ?? new Uint8Array());
    const names = Object.keys(entries);
    expect(names.length).toBeGreaterThan(1);
    expect(names[0]).toMatch(/^Untitled p0*1\.svg$/);
    expect(new TextDecoder().decode(Object.values(entries)[0])).toMatch(/^<\?xml[\s\S]*<svg /);
  });

  it('pads a lone page to the layout page count and names it so', async () => {
    const big = largeScore(8, 300);
    const request = requestFor(big, {
      scope: { kind: 'page', page: 7 },
    });
    const all = await renderImages({ ...request, scope: { kind: 'score' } }, deps);
    const count = all.images.length;
    expect(count).toBeGreaterThan(9);
    const one = await renderImages(request, deps);
    expect(one.fileName).toBe(`Untitled p${'7'.padStart(String(count).length, '0')}` + '.svg');
    expect(one.images).toHaveLength(1);
  });

  it('numbers the pages of a bar range that spans several and crops each', async () => {
    const big = largeScore(2, 120);
    const rendered = await renderImages(
      requestFor(big, {
        format: 'png',
        scale: 1,
        scope: { kind: 'bars', start: 0, end: 120 },
      }),
      deps,
    );
    expect(rendered.images.length).toBeGreaterThan(1);
    expect(rendered.fileName).toBe('Untitled bars 1-120 (png).zip');
    expect(rendered.images[0]?.name).toMatch(/^Untitled bars 1-120 p0*1\.png$/);
    // Every page but the last is full; the last is cropped to its content.
    expect(rendered.images[0]?.height).toBeLessThanOrEqual(1123);
    const last = rendered.images.at(-1);
    expect(last?.height).toBeLessThan(rendered.images[0]?.height ?? 0);
  });

  it('names a range past the end by the bars it has', async () => {
    const rendered = await renderImages(
      requestFor(small(), { scope: { kind: 'bars', start: 2, end: 99 } }),
      deps,
    );
    expect(rendered.fileName).toBe('Small song bars 3-4.svg');
  });

  it('keeps a transparent bar range cropped, with its mask', async () => {
    const rendered = await renderImages(
      requestFor(small(), {
        background: 'transparent',
        scope: { kind: 'bars', start: 0, end: 2 },
      }),
      deps,
    );
    const svg = new TextDecoder().decode(rendered.images[0]?.bytes);
    expect(svg).toContain('<mask');
    expect(svg).not.toMatch(/<rect width="[\d.]+" height="[\d.]+" fill="#ffffff"/);
    expect(rendered.images[0]?.height).toBeLessThan(400);
  });

  it('yields to the UI without waiting for a frame', async () => {
    // No yieldFrame given: the default must resolve with no animation frame (a hidden window has none).
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    const rendered = await renderImages(requestFor(small()), {
      outlines: deps.outlines,
      rasterise,
    });
    expect(rendered.images).toHaveLength(1);
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });
});

describe('pageOfBar (#421)', () => {
  const long = (() => {
    const builder = score().title('Long').track('guitar');
    for (let bar = 0; bar < 120; bar++) builder.bar().beat('4', [note(1, bar % 20)]);
    return builder.build({ ids: 'sequential' });
  })();
  const laid = layoutForPrint(
    long,
    { tracks: long.tracks.map(({ id }) => id), paper: 'a4', header: true, pageNumbers: false },
    {},
    undefined,
    {},
  ).result;
  const secondPage = laid.pages[1];

  it('maps the first bar of page 2, the last bar of page 1 and a bar past the end', () => {
    expect(secondPage).toBeDefined();
    const first = laid.systems[secondPage?.systems.start ?? 0];
    const request = requestFor(long);
    expect(pageOfBar(request, first?.bars.start ?? 0)).toBe(2);
    expect(pageOfBar(request, (first?.bars.start ?? 1) - 1)).toBe(1);
    expect(pageOfBar(request, 9999)).toBe(1);
  });
});
