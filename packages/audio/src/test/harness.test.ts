import { describe, expect, it } from 'vitest';

import { midiNote } from '@reprise/model';
import type { Score } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';

import { RegionMap } from '../sampler/region-map';
import { SynthSampleSource, midiToFrequency } from '../sampler/sample-source';
import type { Instrument } from '../sampler/sampler';
import { GM_BUDGET_BYTES } from '../samples/managed-sample-source';
import { START, loadGeneralUser, renderScore } from './harness';
import { bandEnergy, cents, detectOnsets, peak, pitchAt } from './signal';

/** One open string per quarter, low to high, then two fretted notes: E2 to E5 at 120 BPM. */
const NOTES: readonly [number, number][] = [
  [6, 0],
  [5, 0],
  [4, 0],
  [3, 0],
  [2, 0],
  [1, 0],
  [1, 5],
  [1, 12],
];

/** Quarters, or eighths followed by an eighth rest so every onset follows silence. */
function scale(detached = false): Score {
  let builder = score().tempo(120).track('guitar').bar();
  for (const [index, [string, fret]] of NOTES.entries()) {
    if (index === 4) builder = builder.bar();
    builder = detached
      ? builder.beat('8', [note(string, fret)]).rest('8')
      : builder.beat('4', [note(string, fret)]);
  }
  return builder.build();
}

const GRID = NOTES.map((_, index) => START + index / 2);

/** The A4 sine of `sampler/test`, held, across the keyboard. */
function sine(): Instrument {
  return {
    regions: new RegionMap([
      {
        keyLo: 0,
        keyHi: 127,
        velLo: 1,
        velHi: 127,
        rootKey: 69,
        tune: 0,
        sample: 'a440',
        envelope: { attack: 0.002, hold: 0, decay: 0, sustain: 1, release: 0.02 },
      },
    ]),
    source: new SynthSampleSource(44_100, {
      a440: { kind: 'sine', frequency: 440, duration: 6 },
    }),
  };
}

describe('renderScore with a synthetic instrument', () => {
  it('plays every note on the grid at its pitch', async () => {
    const song = scale(true);
    const track = song.tracks[0];
    if (!track) throw new Error('no track');
    const rendered = await renderScore(song, { instruments: sine, tap: 'strips' });
    expect(rendered.songSeconds).toBeCloseTo(4, 9);
    expect(rendered.data.length).toBe(Math.round((START + 4 + 1) * 44_100));

    const onsets = detectOnsets(rendered);
    expect(onsets).toHaveLength(GRID.length);
    for (const [index, at] of onsets.entries()) {
      expect(Math.abs(at - (GRID[index] ?? 0))).toBeLessThan(0.001);
    }
    for (const [index, [string, fret]] of NOTES.entries()) {
      const expected = midiToFrequency(midiNote(track, { string, fret }));
      const found = pitchAt(rendered, (GRID[index] ?? 0) + 0.05, { window: 0.1 });
      expect(Math.abs(cents(found ?? 0, expected))).toBeLessThan(0.5);
    }
  });

  it('runs engine calls at their time', async () => {
    const rendered = await renderScore(scale(), {
      instruments: sine,
      tap: 'strips',
      actions: [
        {
          at: 1.2,
          run: (engine) => {
            engine.pause();
          },
        },
      ],
    });
    // The third quarter, due at 1.1 s, sounds; the fourth, at 1.6 s, never comes.
    expect(peak(rendered, 1.15, 1.2)).toBeGreaterThan(0.01);
    expect(peak(rendered, 1.4, 5)).toBe(0);
  });
});

const generalUser = await loadGeneralUser();
if (!generalUser) {
  console.warn('GeneralUser GS is not present; run `pnpm sounds:fetch` to include the GM renders.');
}

describe.skipIf(!generalUser)('renderScore through the GM tier', () => {
  it('plays a guitar scale on the grid and in tune, within the GM budget', async () => {
    if (!generalUser) return;
    const song = scale();
    const track = song.tracks[0];
    if (!track) throw new Error('no track');
    const rendered = await renderScore(song, { instruments: generalUser, tap: 'strips' });

    expect(rendered.missed).toEqual([]);
    expect(rendered.source?.memory().decodedBytes).toBeGreaterThan(0);
    expect(rendered.source?.memory().decodedBytes).toBeLessThanOrEqual(GM_BUDGET_BYTES);

    // Each sample takes its own few milliseconds to rise from its first frame to audible.
    const onsets = detectOnsets(rendered, { rise: 2 });
    expect(onsets).toHaveLength(GRID.length);
    for (const [index, at] of onsets.entries()) {
      const late = at - (GRID[index] ?? 0);
      expect(late).toBeGreaterThanOrEqual(0);
      expect(late).toBeLessThan(0.02);
    }
    for (const [index, [string, fret]] of NOTES.entries()) {
      const expected = midiToFrequency(midiNote(track, { string, fret }));
      const found = pitchAt(rendered, (GRID[index] ?? 0) + 0.25, { window: 0.15 });
      // A sampled string is not a tuner: GeneralUser GS's open E2 reads 16 cents sharp here.
      // A wrong key would be 100 off.
      expect(Math.abs(cents(found ?? 0, expected))).toBeLessThan(25);
    }
  });

  it('puts a kick low and a closed hi-hat high', async () => {
    if (!generalUser) return;
    const song = score()
      .tempo(120)
      .track('drums')
      .bar()
      .beat('2', [midi(36)])
      .beat('2', [midi(42)]);
    const rendered = await renderScore(song.build(), {
      instruments: generalUser,
      tap: 'strips',
      tail: 0.5,
    });
    const kick = [START, START + 0.25] as const;
    const hat = [START + 1, START + 1.25] as const;
    const low = (span: readonly [number, number]) => bandEnergy(rendered, 20, 150, ...span);
    const high = (span: readonly [number, number]) => bandEnergy(rendered, 5000, 16_000, ...span);
    expect(low(kick)).toBeGreaterThan(10 * high(kick));
    expect(high(hat)).toBeGreaterThan(10 * low(hat));
  });
});
