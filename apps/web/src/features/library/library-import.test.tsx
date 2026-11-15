import { read } from '@reprise/formats';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { createMemoryStorage } from '@/test/memory-storage';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';
import type { PickedFile, PickedFolder, Platform } from '@/platform/platform';

import { createLibrary, provideLibrary, type Library } from './library';
import { installLibrary } from './install';
import { LibraryScreen } from './library-screen';
import { openLibraryDb } from './db/schema';
import { RecentSongs } from './recent-songs';
import { UnimportedBanner } from './unimported-banner';
import { songBytes } from './test/songs';
import { uniqueDbName } from './test-support';

const libraries: Library[] = [];
afterEach(async () => {
  for (const library of libraries.splice(0)) await library.dispose();
});

function setup(platform: Partial<Platform> = {}) {
  const storage = createMemoryStorage();
  const services = createTestServices({
    platform: fakePlatform({ ...storage.calls, ...platform }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
  libraries.push(library);
  provideLibrary(services, library);
  return { services, library, storage };
}

const picked = (name: string, bytes: Uint8Array, relativePath = name): PickedFile => ({
  name,
  relativePath,
  size: bytes.byteLength,
  read: () => Promise.resolve(bytes.slice()),
});

describe('open and import', () => {
  it('opens the file, then stores one song whose native keeps the open document track ids', async () => {
    const { services, library, storage } = setup();
    const bytes = await songBytes('Riff', 'gp');
    await library.openAndImport({ name: 'riff.gp', bytes });
    const { songId, score, dirty, canUndo, file } = services.document.getState();
    expect(score?.meta.title).toBe('Riff');
    expect(songId).toBeDefined();
    await waitFor(async () => {
      expect(await library.repo.all()).toHaveLength(1);
    });
    const [row] = await library.repo.all();
    expect(row).toMatchObject({
      id: songId,
      title: 'Riff',
      sourceFormat: 'gp',
      originalName: 'riff.gp',
      originalKey: file?.key,
    });
    const stored = storage.bytes(row?.nativePath ?? '');
    expect(stored).toBeDefined();
    expect((await read(stored ?? new Uint8Array())).score.tracks.map((t) => t.id)).toEqual(
      score?.tracks.map((t) => t.id),
    );
    expect(storage.bytes(row?.originalPath ?? '')).toEqual(bytes);
    expect({ dirty, canUndo }).toEqual({ dirty: false, canUndo: false });
    expect(library.store.getState().entries).toHaveLength(1);
  });

  it('opens a song already in the library as that song', async () => {
    const { services, library } = setup();
    const bytes = await songBytes('Riff');
    await library.openAndImport({ name: 'riff.reprise', bytes: bytes.slice() });
    await waitFor(async () => {
      expect(await library.repo.all()).toHaveLength(1);
    });
    const [row] = await library.repo.all();
    await library.openAndImport({ name: 'copy.reprise', bytes: bytes.slice() });
    await waitFor(() => {
      expect(services.document.getState().file?.name).toBe('riff.reprise');
    });
    expect(services.document.getState().songId).toBe(row?.id);
    expect(await library.repo.all()).toHaveLength(1);
  });

  it('keeps the file open, unimported, when a write fails', async () => {
    const { services, library } = setup({
      writeFile: () => Promise.reject(new Error('disk full')),
    });
    await library.openAndImport({ name: 'riff.reprise', bytes: await songBytes('Riff') });
    await waitFor(() => {
      expect(library.store.getState().error).toMatch(/disk full/);
    });
    expect(services.document.getState().score).toBeDefined();
    expect(services.document.getState().songId).toBeUndefined();
    expect(await library.repo.all()).toEqual([]);
  });

  it('opens a file that is not a score as an error and imports nothing', async () => {
    const { services, library } = setup();
    await library.openAndImport({ name: 'notes.txt', bytes: new TextEncoder().encode('hello') });
    expect(services.document.getState().error?.fileName).toBe('notes.txt');
    expect(await library.repo.all()).toEqual([]);
  });

  it('file.open: picks with the platform, and a cancel changes nothing', async () => {
    const bytes = await songBytes('Picked');
    const openFile = vi
      .fn<Platform['openFile']>()
      .mockResolvedValueOnce({ name: 'p.reprise', bytes })
      .mockResolvedValueOnce(undefined);
    const { services, library } = setup({ openFile });
    await library.openFile();
    expect(services.document.getState().file?.name).toBe('p.reprise');
    await library.openFile();
    expect(openFile).toHaveBeenCalledTimes(2);
    expect(services.document.getState().file?.name).toBe('p.reprise');
  });
});

describe('open without import and the banner', () => {
  it('shows the banner, and Import ties the document to a new song without marking it modified', async () => {
    const bytes = await songBytes('Loose', 'gp');
    const { services, library, storage } = setup({
      openFile: () => Promise.resolve({ name: 'loose.gp', bytes }),
    });
    renderWithServices(<UnimportedBanner />, services);
    expect(screen.queryByText('Not in your library')).not.toBeInTheDocument();
    await act(() => library.openFileWithoutImport());
    expect(services.document.getState().songId).toBeUndefined();
    expect(await screen.findByText('Not in your library')).toBeInTheDocument();
    expect(await library.repo.all()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(services.document.getState().songId).toBeDefined();
    });
    const state = services.document.getState();
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(false);
    expect(screen.queryByText('Not in your library')).not.toBeInTheDocument();
    const [row] = await library.repo.all();
    expect(row?.id).toBe(state.songId);
    expect(storage.bytes(row?.originalPath ?? '')).toEqual(bytes);
  });

  it('says so when the original is no longer held', async () => {
    const { services, library } = setup();
    const bytes = await songBytes('Loose');
    await services.document.getState().openBytes('loose.reprise', bytes);
    await library.importOpenDocument();
    expect(library.store.getState().error).toMatch(/no longer available/);
  });

  it('refuses to import a song that is already in the library', async () => {
    const { services, library } = setup();
    const bytes = await songBytes('Twice');
    await library.openAndImport({ name: 'a.reprise', bytes: bytes.slice() });
    await waitFor(async () => {
      expect(await library.repo.all()).toHaveLength(1);
    });
    await library.openWithoutImport({ name: 'a.reprise', bytes: bytes.slice() });
    await library.importOpenDocument();
    expect(library.store.getState().error).toMatch(/already in your library/);
    expect(services.document.getState().songId).toBeUndefined();
    expect(await library.repo.all()).toHaveLength(1);
  });
});

describe('batch import in the screen', () => {
  it('shows the progress and a summary, and lists the imported songs', async () => {
    const files = [
      picked('a.reprise', await songBytes('Alpha')),
      picked('b.reprise', await songBytes('Beta')),
      picked('bad.gp5', new TextEncoder().encode('nope')),
    ];
    const { services } = setup({ openFiles: () => Promise.resolve(files) });
    renderWithServices(<LibraryScreen />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Import files…' }));
    expect(await screen.findByText(/Imported 2 · 1 failed/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Import failures' })).toHaveTextContent('bad.gp5');
    expect(await screen.findByRole('option', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Imported 2/)).not.toBeInTheDocument();
  });

  it('shows a progress bar while it runs and cancels', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const alpha = await songBytes('Alpha');
    const slow: PickedFile = {
      name: 'a.reprise',
      relativePath: 'a.reprise',
      size: alpha.byteLength,
      read: async () => {
        await gate;
        return alpha.slice();
      },
    };
    const beta = picked('b.reprise', await songBytes('Beta'));
    const { services } = setup({ openFiles: () => Promise.resolve([slow, beta]) });
    renderWithServices(<LibraryScreen />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Import files…' }));
    const bar = await screen.findByRole('progressbar', { name: 'Import progress' });
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    release();
    expect(await screen.findByText(/Imported 1 · cancelled/)).toBeInTheDocument();
  });

  it('imports the files of a picked folder and reports a cut-short walk', async () => {
    const folder: PickedFolder = {
      name: 'tabs',
      files: [picked('a.reprise', await songBytes('Alpha'), 'tabs/a.reprise')],
      truncated: true,
      skipped: 1,
    };
    const { services } = setup({ openFolder: () => Promise.resolve(folder) });
    renderWithServices(<LibraryScreen />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Import folder…' }));
    expect(await screen.findByText(/Imported 1/)).toBeInTheDocument();
    expect(screen.getByText(/more files than one import takes/)).toBeInTheDocument();
    expect(screen.getByText(/1 folder could not be read/)).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('asks first, then moves the files to the trash and removes the row', async () => {
    const { services, library, storage } = setup({
      openFiles: async () => [picked('a.reprise', await songBytes('Alpha'))],
    });
    renderWithServices(<LibraryScreen />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Import files…' }));
    await screen.findByRole('option', { name: /Alpha/ });
    const [row] = await library.repo.all();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete “Alpha”?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await library.repo.all()).toHaveLength(1);

    screen.getByRole('listbox').focus();
    await userEvent.keyboard('{Delete}');
    await userEvent.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
    });
    expect(await library.repo.all()).toEqual([]);
    expect(storage.bytes(row?.nativePath ?? '')).toBeUndefined();
    expect(storage.paths()).toContain(`library/trash/${row?.id ?? ''}/song.json`);
  });

  it('turns the open song into an unimported one', async () => {
    const { services, library } = setup();
    await library.openAndImport({ name: 'a.reprise', bytes: await songBytes('Alpha') });
    await waitFor(async () => {
      expect(await library.repo.all()).toHaveLength(1);
    });
    const [row] = await library.repo.all();
    await library.deleteSong(row?.id ?? '');
    expect(services.document.getState().songId).toBeUndefined();
    expect(services.document.getState().score).toBeDefined();
    expect(library.store.getState().entries).toEqual([]);
  });
});

describe('recent songs', () => {
  it('lists the last opened songs on the empty state and opens one', async () => {
    const { services, library } = setup();
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      await library.openAndImport({ name: `${title}.reprise`, bytes: await songBytes(title) });
      await waitFor(async () => {
        expect((await library.repo.all()).some((row) => row.title === title)).toBe(true);
      });
    }
    services.document.getState().close();
    renderWithServices(<RecentSongs />, services);
    const list = await screen.findByRole('list', { name: 'Recent songs' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(within(list).getByRole('button', { name: /Beta/ }));
    await waitFor(() => {
      expect(services.document.getState().score?.meta.title).toBe('Beta');
    });
  });

  it('renders nothing when no song was opened', async () => {
    const { services } = setup();
    const { container } = renderWithServices(<RecentSongs />, services);
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('shows the library sorted by last opened', () => {
    const { services, library } = setup();
    library.showRecent();
    expect(library.store.getState().sort).toBe('lastOpened');
    expect(services.ui.getState().screen).toBe('library');
  });
});

describe('the native menu', () => {
  it('pushes the recents to the menu and opens a pick from it', async () => {
    let listener: (id: string) => void = () => undefined;
    const setRecentSongs = vi.fn();
    const { services, library } = setup({
      setRecentSongs,
      onOpenRecent: (next) => {
        listener = next;
        return () => undefined;
      },
    });
    const uninstall = installLibrary(services);
    await library.openAndImport({ name: 'Alpha.reprise', bytes: await songBytes('Alpha') });
    await waitFor(() => {
      expect(setRecentSongs).toHaveBeenLastCalledWith([
        { id: services.document.getState().songId, title: 'Alpha' },
      ]);
    });
    services.document.getState().close();
    listener(
      services.document.getState().songId ?? library.store.getState().entries[0]?.row.id ?? '',
    );
    await waitFor(() => {
      expect(services.document.getState().score?.meta.title).toBe('Alpha');
    });
    uninstall();
  });

  it('does nothing on a platform without a menu', () => {
    const { services } = setup();
    expect(() => {
      installLibrary(services)();
    }).not.toThrow();
  });
});
