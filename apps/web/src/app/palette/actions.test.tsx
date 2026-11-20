import { write } from '@reprise/formats';
import { setTrackProperties } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { must } from '@/features/editor/test/must';
import { openLibraryDb } from '@/features/library/db/schema';
import {
  createLibrary,
  provideLibrary,
  settleLibraryWrites,
  type Library,
} from '@/features/library/library';
import { songBytes } from '@/features/library/test/songs';
import { uniqueDbName } from '@/features/library/test-support';
import { createMemoryStorage } from '@/test/memory-storage';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { UnsavedChangesHost } from '../unsaved-dialog';
import { goToBar, loopBars, openSong, pickTrack, showOnlyTrack } from './actions';

const BAR = 3840;

function song() {
  const builder = score().title('Palette').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < 8; bar++) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, beat)]);
  }
  builder.track('bass', { name: 'Rhythm' });
  for (let bar = 0; bar < 8; bar++) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, beat)]);
  }
  return builder.build();
}

async function open() {
  const services = createTestServices();
  mirrorAudio(services);
  await services.document.getState().openBytes('p.reprise', (await write(song(), 'reprise')).bytes);
  return services;
}

describe('goToBar', () => {
  it('seeks in play mode and selects the bar', async () => {
    const services = await open();
    goToBar(services, 3);
    expect(services.fakeAudio.seek).toHaveBeenCalledWith(3 * BAR);
    const bar = must(services.document.getState().score?.masterBars[3]);
    expect(services.selection.getState().barsAnchor).toBe(bar.id);
  });

  it('turns off a loop the bar is outside of', async () => {
    const services = await open();
    loopBars(services, 0, 1, 'x');
    goToBar(services, 5);
    expect(services.fakeAudio.setLoop).toHaveBeenLastCalledWith(undefined);
  });

  it('moves the cursor in edit mode and keeps the loop', async () => {
    const services = await open();
    services.editing.getState().setEditing(true);
    loopBars(services, 0, 1, 'x');
    goToBar(services, 5);
    expect(services.selection.getState().cursor?.at.bar).toBe(5);
    expect(services.playback.getState().settings.loop).toBeDefined();
  });
});

describe('goToBar announcements', () => {
  it('keeps the "not played" refusal instead of announcing the old position', async () => {
    // Bar 4 follows the Fine, which the D.C. al Fine stops at, so no pass plays it.
    const builder = score().track('guitar');
    builder.bar().beat('1', [note(1, 0)]);
    builder
      .bar()
      .target('fine')
      .beat('1', [note(1, 1)]);
    builder
      .bar()
      .jump('dcAlFine')
      .beat('1', [note(1, 2)]);
    builder.bar().beat('1', [note(1, 3)]);
    const services = createTestServices();
    mirrorAudio(services);
    await services.document
      .getState()
      .openBytes('u.reprise', (await write(builder.build(), 'reprise')).bytes);
    services.fakeAudio.seek.mockClear();
    goToBar(services, 3);
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.transport.getState().announcement?.text).toBe('Bar 4 is not played');
  });

  it('announces the position after a seek', async () => {
    const services = await open();
    goToBar(services, 3);
    expect(services.transport.getState().announcement?.text).toMatch(/^Bar 4/);
  });

  it('does not announce a playhead that edit mode left where it was outside a loop', async () => {
    const services = await open();
    services.editing.getState().setEditing(true);
    loopBars(services, 0, 1, 'x');
    const before = services.transport.getState().announcement;
    goToBar(services, 5);
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(0);
    expect(services.transport.getState().announcement).toBe(before);
  });
});

describe('loopBars', () => {
  it('sets the selection and the loop, moves to the start and announces', async () => {
    const services = await open();
    loopBars(services, 2, 3, 'Chorus 2');
    const { masterBars } = must(services.document.getState().score);
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: must(masterBars[2]).id,
      endBar: must(masterBars[3]).id,
    });
    expect(services.selection.getState().bars?.startBar).toBe(must(masterBars[2]).id);
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(2 * BAR);
    expect(services.transport.getState().announcement?.text).toBe('Looping Chorus 2, bars 3 to 4');
  });

  it('keeps the old loop and says why when the engine refuses', async () => {
    const services = await open();
    loopBars(services, 0, 1, 'first');
    const before = services.playback.getState().settings.loop;
    const refused = must(services.document.getState().score?.masterBars[4]).id;
    services.fakeAudio.setLoop.mockImplementation((loop) => {
      if (loop?.startBar === refused) throw new RangeError('never in that order');
      services.playback.setState({ settings: { ...services.playback.getState().settings, loop } });
    });
    loopBars(services, 4, 5, 'second');
    expect(services.playback.getState().settings.loop).toEqual(before);
    expect(services.transport.getState().announcement?.text).toMatch(/can’t be looped/);
  });
});

describe('loopBars in edit mode', () => {
  it('puts the caret on the first stop and keeps bars in step with a bars range', async () => {
    const services = await open();
    services.editing.getState().setEditing(true);
    loopBars(services, 2, 3, 'Chorus 2');
    const { masterBars } = must(services.document.getState().score);
    const state = services.selection.getState();
    expect(state.cursor?.at.bar).toBe(2);
    expect(state.range?.kind).toBe('bars');
    expect(state.bars).toEqual({
      startBar: must(masterBars[2]).id,
      endBar: must(masterBars[3]).id,
    });
    expect(state.barsAnchor).toBe(must(masterBars[2]).id);
    expect(services.playback.getState().settings.loop).toEqual(state.bars);
  });

  it('leaves the selection alone and announces the refusal once', async () => {
    const services = await open();
    services.editing.getState().setEditing(true);
    goToBar(services, 1);
    const before = services.selection.getState();
    const refused = must(services.document.getState().score?.masterBars[4]).id;
    services.fakeAudio.setLoop.mockImplementation((loop) => {
      if (loop?.startBar === refused) throw new RangeError('never in that order');
    });
    const announced: (string | undefined)[] = [];
    services.transport.subscribe((state) => announced.push(state.announcement?.text));
    loopBars(services, 4, 5, 'second');
    const after = services.selection.getState();
    expect(after.cursor).toBe(before.cursor);
    expect(after.range).toBe(before.range);
    expect(after.bars).toBe(before.bars);
    expect(announced.filter((text) => text?.includes('can’t be looped'))).toHaveLength(1);
  });
});

describe('tracks', () => {
  it('pickTrack shows a hidden track and selects it', async () => {
    const services = await open();
    const [lead, rhythm] = must(services.document.getState().score).tracks;
    services.document.getState().setVisibleTracks([must(lead).id]);
    pickTrack(services, must(rhythm).id);
    expect(services.document.getState().view.tracks).toBe('all');
    expect(services.selection.getState().currentTrack).toBe(must(rhythm).id);
  });

  it('showOnlyTrack makes it the single track', async () => {
    const services = await open();
    const rhythm = must(services.document.getState().score?.tracks[1]);
    showOnlyTrack(services, rhythm.id);
    expect(services.document.getState().view.only).toBe(rhythm.id);
  });
});

const libraries: Library[] = [];
afterEach(async () => {
  for (const library of libraries.splice(0)) await library.dispose();
});

describe('openSong', () => {
  async function setupLibrary() {
    const services = createTestServices({
      platform: fakePlatform({ ...createMemoryStorage().calls }),
    });
    mirrorAudio(services);
    const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
    libraries.push(library);
    provideLibrary(services, library);
    renderWithServices(<UnsavedChangesHost />, services);
    await library.openAndImport({ name: 'a.reprise', bytes: await songBytes('A') });
    await library.openAndImport({ name: 'b.reprise', bytes: await songBytes('B') });
    await settleLibraryWrites();
    const rows = await library.repo.all();
    return { services, library, a: must(rows.find((row) => row.title === 'A')) };
  }

  it('does not reopen the open song', async () => {
    const { services, a, library } = await setupLibrary();
    await library.openSong(a.id);
    const before = services.document.getState().id;
    services.ui.getState().showSheet('library');
    openSong(services, a.id);
    expect(services.ui.getState().sheet).toBeUndefined();
    expect(services.document.getState().id).toBe(before);
  });

  it('asks about unsaved changes and Cancel keeps the document', async () => {
    const { services, a } = await setupLibrary();
    const { document } = services;
    act(() => {
      document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: must(document.getState().score?.tracks[0]).id },
            { name: 'Edited' },
          ),
        );
    });
    const before = document.getState().id;
    openSong(services, a.id);
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.getState().id).toBe(before);
    expect(document.getState().dirty).toBe(true);
  });

  it('shows a notice when the song cannot be opened', async () => {
    const { services, library } = await setupLibrary();
    openSong(services, 'no-such-song');
    await act(async () => {
      await settleLibraryWrites();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(library.store.getState().notice?.kind).toBe('error');
  });
});
