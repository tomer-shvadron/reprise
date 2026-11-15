import { score, note } from '@reprise/model/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlaybackStore } from '@/state/playback';

import { createAudioService } from './audio-service';

const engine = vi.hoisted(() => ({
  previewNote: vi.fn<(...args: unknown[]) => void>(),
  unlock: vi.fn(),
  setGmTierBypass: vi.fn<(on: boolean) => void>(),
  load: vi.fn(() => Promise.resolve({ instruments: [] })),
}));

vi.mock('@reprise/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reprise/audio')>();
  return {
    ...actual,
    Sf2Soundfont: { parse: () => ({}) },
    createAudioEngine: () => ({
      ...engine,
      on: () => () => undefined,
      memory: () => ({ decodedBytes: 0, budgetBytes: 0, residents: [] }),
      setTempo: vi.fn(),
      setCountIn: vi.fn(),
      setMetronome: vi.fn(),
      setMasterVolume: vi.fn(),
      setGmTierBypass: engine.setGmTierBypass,
      updateClick: vi.fn(),
      setSoundfont: vi.fn(),
      unload: vi.fn(),
      settled: () => Promise.resolve(),
      dispose: vi.fn(),
    }),
  };
});

const song = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 3)])
  .build();
const trackId = song.tracks[0]?.id ?? '';

async function open(
  defer: (run: () => void) => void = (run) => {
    run();
  },
) {
  const playback = createPlaybackStore();
  const audio = createAudioService({
    playback,
    loadSoundfont: () => Promise.resolve(new Uint8Array(1)),
    createContext: () => new AudioContext(),
    defer,
  });
  audio.setDocument({ id: 'doc', score: song });
  await audio.settled();
  return { audio, playback };
}

beforeEach(() => {
  engine.previewNote.mockClear();
  engine.unlock.mockClear();
  engine.setGmTierBypass.mockClear();
});

describe('AudioService.previewNote', () => {
  it('hands the engine the fret on its string, leaving tuning and capo to its track', async () => {
    const { audio } = await open();
    audio.previewNote(trackId, { string: 2, fret: 5 });
    expect(engine.previewNote).toHaveBeenCalledWith(trackId, { string: 2, fret: 5 }, {});
    expect(engine.unlock).toHaveBeenCalled();
  });

  it('passes a pitch, rounded and clamped to the MIDI range', async () => {
    const { audio } = await open();
    audio.previewNote(trackId, { pitch: 60.4 });
    audio.previewNote(trackId, { pitch: 300 });
    audio.previewNote(trackId, { pitch: -4 });
    expect(engine.previewNote.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      { pitch: 60 },
      { pitch: 127 },
      { pitch: 0 },
    ]);
  });

  it('clamps velocity to 1 to 127 and the seconds to 0.05 to 5 seconds', async () => {
    const { audio } = await open();
    audio.previewNote(trackId, { pitch: 60 }, { velocity: 500, seconds: 90 });
    audio.previewNote(trackId, { pitch: 60 }, { velocity: -3, seconds: 0 });
    audio.previewNote(trackId, { pitch: 60 }, { velocity: 64.6, seconds: 1 });
    expect(engine.previewNote.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      { velocity: 127, seconds: 5 },
      { velocity: 1, seconds: 0.05 },
      { velocity: 65, seconds: 1 },
    ]);
  });

  it('refuses an unknown track and a value that is not a number', async () => {
    const { audio } = await open();
    expect(() => {
      audio.previewNote('nope', { pitch: 60 });
    }).toThrow(RangeError);
    expect(() => {
      audio.previewNote(trackId, { pitch: Number.NaN });
    }).toThrow(RangeError);
    expect(() => {
      audio.previewNote(trackId, { pitch: 60 }, { velocity: Number.NaN });
    }).toThrow(RangeError);
    expect(() => {
      audio.previewNote(trackId, { pitch: 60 }, { seconds: Number.POSITIVE_INFINITY });
    }).toThrow(RangeError);
    expect(engine.previewNote).not.toHaveBeenCalled();
  });

  it('refuses a string outside the tuning and a fret that is not 0 to 127, before the engine', async () => {
    const { audio } = await open();
    for (const bad of [
      { string: 0, fret: 3 },
      { string: 7, fret: 3 },
      { string: 1.5, fret: 3 },
      { string: 1, fret: -1 },
      { string: 1, fret: 128 },
      { string: 1, fret: 2.5 },
    ]) {
      expect(() => {
        audio.previewNote(trackId, bad);
      }).toThrow(RangeError);
    }
    expect(engine.previewNote).not.toHaveBeenCalled();
    expect(engine.unlock).not.toHaveBeenCalled();
  });

  it('does nothing while the document loads, when the sound bank has not arrived', () => {
    const playback = createPlaybackStore();
    const audio = createAudioService({
      playback,
      loadSoundfont: () => new Promise<Uint8Array>(() => undefined),
      createContext: () => new AudioContext(),
    });
    audio.setDocument({ id: 'doc', score: song });
    audio.previewNote(trackId, { pitch: 60 });
    expect(() => {
      audio.previewNote(trackId, { string: 9, fret: 0 });
    }).not.toThrow();
    expect(engine.previewNote).not.toHaveBeenCalled();
  });

  it('does nothing for a track the document has and the engine does not yet', async () => {
    const queued: (() => void)[] = [];
    const { audio } = await open((run) => {
      queued.push(run);
    });
    const added = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 3)])
      .track('bass')
      .bar()
      .build();
    const bassId = added.tracks[1]?.id ?? '';
    audio.setDocument({ id: 'doc', score: added });
    audio.previewNote(bassId, { pitch: 40 });
    expect(engine.previewNote).not.toHaveBeenCalled();
    for (const run of queued.splice(0)) run();
    audio.previewNote(bassId, { pitch: 40 });
    expect(engine.previewNote).toHaveBeenCalledOnce();
  });

  it('does nothing before a song is open, and after dispose', async () => {
    const playback = createPlaybackStore();
    const bare = createAudioService({ playback, createContext: () => new AudioContext() });
    bare.previewNote(trackId, { pitch: 60 });
    expect(engine.previewNote).not.toHaveBeenCalled();
    const { audio } = await open();
    audio.dispose();
    audio.previewNote(trackId, { pitch: 60 });
    expect(engine.previewNote).not.toHaveBeenCalled();
  });
});

describe('AudioService.setGmTierBypass', () => {
  it('reaches the engine on creation, from the store, and on change', async () => {
    const { audio, playback } = await open();
    expect(engine.setGmTierBypass).toHaveBeenCalledWith(true);
    audio.setGmTierBypass(false);
    expect(engine.setGmTierBypass).toHaveBeenLastCalledWith(false);
    expect(playback.getState().settings.gmTierBypass).toBe(false);
  });
});
