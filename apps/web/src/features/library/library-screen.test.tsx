import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setTrackVisible } from '@/features/tracks/track-actions';
import { installPracticeLog } from '@/features/trainer';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { createLibrary, provideLibrary, type Library } from './library';
import { LibraryScreen } from './library-screen';
import { openLibraryDb } from './db/schema';
import { LIBRARY_SORT_SETTING } from './search';
import { installSettings } from './db/settings-backend';
import { createSettingsStore } from '@/state/settings';
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
  const db = openLibraryDb(dbName);
  const services = createTestServices({
    // Over the real table, so the sort survives only if it was written there.
    settings: createSettingsStore(),
    platform: fakePlatform({
      readFile: (path) => {
        const bytes = files.get(path);
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('ENOENT'));
      },
    }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db });
  installSettings(services, db);
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
    expect(services.settings.get(LIBRARY_SORT_SETTING)).toBe('artist');
    expect(await services.settings.settled()).toBe(true);
    // A relaunch: new services and a new store over the same database.
    const reopened = setup(dbName);
    const again = reopened.library;
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

  it('always mounts the active row and starts again from the top when the search changes', async () => {
    const { services, library } = setup();
    await library.db.songs.bulkAdd(
      Array.from({ length: 3000 }, (_, index) => rowOf({ title: `Song ${String(index)}` })),
    );
    renderWithServices(<LibraryScreen />, services);
    const list = await screen.findByRole('listbox', { name: 'Songs' });
    list.focus();
    const named = () => document.getElementById(list.getAttribute('aria-activedescendant') ?? '');
    for (const key of ['{End}', '{PageUp}', '{PageDown}']) {
      await userEvent.keyboard(key);
      expect(named()).not.toBeNull();
    }
    fireEvent.scroll(list, { target: { scrollTop: 0 } });
    expect(named()).not.toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), '12');
    expect(list.getAttribute('aria-activedescendant')).toBe(
      within(list).getAllByRole('option')[0]?.id,
    );
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

  it('keeps the on-screen song keeper running when another song fails to open', async () => {
    const { services, library } = setup();
    const a = await addSong(library, 'Alpha');
    const broken = rowOf({ title: 'Broken' });
    files.set(broken.nativePath, new Uint8Array([1, 2, 3]));
    await library.repo.add(broken);
    await library.openSong(a.id);
    await library.openSong(broken.id);
    expect(services.document.getState().songId).toBe(a.id);
    const lead = services.document.getState().score?.tracks[0]?.id ?? '';
    services.audio.setTrack(lead, { mute: true });
    await waitFor(async () => {
      expect((await library.repo.get(a.id))?.session?.mixer).toEqual({ [lead]: { mute: true } });
    });
  });

  it('restores the latest session when the open song is reopened inside the debounce', async () => {
    const { services, library } = setup();
    const row = await addSong(library, 'Alpha');
    await library.openSong(row.id);
    const lead = services.document.getState().score?.tracks[0]?.id ?? '';
    services.audio.setTrack(lead, { mute: true });
    services.fakeAudio.setTrack.mockClear();
    await library.openSong(row.id);
    expect(services.fakeAudio.setTrack).toHaveBeenCalledWith(lead, { mute: true });
  });

  it('shows an error instead of rejecting when the database fails', async () => {
    const { services, library } = setup();
    const row = await addSong(library, 'Alpha');
    vi.spyOn(library.repo, 'get').mockRejectedValue(new Error('disk gone'));
    await expect(library.openSong(row.id)).resolves.toBeUndefined();
    expect(library.store.getState().error).toMatch(/disk gone/);
    expect(services.document.getState().score).toBeUndefined();
  });
});

describe('the practice log page', () => {
  async function withLog() {
    const { services, library } = setup();
    const alpha = await addSong(library, 'Alpha');
    const beta = await addSong(library, 'Beta');
    for (const song of [alpha, beta]) {
      await library.db.practiceSessions.add({
        id: `LOG${song.id.slice(3)}`,
        songId: song.id,
        startedAt: 1000,
        endedAt: 301_000,
        playedMs: 5 * 60_000,
        loops: [],
        tempoHistory: [],
      });
    }
    cleanups.push(installPracticeLog(services, library.db.practiceSessions));
    renderWithServices(<LibraryScreen />, services);
    await screen.findByRole('option', { name: /Alpha/ });
    return { services, alpha, beta };
  }
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  const listbox = () => screen.getByRole('listbox', { name: 'Songs' });

  it('opens from a row, closes on Escape even after a click on its text, and refocuses the row', async () => {
    const { beta } = await withLog();
    await userEvent.click(screen.getByRole('button', { name: 'Practice log for Beta' }));
    expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
    expect((await screen.findAllByText('5 min')).length).toBeGreaterThan(0);

    // A click on plain text moves focus off the heading; Escape must still close the page.
    await userEvent.click(await screen.findByText(/Total practice time/));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Beta' })).not.toBeInTheDocument();
    expect(listbox()).toHaveFocus();
    expect(listbox()).toHaveAttribute('aria-activedescendant', `song-${beta.id}`);
  });

  it('returns focus to the list on the same row after Back', async () => {
    const { beta } = await withLog();
    await userEvent.click(screen.getByRole('button', { name: 'Practice log for Beta' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(listbox()).toHaveFocus();
    expect(listbox()).toHaveAttribute('aria-activedescendant', `song-${beta.id}`);
  });

  it('opens the active row’s page with L from the list', async () => {
    await withLog();
    listbox().focus();
    await userEvent.keyboard('{ArrowDown}l');
    expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });
});
