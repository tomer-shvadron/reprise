import { score, note } from '@reprise/model/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlaybackStore } from '@/state/playback';

import { createAudioService } from './audio-service';

const engine = vi.hoisted(() => ({
  previewNote: vi.fn<(...args: unknown[]) => void>(),
  unlock: vi.fn(),
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

async function open() {
  const playback = createPlaybackStore();
  const audio = createAudioService({
    playback,
    loadSoundfont: () => Promise.resolve(new Uint8Array(1)),
    createContext: () => new AudioContext(),
    defer: (run) => {
      run();
    },
  });
  audio.setDocument({ id: 'doc', score: song });
  await audio.settled();
  return { audio, playback };
}

beforeEach(() => {
  engine.previewNote.mockClear();
  engine.unlock.mockClear();
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

  it('clamps velocity to 1 to 127 and the duration to 0.05 to 5 seconds', async () => {
    const { audio } = await open();
    audio.previewNote(trackId, { pitch: 60 }, { velocity: 500, duration: 90 });
    audio.previewNote(trackId, { pitch: 60 }, { velocity: -3, duration: 0 });
    audio.previewNote(trackId, { pitch: 60 }, { velocity: 64.6, duration: 1 });
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
      audio.previewNote(trackId, { pitch: 60 }, { duration: Number.POSITIVE_INFINITY });
    }).toThrow(RangeError);
    expect(engine.previewNote).not.toHaveBeenCalled();
  });

  it('does nothing before a song is open or loaded, and after dispose', async () => {
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
