import { write } from '@reprise/formats';
import { setNote, type Score } from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

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

  it('lay out the visible tracks and their notation, and not on a selection', async () => {
    const services = createTestServices();
    const { document, layout, selection } = services;
    const three = score()
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
    await document.getState().openBytes('a.reprise', await bytes(three));
    const [t1 = '', t2 = '', t3 = ''] = document.getState().score?.tracks.map((t) => t.id) ?? [];
    const staves = () =>
      layout
        .getState()
        .result?.systems.flatMap((system) => system.staves.map((staff) => staff.track)) ?? [];
    const tracksShown = () => [...new Set(staves())];

    document.getState().setSingleTrack(t2);
    expect(tracksShown()).toEqual([t2]);

    document.getState().setSingleTrack(undefined);
    document.getState().setVisibleTracks([t1, t3]);
    expect(tracksShown()).toEqual([t1, t3]);

    const before = staves().filter((track) => track === t1).length;
    document.getState().setNotation(t1, 'both');
    expect(staves().filter((track) => track === t1).length).toBe(before * 2);

    const result = layout.getState().result;
    selection.getState().setCurrentTrack(t3);
    expect(layout.getState().result).toBe(result);
  });
});
