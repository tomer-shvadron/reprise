import { write } from '@reprise/formats';
import { setNote, type Score } from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';
import { createSettingsStore } from '@/state/settings';
import { DEFAULT_NOTATION_STRINGS_SETTING } from '@/state/app-settings';
import { readFixture } from '@/test/read-fixture';
import { createTestServices } from '@/test/services';

async function bytes(song: Score) {
  return (await write(song, 'reprise')).bytes;
}

const twoTracks = () =>
  score()
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .track('bass')
    .bar()
    .beat('1', [note(1, 0)])
    .build();

const threeTracks = () =>
  score()
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .track('bass')
    .bar()
    .beat('1', [note(1, 0)])
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .build();

type Services = ReturnType<typeof createTestServices>;

const staves = ({ layout }: Services) =>
  layout
    .getState()
    .result?.systems.flatMap((system) => system.staves.map((staff) => staff.track)) ?? [];
const tracksShown = (services: Services) => [...new Set(staves(services))];

describe('the notation defaults at open', () => {
  const notations = (services: Services) =>
    services.document.getState().score?.tracks.map((track) => track.display.notation);

  it('apply to a file that chooses no notation, and leave the document clean', async () => {
    const settings = createTestSettings();
    await settings.whenHydrated();
    settings.set(DEFAULT_NOTATION_STRINGS_SETTING, 'both');
    const services = createTestServices({ settings });

    await services.document.getState().openBytes('notes.gp4', readFixture('gp4/notes.gp4'));

    expect(new Set(notations(services))).toEqual(new Set(['both']));
    const state = services.document.getState();
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(false);
  });

  it('never override the notation a file states', async () => {
    const settings = createTestSettings();
    await settings.whenHydrated();
    settings.set(DEFAULT_NOTATION_STRINGS_SETTING, 'both');
    const services = createTestServices({ settings });

    await services.document.getState().openBytes('staves.gp5', readFixture('gp5/staves.gp5'));

    const shown = new Set(notations(services));
    expect(shown).toEqual(new Set(['tab', 'standard', 'both']));
  });

  it('wait for the stored settings to load', async () => {
    let release: () => void = () => undefined;
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = {
      ...createMemorySettingsBackend(),
      load: async () => {
        await loaded;
        return new Map<string, unknown>([['score.defaultNotationStrings', 'standard']]);
      },
    };
    const settings = createSettingsStore({ local: () => window.localStorage });
    const services = createTestServices({ settings });
    void settings.attach(backend);
    let opened = false;
    const opening = services.document
      .getState()
      .openBytes('notes.gp4', readFixture('gp4/notes.gp4'))
      .then(() => {
        opened = true;
      });
    // Let the read finish; only the settings are still missing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(opened).toBe(false);

    release();
    await opening;
    expect(new Set(notations(services))).toEqual(new Set(['standard']));
  });
});

describe('the app services', () => {
  it('tell the audio service about every open, edit and close', async () => {
    const services = createTestServices();
    const { document, fakeAudio } = services;

    await document.getState().openBytes('a.reprise', await bytes(twoTracks()));
    const { id, score: opened } = document.getState();
    expect(fakeAudio.setDocument).toHaveBeenLastCalledWith({ id, score: opened });

    if (!opened) throw new Error('no score');
    document
      .getState()
      .apply(setNote({ beatId: beatOf(opened, 0, 0, 0).id }, { string: 1, fret: 3 }));
    expect(fakeAudio.setDocument).toHaveBeenLastCalledWith({
      id,
      score: document.getState().score,
    });

    document.getState().setNotation(opened.tracks[0]?.id ?? '', 'tab');
    expect(fakeAudio.setDocument).toHaveBeenCalledTimes(2);

    document.getState().close();
    expect(fakeAudio.setDocument).toHaveBeenLastCalledWith(undefined);
  });

  it('reset the selection to the new first track on a switch', async () => {
    const services = createTestServices();
    const { document, selection } = services;
    await document.getState().openBytes('a.reprise', await bytes(twoTracks()));
    selection.getState().setCurrentTrack(document.getState().score?.tracks[1]?.id);
    selection.getState().select({ noteIds: ['n'] });

    await document.getState().openBytes('b.reprise', await bytes(twoTracks()));

    expect(selection.getState().currentTrack).toBe(document.getState().score?.tracks[0]?.id);
    expect(selection.getState().selection).toEqual({});
  });

  it('stop calling the audio service once disposed', async () => {
    const services = createTestServices();
    services.dispose();

    await services.document.getState().openBytes('a.reprise', await bytes(twoTracks()));

    expect(services.fakeAudio.setDocument).not.toHaveBeenCalled();
    expect(services.fakeAudio.dispose).toHaveBeenCalledOnce();
  });

  it('open a multi-track score with every track shown and sent to the audio service', async () => {
    const services = createTestServices();
    const { document, fakeAudio } = services;
    const three = threeTracks();

    await document.getState().openBytes('a.reprise', await bytes(three));

    const ids = document.getState().score?.tracks.map((t) => t.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(document.getState().view).toEqual({ tracks: 'all', notation: {} });
    expect(tracksShown(services)).toEqual(ids);
    const lastCall = fakeAudio.setDocument.mock.lastCall?.[0];
    expect(lastCall?.score.tracks.map((t) => t.id)).toEqual(ids);
  });

  it('lay out the visible tracks and their notation, and not on a selection', async () => {
    const services = createTestServices();
    const { document, layout, selection } = services;
    const three = threeTracks();
    await document.getState().openBytes('a.reprise', await bytes(three));
    const [t1 = '', t2 = '', t3 = ''] = document.getState().score?.tracks.map((t) => t.id) ?? [];
    document.getState().setSingleTrack(t2);
    expect(tracksShown(services)).toEqual([t2]);

    document.getState().setSingleTrack(undefined);
    document.getState().setVisibleTracks([t1, t3]);
    expect(tracksShown(services)).toEqual([t1, t3]);

    const before = staves(services).filter((track) => track === t1).length;
    document.getState().setNotation(t1, 'both');
    expect(staves(services).filter((track) => track === t1).length).toBe(before * 2);

    const result = layout.getState().result;
    selection.getState().setCurrentTrack(t3);
    expect(layout.getState().result).toBe(result);
  });
});
