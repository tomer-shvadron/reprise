import { write } from '@reprise/formats';
import { setMasterBar } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { openLibraryDb } from '@/features/library/db/schema';
import { createLibrary, provideLibrary } from '@/features/library/library';
import { entryOf } from '@/features/library/search';
import { rowOf, uniqueDbName } from '@/features/library/test-support';
import { rankSongs } from '@/features/library';
import { rankTracks } from '@/features/tracks';
import { rankSections } from '@/features/transport';

import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { must } from '@/features/editor/test/must';

import { createAppRegistry } from './app-registry';
import { CommandPalette } from './command-palette';
import { CommandRegistry } from './command-registry';
import { formatShortcut } from './keyboard';

vi.mock('@/features/transport', async (original) => {
  const actual = await original<typeof import('@/features/transport')>();
  return { ...actual, rankSections: vi.fn(actual.rankSections) };
});
vi.mock('@/features/tracks', async (original) => {
  const actual = await original<typeof import('@/features/tracks')>();
  return { ...actual, rankTracks: vi.fn(actual.rankTracks) };
});
vi.mock('@/features/library', async (original) => {
  const actual = await original<typeof import('@/features/library')>();
  return { ...actual, rankSongs: vi.fn(actual.rankSongs) };
});

const KEY = formatShortcut({ key: 'ArrowLeft' }, 'other');

function setup(editing: boolean) {
  const services = createTestServices();
  const { ui } = services;
  ui.getState().setPaletteOpen(true);
  const registry = new CommandRegistry(() => editing);
  registry.register({
    id: 'transport.back',
    title: 'Back',
    shortcut: { key: 'ArrowLeft' },
    run: () => undefined,
  });
  registry.register({
    id: 'editor.left',
    title: 'Cursor left',
    shortcut: { key: 'ArrowLeft' },
    context: 'editing',
    run: () => undefined,
  });
  render(<CommandPalette registry={registry} ui={ui} keyboard="other" services={services} />);
}

describe('command palette contexts', () => {
  it('hides editing commands in play mode and shows the transport key', () => {
    setup(false);
    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.queryByText('Cursor left')).toBeNull();
    expect(screen.getAllByText(KEY)).toHaveLength(1);
  });

  it('lists editing commands while editing and shows each key once, on the one that fires', () => {
    setup(true);
    expect(screen.getByText('Cursor left')).toBeTruthy();
    const keys = screen.getAllByText(KEY);
    expect(keys).toHaveLength(1);
    expect(screen.getByText('Cursor left').parentElement?.contains(keys[0] ?? null)).toBe(true);
  });
});

describe('the palette with the real commands', () => {
  it('runs Bar properties, not Undo, after a Bar properties edit', async () => {
    const services = createTestServices();
    const built = score().track('guitar');
    built.bar();
    await services.document
      .getState()
      .openBytes('p.reprise', (await write(built.build(), 'reprise')).bytes);
    services.editing.getState().setEditing(true);
    const masterBar = must(services.document.getState().score?.masterBars[0]);
    services.document
      .getState()
      .apply(setMasterBar({ masterBarId: masterBar.id }, { repeat: { start: true, endCount: 0 } }));
    expect(services.document.getState().historyLabels.undo).toHaveLength(1);
    const registry = createAppRegistry(services);
    services.ui.getState().setPaletteOpen(true);
    render(
      <CommandPalette registry={registry} ui={services.ui} keyboard="other" services={services} />,
    );
    const input = await screen.findByPlaceholderText('Type a command…');
    // The step's label is in the Undo title but not in what the palette searches.
    expect(screen.getByText('Undo Bar properties')).toBeTruthy();
    await userEvent.type(input, 'Bar properties');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toMatch(/^Bar properties/);
    expect(options.some((text) => text.startsWith('Undo'))).toBe(false);
    await userEvent.keyboard('{Enter}');
    expect(services.document.getState().historyLabels.undo).toHaveLength(1);
    expect(services.document.getState().historyLabels.redo).toHaveLength(0);
  });
});

const BAR = 3840;

function sectioned(bars = 8) {
  const builder = score().title('Sections').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < bars; bar++) {
    builder.bar();
    if (bar === 0) builder.section('Intro');
    if (bar === 2) builder.section('Verse');
    if (bar === 4) builder.section('Chorus');
    if (bar === 6) builder.section('Chorus');
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, beat)]);
  }
  builder.track('bass', { name: 'Rhythm' });
  for (let bar = 0; bar < bars; bar++) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, beat)]);
  }
  return builder.build();
}

async function setupReal(bars = 8) {
  const services = createTestServices();
  mirrorAudio(services);
  await services.document
    .getState()
    .openBytes('s.reprise', (await write(sectioned(bars), 'reprise')).bytes);
  const registry = createAppRegistry(services);
  const user = userEvent.setup();
  const utils = render(
    <CommandPalette registry={registry} ui={services.ui} keyboard="other" services={services} />,
  );
  return { services, user, registry, ...utils };
}

const optionNames = () => screen.queryAllByRole('option').map((option) => option.textContent);

describe('palette prefixes', () => {
  it('# lists sections; Enter goes there and Ctrl+Enter loops it', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    const input = await screen.findByPlaceholderText('Type a command…');
    await user.type(input, '#ch2');
    expect(screen.getByText('Sections')).toBeTruthy();
    expect(optionNames()).toHaveLength(1);
    expect(optionNames()[0]).toMatch(/^Chorus 2/);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const { masterBars } = must(services.document.getState().score);
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: must(masterBars[6]).id,
      endBar: must(masterBars[7]).id,
    });
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(6 * BAR);
    expect(services.ui.getState().paletteOpen).toBe(false);
  });

  it('# with Enter goes to the section without a loop', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    await user.type(await screen.findByPlaceholderText('Type a command…'), '#verse{Enter}');
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(2 * BAR);
    expect(services.playback.getState().settings.loop).toBeUndefined();
  });

  it('@ selects a track', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    await user.type(await screen.findByPlaceholderText('Type a command…'), '@rhy{Enter}');
    expect(services.selection.getState().currentTrack).toBe(
      must(services.document.getState().score?.tracks[1]).id,
    );
  });

  it('a number goes to that bar; an out-of-range one is a message, not an option', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    const input = await screen.findByPlaceholderText('Type a command…');
    await user.type(input, '99');
    expect(screen.getAllByText('This song has 8 bars.').length).toBeGreaterThan(0);
    expect(optionNames()).toEqual([]);
    await user.clear(input);
    await user.type(input, '4{Enter}');
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(3 * BAR);
  });

  it('/ lists the library songs', async () => {
    const { services, user } = await setupReal();
    const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
    provideLibrary(services, library);
    library.store.setState({
      loaded: true,
      entries: [entryOf(rowOf({ title: 'Blue Bossa' })), entryOf(rowOf({ title: 'Red House' }))],
    });
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    await user.type(await screen.findByPlaceholderText('Type a command…'), '/red');
    expect(optionNames()).toEqual(['Red HouseArtist · Album']);
    await library.dispose();
  });

  it('describes its prefixes in the hint, and the input points at it', async () => {
    const { services } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    const input = await screen.findByPlaceholderText('Type a command…');
    expect(input.getAttribute('aria-describedby')).toBe('palette-hint');
    const hint = must(document.getElementById('palette-hint') ?? undefined);
    expect(hint.textContent).toContain('sections');
    expect(hint.textContent).toContain('tracks');
    expect(screen.getByRole('button', { name: 'Search sections, type #' })).toBeTruthy();
  });

  it('opens locked in bar mode, and Backspace on an empty input unlocks it', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().openPalette('bar');
    });
    const input = await screen.findByPlaceholderText('Bar number (1–8)');
    expect(input.getAttribute('aria-label')).toBe('Go to bar, 1 to 8');
    await user.type(input, '3a');
    expect((input as HTMLInputElement).value).toBe('3');
    await user.keyboard('{Backspace}{Backspace}');
    expect(screen.getByPlaceholderText('Type a command…')).toBeTruthy();
  });

  it('switches mode in place when Go to bar… is picked from the list', async () => {
    const { services, user } = await setupReal();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    await user.type(await screen.findByPlaceholderText('Type a command…'), 'go to bar');
    await user.keyboard('{Enter}');
    expect(await screen.findByPlaceholderText('Bar number (1–8)')).toBeTruthy();
    expect(services.ui.getState().paletteOpen).toBe(true);
  });
});

describe('opening the palette costs nothing extra', () => {
  it('runs no provider and reads no library on open', async () => {
    const { services } = await setupReal();
    const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
    provideLibrary(services, library);
    const getState = vi.spyOn(library.store, 'getState');
    const subscribe = vi.spyOn(library.store, 'subscribe');
    vi.mocked(rankSections).mockClear();
    vi.mocked(rankTracks).mockClear();
    vi.mocked(rankSongs).mockClear();
    act(() => {
      services.ui.getState().setPaletteOpen(true);
    });
    await screen.findByPlaceholderText('Type a command…');
    expect(
      screen
        .getAllByRole('option')
        .every((option) => option.getAttribute('data-value')?.includes('.')),
    ).toBe(true);
    expect(rankSections).not.toHaveBeenCalled();
    expect(rankTracks).not.toHaveBeenCalled();
    expect(rankSongs).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    await library.dispose();
  });

  it('does not render while closed, across an edit and a playhead move', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    await services.document
      .getState()
      .openBytes('s.reprise', (await write(sectioned(), 'reprise')).bytes);
    const registry = createAppRegistry(services);
    let renders = 0;
    render(
      <Profiler
        id="palette"
        onRender={() => {
          renders += 1;
        }}
      >
        <CommandPalette registry={registry} ui={services.ui} keyboard="other" services={services} />
      </Profiler>,
    );
    const before = renders;
    act(() => {
      services.document
        .getState()
        .apply(
          setMasterBar(
            { masterBarId: must(services.document.getState().score?.masterBars[0]).id },
            { repeat: { start: true, endCount: 0 } },
          ),
        );
      services.fakeAudio.seek(BAR);
    });
    expect(renders).toBe(before);
  });
});
