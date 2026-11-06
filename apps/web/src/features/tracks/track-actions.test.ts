import { read, write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices, fakePlatform } from '@/test/services';

import {
  clearMuteSolo,
  commitPan,
  commitVolume,
  selectTrack,
  setProgram,
  setTrackNotation,
  setTrackVisible,
  toggleMultitrack,
  toggleMute,
  toggleSolo,
} from './track-actions';

const song = () => {
  const built = score().track('guitar', { name: 'Lead' }).track('bass').track('drums').build();
  // The file's own flags: Save must write them back as read.
  const [lead, bass, drums] = built.tracks;
  if (!lead || !bass || !drums) throw new Error('three tracks');
  return {
    ...built,
    tracks: [lead, { ...bass, channel: { ...bass.channel, mute: true } }, drums],
  } satisfies Score;
};

async function open(song: Score) {
  const writeHandle = vi.fn(() => Promise.resolve());
  const writeSpy = vi.fn(write);
  const services = createTestServices({
    platform: fakePlatform({ writeHandle }),
    write: writeSpy,
  });
  const bytes = (await write(song, 'reprise')).bytes;
  await services.document.getState().openBytes('song.reprise', bytes, 'song.reprise');
  const opened = services.document.getState().score;
  if (!opened) throw new Error('not opened');
  const ids = opened.tracks.map((track) => track.id);
  return { services, ids, writeSpy, writeHandle };
}

const trackOf = (services: Awaited<ReturnType<typeof open>>['services'], index: number) =>
  services.document.getState().score?.tracks[index];

describe('track actions', () => {
  it('commit volume as one undoable step, and none for the same value', async () => {
    const { services, ids } = await open(song());
    const [lead = ''] = ids;
    const { document } = services;

    commitVolume(services, lead, 40);
    expect(trackOf(services, 0)?.channel.volume).toBe(40);
    expect(document.getState()).toMatchObject({
      dirty: true,
      canUndo: true,
      undoLabel: 'setTrackProperties',
    });
    const { revision } = document.getState();
    commitVolume(services, lead, 40);
    expect(document.getState().revision).toBe(revision);

    document.getState().undo();
    expect(trackOf(services, 0)?.channel.volume).toBe(song().tracks[0]?.channel.volume);
    expect(document.getState().dirty).toBe(false);
  });

  it('commit pan and program as score edits', async () => {
    const { services, ids } = await open(song());
    const [lead = ''] = ids;
    commitPan(services, lead, 0);
    setProgram(services, lead, 30);
    expect(trackOf(services, 0)).toMatchObject({ program: 30, channel: { pan: 0 } });
    services.document.getState().undo();
    expect(trackOf(services, 0)?.program).toBe(song().tracks[0]?.program);
  });

  it('toggle mute and solo as session overrides, leaving the score alone', async () => {
    const { services, ids } = await open(song());
    const [lead = '', bass = ''] = ids;
    const before = services.document.getState().score;

    toggleMute(services, lead);
    toggleSolo(services, lead);
    // Bass is muted by its file, so its toggle unmutes it.
    toggleMute(services, bass);

    expect(services.fakeAudio.setTrack.mock.calls).toEqual([
      [lead, { mute: true }],
      [lead, { solo: true }],
      [bass, { mute: false }],
    ]);
    expect(services.document.getState().score).toBe(before);
    expect(services.document.getState().dirty).toBe(false);
  });

  it('clear only the tracks whose mute or solo is on', async () => {
    const { services, ids } = await open(song());
    const [lead = '', bass = ''] = ids;
    services.playback.setState({ mixer: { [lead]: { solo: true } } });

    clearMuteSolo(services);

    expect(services.fakeAudio.setTrack.mock.calls).toEqual([
      [lead, { mute: false, solo: false }],
      [bass, { mute: false, solo: false }],
    ]);
  });

  it('turn single-track view on for the current track, follow the selection, and off', async () => {
    const { services, ids } = await open(song());
    const [lead, bass = ''] = ids;
    const { document, selection } = services;

    toggleMultitrack(services);
    expect(document.getState().view.only).toBe(lead);
    selectTrack(services, bass);
    expect(selection.getState().currentTrack).toBe(bass);
    expect(document.getState().view.only).toBe(bass);
    toggleMultitrack(services);
    expect(document.getState().view).not.toHaveProperty('only');

    selectTrack(services, lead ?? '');
    expect(document.getState().view).not.toHaveProperty('only');
  });

  it('hide tracks but never the last one shown', async () => {
    const { services, ids } = await open(song());
    const [lead = '', bass = '', drums = ''] = ids;
    setTrackVisible(services, bass, false);
    setTrackVisible(services, drums, false);
    expect(services.document.getState().view.tracks).toEqual([lead]);
    setTrackVisible(services, lead, false);
    expect(services.document.getState().view.tracks).toEqual([lead]);
    setTrackVisible(services, bass, true);
    setTrackVisible(services, drums, true);
    expect(services.document.getState().view.tracks).toBe('all');
  });

  it('keep notation out of the history, mark the document modified, and drop the default', async () => {
    const { services, ids } = await open(song());
    const [lead = ''] = ids;
    const { document } = services;

    setTrackNotation(services, lead, 'both');
    expect(document.getState().view.notation).toEqual({ [lead]: 'both' });
    expect(document.getState()).toMatchObject({ dirty: true, canUndo: false });

    setTrackNotation(services, lead, 'tab');
    expect(document.getState().view.notation).toEqual({});
    expect(document.getState().dirty).toBe(false);
  });

  it('save volume, program and notation, and the file’s own mute and solo, never the toggles', async () => {
    const { services, ids, writeSpy, writeHandle } = await open(song());
    const [lead = '', bass = ''] = ids;
    const { document } = services;

    commitVolume(services, lead, 40);
    setProgram(services, lead, 30);
    setTrackNotation(services, lead, 'standard');
    services.playback.setState({ mixer: { [lead]: { solo: true }, [bass]: { mute: false } } });
    await document.getState().save();

    expect(writeHandle).toHaveBeenCalledOnce();
    expect(document.getState().dirty).toBe(false);
    const written = writeSpy.mock.calls.at(-1)?.[0];
    const { score: reopened } = await read((await write(written ?? song(), 'reprise')).bytes);
    expect(reopened.tracks[0]).toMatchObject({
      program: 30,
      channel: { volume: 40, solo: false, mute: false },
      display: { notation: 'standard' },
    });
    expect(reopened.tracks[1]?.channel).toMatchObject({ mute: true, solo: false });

    // After the save the view's notation is what the file holds, so nothing is modified.
    setTrackNotation(services, lead, 'tab');
    expect(document.getState().dirty).toBe(true);
    setTrackNotation(services, lead, 'standard');
    expect(document.getState().dirty).toBe(false);
  });

  it('write per-track notation into a Guitar Pro 7–8 file', async () => {
    const { services, ids, writeSpy } = await open(song());
    const [lead = ''] = ids;
    setTrackNotation(services, lead, 'both');
    services.document.setState({
      file: { name: 'song.gp', format: 'gp', handle: 'song.gp', key: 'k', savedKeys: [] },
    });

    await services.document.getState().save();

    const call = writeSpy.mock.calls.at(-1);
    expect(call?.[1]).toBe('gp');
    const { bytes } = await write(call?.[0] ?? song(), 'gp');
    const { score: reopened } = await read(bytes);
    expect(reopened.tracks[0]?.display.notation).toBe('both');
  });
});
