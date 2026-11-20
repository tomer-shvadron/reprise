import { syntheticSfzPack } from '@reprise/audio/testing';
import type { Track } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { EMILYGUITAR_FIVE_VOICES } from '@/features/sounds';
import type { DefaultSounds, InstalledPackSource } from '@/state/sound-packs';

import { resolveTrackSound } from './track-sound';

const PACK_ID = EMILYGUITAR_FIVE_VOICES.packId;
const files = syntheticSfzPack().files;
const emily: InstalledPackSource = {
  id: PACK_ID,
  name: 'Emilyguitar',
  files,
  instruments: [{ key: 'five-voices', name: 'Five voices', entries: { default: 'default.sfz' } }],
};
const other: InstalledPackSource = {
  id: 'anOtherPack1',
  name: 'Other',
  files,
  instruments: [{ key: 'solo', name: 'Solo', entries: { default: 'default.sfz' } }],
};

const GUITAR_DEFAULT = { packId: PACK_ID, instrument: 'five-voices' };
/** The defaults of a fresh profile: both guitar families, nothing else. */
const freshDefaults: DefaultSounds = {
  get: (track) =>
    track.kind !== 'drums' && track.program >= 24 && track.program <= 31
      ? GUITAR_DEFAULT
      : undefined,
  subscribe: () => () => undefined,
};

function trackOf(
  kind: 'guitar' | 'bass' | 'piano' | 'drums',
  program: number,
  sound?: Track['sound'],
): Track {
  const track = score()
    .track(kind, { program, ...(sound && { sound }) })
    .bar()
    .build().tracks[0];
  if (!track) throw new Error('no track');
  return track;
}

const withPack = { get: (id: string) => (id === PACK_ID ? emily : undefined) };
const withoutPack = { get: () => undefined };

describe('resolveTrackSound, the default sounds table', () => {
  it.each([24, 25, 26, 27, 28, 29, 30, 31])(
    'plays guitar program %i with the default pack installed',
    (program) => {
      for (const kind of ['guitar', 'piano'] as const) {
        const { assignment, sound } = resolveTrackSound(
          trackOf(kind, program),
          withPack,
          freshDefaults,
        );
        expect(assignment?.pack.id).toBe(PACK_ID);
        expect(assignment?.entries).toEqual({ default: 'default.sfz' });
        expect(sound).toEqual({ tier: 'gm', packId: PACK_ID, source: 'default' });
      }
    },
  );

  it.each([24, 25, 27, 29, 31])('plays guitar program %i GM, with no warning, without it', (p) => {
    const { assignment, sound } = resolveTrackSound(
      trackOf('guitar', p),
      withoutPack,
      freshDefaults,
    );
    expect(assignment).toBeUndefined();
    expect(sound).toEqual({ tier: 'gm', packId: PACK_ID, problem: 'missing', source: 'default' });
  });

  it.each([
    ['bass', 33],
    ['piano', 0],
    ['drums', 0],
  ] as const)('leaves a %s track (program %i) on General MIDI either way', (kind, program) => {
    for (const directory of [withPack, withoutPack]) {
      const { assignment, sound } = resolveTrackSound(
        trackOf(kind, program),
        directory,
        freshDefaults,
      );
      expect(assignment).toBeUndefined();
      expect(sound).toEqual({ tier: 'gm' });
    }
  });

  it('keeps a pack the track names, over the default', () => {
    const track = trackOf('guitar', 29, { packId: other.id, instrument: 'solo' });
    const { assignment, sound } = resolveTrackSound(
      track,
      { get: (id) => (id === other.id ? other : emily) },
      freshDefaults,
    );
    expect(assignment?.pack.id).toBe(other.id);
    expect(sound).toEqual({ tier: 'gm', packId: other.id });
  });

  it('marks a named pack that is not installed as missing, with no default source', () => {
    const { sound } = resolveTrackSound(
      trackOf('guitar', 29, { packId: other.id }),
      withPack,
      freshDefaults,
    );
    expect(sound).toEqual({ tier: 'gm', packId: other.id, problem: 'missing' });
  });

  it('plays GM for an explicit General MIDI choice', () => {
    const { assignment, sound } = resolveTrackSound(
      trackOf('guitar', 29, { generalMidi: true }),
      withPack,
      freshDefaults,
    );
    expect(assignment).toBeUndefined();
    expect(sound).toEqual({ tier: 'gm' });
  });

  it('takes the default for a preset-only sound', () => {
    const { assignment, sound } = resolveTrackSound(
      trackOf('guitar', 30, { preset: 'fuzz' }),
      withPack,
      freshDefaults,
    );
    expect(assignment?.pack.id).toBe(PACK_ID);
    expect(sound.source).toBe('default');
  });

  it('plays GM for a family set to General MIDI', () => {
    const { assignment, sound } = resolveTrackSound(trackOf('guitar', 29), withPack, {
      get: () => undefined,
      subscribe: () => () => undefined,
    });
    expect(assignment).toBeUndefined();
    expect(sound).toEqual({ tier: 'gm' });
  });

  it('treats an instrument key the installed pack lacks as not installed', () => {
    const { assignment, sound } = resolveTrackSound(trackOf('guitar', 29), withPack, {
      get: () => ({ packId: PACK_ID, instrument: 'ten-voices' }),
      subscribe: () => () => undefined,
    });
    expect(assignment).toBeUndefined();
    expect(sound.problem).toBe('missing');
  });

  it('marks no track missing unless it names the pack itself', () => {
    const tracks = [trackOf('guitar', 29), trackOf('bass', 33), trackOf('piano', 0)];
    const named = tracks.filter((track) => {
      const { sound } = resolveTrackSound(track, withoutPack, freshDefaults);
      return sound.problem === 'missing' && sound.source !== 'default';
    });
    expect(named).toEqual([]);
  });

  it('shares one pack object across four guitar tracks', () => {
    const resolved = [24, 25, 27, 29].map(
      (p) => resolveTrackSound(trackOf('guitar', p), withPack, freshDefaults).assignment,
    );
    expect(new Set(resolved.map((a) => a?.pack.files)).size).toBe(1);
    expect(new Set(resolved.map((a) => a?.entries)).size).toBe(1);
  });
});
