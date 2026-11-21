import { unzipSync } from 'fflate';
import { largeScore, note, score } from '@reprise/model/testing';
import type { Score } from '@reprise/model';
import { describe, expect, it, vi } from 'vitest';

import { fakePlatform } from '@/test/services';

import { exportImages, renderImages, type ImageExportRequest } from './image-export';
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
});
