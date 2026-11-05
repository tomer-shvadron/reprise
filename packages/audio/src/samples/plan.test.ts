import { midiNote } from '@reprise/model';
import type { Score } from '@reprise/model';
import { largeScore, midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { gmInstrumentId, planInstruments, planSamples } from './plan';
import { SyntheticProvider } from './test/synthetic';

/** Every sounding key per track, by brute force over written order. */
function writtenKeys(song: Score): number[][] {
  return song.tracks.map((track) => {
    const keys = new Set<number>();
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) for (const n of beat.notes) keys.add(midiNote(track, n));
      }
    }
    return [...keys].sort((a, b) => a - b);
  });
}

describe('planInstruments', () => {
  it('finds the one GM guitar and every key of the eight-track long score', () => {
    for (const song of [largeScore(8, 300), largeScore(8, 300, { structure: true })]) {
      const plan = planInstruments(song);
      expect(plan.instruments).toEqual(['gm:0:25']);
      expect(plan.tracks.map(({ uses }) => uses.map(({ keys }) => keys))).toEqual(
        writtenKeys(song).map((keys) => [keys]),
      );
    }
  });

  it('keys drum tracks to the kit and pitched tracks to their program', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(6, 0), note(1, 3)])
      .track('drums')
      .bar()
      .beat('4', [midi(42), midi(36)])
      .beat('4', [midi(38)])
      .track('piano', { program: 4 })
      .bar()
      .beat('2', [midi(64), midi(60)])
      .track('bass')
      .bar()
      .rest('1')
      .build();

    expect(planInstruments(song)).toEqual({
      instruments: ['gm:0:25', 'gm:drums:0', 'gm:0:4', 'gm:0:33'],
      tracks: [
        { track: song.tracks[0]?.id, uses: [{ instrument: 'gm:0:25', keys: [40, 67] }] },
        { track: song.tracks[1]?.id, uses: [{ instrument: 'gm:drums:0', keys: [36, 38, 42] }] },
        { track: song.tracks[2]?.id, uses: [{ instrument: 'gm:0:4', keys: [60, 64] }] },
        { track: song.tracks[3]?.id, uses: [{ instrument: 'gm:0:33', keys: [] }] },
      ],
    });
  });

  it('follows a program change in playback order, through a repeat', () => {
    const song = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 1)], { mix: { program: 30 } })
      .bar()
      .beat('1', [note(1, 2)])
      .repeatEnd(2)
      .build();

    expect(planInstruments(song).tracks[0]?.uses).toEqual([
      { instrument: 'gm:0:25', keys: [64] },
      { instrument: 'gm:0:30', keys: [64, 65, 66] },
    ]);
  });

  it('counts grace notes and the trill alternate, and stops after `bars`', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 5, { trill: { fret: 7, speed: 16 } })], {
        grace: [{ duration: 16, before: true, notes: [note(1, 3)] }],
      })
      .rest('2')
      .bar()
      .beat('1', [note(1, 12)])
      .build();

    expect(planInstruments(song, { bars: 1 }).tracks[0]?.uses[0]?.keys).toEqual([67, 69, 71]);
    expect(planInstruments(song).tracks[0]?.uses[0]?.keys).toEqual([67, 69, 71, 76]);
  });

  it('takes an instrument resolver for other tiers', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    const plan = planInstruments(song, {
      instrumentOf: (track, program) => `hq:pack:${track.kind}:${String(program)}`,
    });
    expect(plan.instruments).toEqual(['hq:pack:fretted:25']);
    expect(gmInstrumentId({ kind: 'drums', bank: 3 }, 25)).toBe('gm:drums:25');
  });
});

describe('planSamples', () => {
  it('resolves the planned keys to their zones in every layer', () => {
    const provider = new SyntheticProvider({ zoneWidth: 4 });
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(6, 0), note(5, 0)])
      .beat('4', [note(6, 1)])
      .beat('2', [note(1, 0)])
      .build();
    expect(planSamples(planInstruments(song), provider.regionMap).sort()).toEqual([
      'gm:0:25#10',
      'gm:0:25#11',
      'gm:0:25#16',
    ]);
    expect(planSamples(planInstruments(song), () => undefined)).toEqual([]);
  });
});
