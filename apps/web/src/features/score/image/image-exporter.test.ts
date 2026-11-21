import { unzipSync } from 'fflate';
import { note, score } from '@reprise/model/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestServices, fakePlatform } from '@/test/services';

import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';
import {
  createImageExporter,
  parsePage,
  type ImageExporter,
  type ImageSelection,
} from './image-exporter';

const outlines = parseOutlines(bravuraJson, geistJson);

function song() {
  const builder = score().title('Demo').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < 4; bar++) builder.bar().beat('4', [note(1, bar)]);
  return builder.build({ ids: 'sequential' });
}

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function longSong() {
  const builder = score().title('Long').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < 120; bar++) builder.bar().beat('4', [note(1, bar % 12)]);
  return builder.build({ ids: 'sequential' });
}

function setup(bars?: { start: number; end: number }, built = song()) {
  const services = createTestServices();
  const selection: ImageSelection | undefined = bars && {
    tracks: built.tracks.map(({ id }) => id),
    bars,
  };
  services.document.setState({ score: built });
  const notify = vi.fn<(message: string, kind?: 'error') => void>();
  const saveFile = vi.fn<(name: string, bytes: Uint8Array) => Promise<string | undefined>>(() =>
    Promise.resolve('/x/out'),
  );
  const rasterise = vi.fn(() => Promise.resolve(png));
  const exporter: ImageExporter = createImageExporter({
    document: services.document,
    ui: services.ui,
    platform: fakePlatform({ saveFile }),
    selectionScope: () => selection,
    notify,
    render: {
      outlines: () => Promise.resolve(outlines),
      rasterise,
      yieldFrame: () => Promise.resolve(),
    },
  });
  return { services, built, exporter, notify, saveFile, rasterise };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(globalThis, 'ClipboardItem');
});

describe('parsePage', () => {
  it('takes a whole number from 1', () => {
    expect(parsePage(' 3 ')).toBe(3);
    expect([parsePage('0'), parsePage('1.5'), parsePage(''), parsePage('-2')]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('the dialog', () => {
  it('opens on PNG at 2x on white, the whole score, with no selection', () => {
    const { exporter, services } = setup();
    exporter.open();
    expect(exporter.store.getState().dialog).toMatchObject({
      scope: 'score',
      format: 'png',
      scale: 2,
      background: 'white',
      paper: services.ui.getState().view.paper,
      selectedBars: undefined,
    });
  });

  it('defaults to the selected bars when there are some, and says which', () => {
    const { exporter } = setup({ start: 1, end: 3 });
    exporter.open();
    expect(exporter.store.getState().dialog).toMatchObject({
      scope: 'bars',
      selectedBars: { first: 2, last: 3 },
    });
  });

  it('remembers the settings for the session, and closes on cancel', async () => {
    const { exporter } = setup();
    exporter.open();
    exporter.update({ format: 'svg', background: 'transparent', paper: 'letter' });
    await exporter.submit();
    exporter.open();
    expect(exporter.store.getState().dialog).toMatchObject({
      format: 'svg',
      background: 'transparent',
      paper: 'letter',
    });
    exporter.cancel();
    expect(exporter.store.getState().dialog).toBeUndefined();
  });

  it('closes when another score replaces the one it was about', () => {
    const { exporter, services } = setup();
    exporter.open();
    services.document.setState({ score: song() });
    expect(exporter.store.getState().dialog).toBeUndefined();
  });
});

describe('Export', () => {
  it('saves a one-page score as one file, leaves the document alone and says so', async () => {
    const { exporter, services, saveFile, notify } = setup();
    const before = services.document.getState();
    exporter.open();
    exporter.update({ format: 'svg' });
    await exporter.submit();
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0]?.[0]).toBe('Demo.svg');
    expect(exporter.store.getState().dialog).toBeUndefined();
    expect(notify).toHaveBeenCalledWith('Exported 1 image.');
    const after = services.document.getState();
    expect(after.dirty).toBe(before.dirty);
    expect(after.songId).toBe(before.songId);
  });

  it('exports a selection of the chosen bars as a cropped PNG named for them', async () => {
    const { exporter, saveFile, rasterise } = setup({ start: 1, end: 3 });
    exporter.open();
    await exporter.submit();
    expect(saveFile.mock.calls[0]?.[0]).toBe('Demo bars 2-3@2x.png');
    expect(rasterise).toHaveBeenCalledTimes(1);
  });

  it('does not export a page number that is not a number', async () => {
    const { exporter, saveFile } = setup();
    exporter.open();
    exporter.update({ scope: 'page', pageText: 'abc' });
    await exporter.submit();
    expect(saveFile).not.toHaveBeenCalled();
    expect(exporter.store.getState().dialog).toBeDefined();
  });

  it('refuses, rather than export the whole score, when the selected bars are gone', async () => {
    const services = createTestServices();
    const built = song();
    services.document.setState({ score: built });
    let selected: { tracks: string[]; bars: { start: number; end: number } } | undefined = {
      tracks: built.tracks.map(({ id }) => id),
      bars: { start: 0, end: 2 },
    };
    const saveFile = vi.fn<(name: string, bytes: Uint8Array) => Promise<string | undefined>>(() =>
      Promise.resolve('/x/out'),
    );
    const exporter = createImageExporter({
      document: services.document,
      ui: services.ui,
      platform: fakePlatform({ saveFile }),
      selectionScope: () => selected,
      notify: () => undefined,
      render: { outlines: () => Promise.resolve(outlines), yieldFrame: () => Promise.resolve() },
    });
    exporter.open();
    expect(exporter.store.getState().dialog?.scope).toBe('bars');
    selected = undefined;
    await exporter.submit();
    expect(saveFile).not.toHaveBeenCalled();
    expect(exporter.store.getState().dialog?.error).toMatch(/selected bars are gone/u);
  });

  it('shows the failure in the dialog and keeps it open', async () => {
    const { exporter, saveFile } = setup();
    saveFile.mockRejectedValueOnce(new Error('disk full'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exporter.open();
    await exporter.submit();
    log.mockRestore();
    expect(exporter.store.getState().dialog?.error).toBe('Could not export: disk full');
    expect(exporter.store.getState().dialog?.progress).toBeUndefined();
  });

  it('writes nothing when cancelled while rendering', async () => {
    const { exporter, saveFile, rasterise } = setup();
    rasterise.mockImplementation(() => {
      exporter.cancel();
      return Promise.resolve(png);
    });
    exporter.open();
    await exporter.submit();
    expect(saveFile).not.toHaveBeenCalled();
    expect(exporter.store.getState().dialog).toBeUndefined();
  });

  it('zips several pages (a long score) into one file', async () => {
    const services = createTestServices();
    const builder = score().title('Long').track('guitar', { name: 'Lead' });
    for (let bar = 0; bar < 120; bar++) builder.bar().beat('4', [note(1, bar % 12)]);
    services.document.setState({ score: builder.build({ ids: 'sequential' }) });
    const saveFile = vi.fn<(name: string, bytes: Uint8Array) => Promise<string | undefined>>(() =>
      Promise.resolve('/x/out'),
    );
    const exporter = createImageExporter({
      document: services.document,
      ui: services.ui,
      platform: fakePlatform({ saveFile }),
      selectionScope: () => undefined,
      notify: () => undefined,
      render: { outlines: () => Promise.resolve(outlines), yieldFrame: () => Promise.resolve() },
    });
    exporter.open();
    exporter.update({ format: 'svg' });
    await exporter.submit();
    const [name, bytes] = saveFile.mock.calls[0] ?? [];
    expect(name).toBe('Long (svg).zip');
    expect(Object.keys(unzipSync(bytes ?? new Uint8Array(0))).length).toBeGreaterThan(1);
  });
});

describe('Copy as image', () => {
  function clipboard() {
    const written: Record<string, Promise<Blob>>[] = [];
    class FakeItem {
      constructor(readonly parts: Record<string, Promise<Blob>>) {
        written.push(parts);
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', { value: FakeItem, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: async (items: FakeItem[]) => {
          await Promise.all(items.flatMap((item) => Object.values(item.parts)));
        },
      },
      configurable: true,
    });
    return written;
  }

  it('puts a 2x PNG on white on the clipboard and says how many bars', async () => {
    const written = clipboard();
    const { exporter, rasterise, notify } = setup({ start: 0, end: 2 });
    await exporter.copy();
    expect(Object.keys(written[0] ?? {})).toEqual(['image/png']);
    const blob = await written[0]?.['image/png'];
    expect(blob?.type).toBe('image/png');
    expect(
      new Uint8Array(await (blob?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0)))),
    ).toEqual(png);
    expect(rasterise).toHaveBeenCalledWith(
      expect.stringContaining('fill="#ffffff"'),
      expect.objectContaining({ scale: 2 }),
    );
    expect(notify).toHaveBeenCalledWith('Copied 2 bars as an image.');
  });

  it('copies page 1 of a selection longer than a page, renders only that page and says so', async () => {
    const written = clipboard();
    const { exporter, rasterise, notify } = setup({ start: 0, end: 120 }, longSong());
    await exporter.copy();
    expect(rasterise).toHaveBeenCalledTimes(1);
    const blob = await written[0]?.['image/png'];
    expect(
      new Uint8Array(await (blob?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0)))),
    ).toEqual(png);
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Copied page 1 of \d+ as an image; the selection is longer than a page\.$/u,
      ),
    );
  });

  it('reaches clipboard.write before its first await, so the click is still the activation', async () => {
    const written = clipboard();
    const { exporter } = setup({ start: 0, end: 2 });
    const copying = exporter.copy();
    expect(written).toHaveLength(1);
    await copying;
  });

  it('asks for a selection when there is none', async () => {
    clipboard();
    const { exporter, notify } = setup();
    await exporter.copy();
    expect(notify).toHaveBeenCalledWith('Select some bars to copy them as an image.', 'error');
  });

  it('reports a refusal as an error notice', async () => {
    clipboard();
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: () => Promise.reject(new Error('NotAllowedError')) },
      configurable: true,
    });
    const { exporter, notify } = setup({ start: 0, end: 1 });
    await exporter.copy();
    expect(notify).toHaveBeenCalledWith(
      'Could not copy as an image: the clipboard refused the image (NotAllowedError)',
      'error',
    );
  });
});
