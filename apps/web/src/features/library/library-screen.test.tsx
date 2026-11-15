import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setTrackVisible } from '@/features/tracks/track-actions';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { createLibrary, provideLibrary, type Library } from './library';
import { LibraryScreen } from './library-screen';
import { openLibraryDb } from './db/schema';
import { rowOf, uniqueDbName } from './test-support';

const files = new Map<string, Uint8Array>();
const libraries: Library[] = [];

afterEach(async () => {
  files.clear();
  for (const library of libraries.splice(0)) await library.dispose();
});

async function nativeSong(title: string) {
  const built = score().title(title).track('guitar').track('bass').build();
  return (await write(built, 'reprise')).bytes;
}

function setup(dbName = uniqueDbName()) {
  const services = createTestServices({
    platform: fakePlatform({
      readFile: (path) => {
        const bytes = files.get(path);
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('ENOENT'));
      },
    }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(dbName) });
  libraries.push(library);
  provideLibrary(services, library);
  return { services, library, dbName };
}

async function addSong(library: Library, title: string, extra = {}) {
  const row = rowOf({ title, ...extra });
  files.set(row.nativePath, await nativeSong(title));
  await library.repo.add(row);
  return row;
}

describe('the library screen', () => {
  it('lists the columns of each song and offers a search and a sort', async () => {
    const { services, library } = setup();
    await addSong(library, 'Alpha', { artist: 'Ada', album: 'First', sourceFormat: 'gp4' });
    renderWithServices(<LibraryScreen />, services);
    const row = await screen.findByRole('option', { name: /Alpha/ });
    expect(row).toHaveTextContent('Ada');
    expect(row).toHaveTextContent('First');
    expect(row).toHaveTextContent(/gp4/i);
    expect(row).toHaveTextContent('Never');
    expect(screen.getByRole('searchbox', { name: 'Search songs' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('title');
  });

  it('says so when the library is empty', async () => {
    const { services } = setup();
    renderWithServices(<LibraryScreen />, services);
    expect(await screen.findByText(/library is empty/i)).toBeInTheDocument();
  });

  it('filters as you type and says when nothing matches', async () => {
    const { services, library } = setup();
    await addSong(library, 'Alpha');
    await addSong(library, 'Beta');
    renderWithServices(<LibraryScreen />, services);
    await screen.findByRole('option', { name: /Alpha/ });
    await userEvent.type(screen.getByRole('searchbox'), 'bet');
    const list = screen.getByRole('listbox', { name: 'Songs' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('Beta');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/No songs match/)).toBeInTheDocument();
  });

  it('keeps the chosen sort across a reload', async () => {
    const { services, library, dbName } = setup();
    await addSong(library, 'Alpha', { artist: 'Zed' });
    await addSong(library, 'Beta', { artist: 'Amy' });
    renderWithServices(<LibraryScreen />, services);
    await screen.findByRole('option', { name: /Alpha/ });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'artist');
    const order = () =>
      within(screen.getByRole('listbox', { name: 'Songs' }))
        .getAllByRole('option')
        .map((option) => option.textContent);
    expect(order()[0]).toContain('Beta');
    await waitFor(async () => {
      expect(await library.repo.getSetting('library.sort')).toBe('artist');
    });
    const again = createLibrary(services, { db: openLibraryDb(dbName) });
    libraries.push(again);
    await again.load();
    expect(again.store.getState().sort).toBe('artist');
  });

  it('opens the focused song on Enter and leaves the library screen', async () => {
    const { services, library } = setup();
    const row = await addSong(library, 'Alpha');
    services.ui.getState().setScreen('library');
    renderWithServices(<LibraryScreen />, services);
    await screen.findByRole('option', { name: /Alpha/ });
    screen.getByRole('listbox').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(services.ui.getState().screen).toBe('player');
    });
    expect(services.document.getState().songId).toBe(row.id);
    expect(services.document.getState().file?.name).toBe('song.reprise');
    expect((await library.repo.get(row.id))?.lastOpenedAt).toBeGreaterThan(0);
  });

  it('moves with the arrow keys and opens a song on double-click', async () => {
    const { services, library } = setup();
    await addSong(library, 'Alpha');
    const beta = await addSong(library, 'Beta');
    renderWithServices(<LibraryScreen />, services);
    const list = await screen.findByRole('listbox');
    list.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Beta/ })).toHaveAttribute('aria-selected', 'true');
    expect(list).toHaveAttribute('aria-activedescendant', `song-${beta.id}`);
    await userEvent.dblClick(screen.getByRole('option', { name: /Alpha/ }));
    await waitFor(() => {
      expect(services.document.getState().songId).not.toBeUndefined();
    });
  });

  it('shows an error when the native file is missing and opens nothing', async () => {
    const { services, library } = setup();
    const row = rowOf({ title: 'Ghost' });
    await library.repo.add(row);
    renderWithServices(<LibraryScreen />, services);
    await userEvent.dblClick(await screen.findByRole('option', { name: /Ghost/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing/i);
    expect(services.document.getState().score).toBeUndefined();
  });

  it('mounts only the rows in view for a large library', async () => {
    const { services, library } = setup();
    await library.db.songs.bulkAdd(
      Array.from({ length: 3000 }, (_, index) => rowOf({ title: `Song ${String(index)}` })),
    );
    renderWithServices(<LibraryScreen />, services);
    const list = await screen.findByRole('listbox', { name: 'Songs' });
    const rows = within(list).getAllByRole('option');
    expect(rows.length).toBeLessThan(60);
    expect(rows[0]).toHaveAttribute('aria-setsize', '3000');
  });
});

describe('reopening a song', () => {
  it('restores its track session without marking the document modified', async () => {
    const { services, library } = setup();
    const row = await addSong(library, 'Alpha');
    await library.openSong(row.id);
    const [lead = '', bass = ''] =
      services.document.getState().score?.tracks.map((t) => t.id) ?? [];
    setTrackVisible(services, bass, false);
    services.audio.setTrack(lead, { mute: true });
    await waitFor(async () => {
      expect((await library.repo.get(row.id))?.session?.mixer).toEqual({ [lead]: { mute: true } });
    });

    services.document.getState().close();
    services.playback.setState({ mixer: {} });
    await library.openSong(row.id);

    const state = services.document.getState();
    expect(state.view.tracks).toEqual([lead]);
    expect(services.playback.getState().mixer[lead]).toMatchObject({ mute: true });
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(false);
    expect(state.songId).toBe(row.id);
  });
});
