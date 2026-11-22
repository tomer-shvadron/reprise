/**
 * Wah marks through the real transport, scheduler, sampler and a GM guitar (#355, part 4): the
 * centroid of the sound is dark with the pedal closed and bright with it open, against a plain
 * note, and the pedal ends at the first played note without a mark.
 */
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { START, loadGeneralUser, renderScore } from './test/harness';
import { peak, rms, spectralCentroid } from './test/signal';
import type { Signal } from './test/signal';

const font = await loadGeneralUser();
const BAR = 2;

type Mark = 'closed' | 'open' | undefined;

/** Four bars of four quarter notes on a steel guitar's E3, bar by bar marked `marks`. */
function song(marks: readonly Mark[]): Score {
  const builder = score().tempo(120).track('guitar', { program: 25 });
  for (const mark of marks) {
    builder.bar();
    for (let beat = 0; beat < 4; beat += 1) {
      builder.beat('4', [note(4, 2)], mark ? { effects: { wah: mark } } : {});
    }
  }
  return builder.build();
}

/** The centroid of the second beat of `bar`, after the pedal has settled. */
function centroid(signal: Signal, bar: number): number {
  const from = START + bar * BAR + 0.5 + 0.05;
  return spectralCentroid(signal, from, from + 0.2, { low: 100, high: 8000, resolution: 25 });
}

describe('wah marks through the engine', () => {
  it('darkens the sound closed, brightens it open, and ends at the first unmarked note', async () => {
    // Fetched by `pnpm sounds:fetch`; CI does it in the setup action, so a missing file fails here.
    if (!font) throw new Error('GeneralUser GS is not present; run `pnpm sounds:fetch`');
    const marks: Mark[] = [undefined, 'closed', 'open', undefined];
    const marked = await renderScore(song(marks), { instruments: font, tail: 0.5 });
    const plain = await renderScore(song([undefined, undefined, undefined, undefined]), {
      instruments: font,
      tail: 0.5,
    });
    const centroids = {
      plain: centroid(plain, 1),
      closed: centroid(marked, 1),
      open: centroid(marked, 2),
      after: centroid(marked, 3),
    };

    expect(centroid(marked, 0)).toBeCloseTo(centroid(plain, 0), 0);
    // Measured with GeneralUser GS 2.0.3: plain 1044 Hz, closed 392, open 2028.
    expect(centroids.closed).toBeLessThan(0.6 * centroids.plain);
    expect(centroids.open).toBeGreaterThan(1.6 * centroids.plain);
    expect(centroids.after).toBeCloseTo(centroid(plain, 3), 0);
  });

  it('puts no pedal on a track whose marks were edited away after a stop inside a passage', async () => {
    if (!font) throw new Error('GeneralUser GS is not present; run `pnpm sounds:fetch`');
    const marked = song(['closed', undefined]);
    // The same score and ids with the marks removed, as a live edit leaves it.
    const edited = structuredClone(marked);
    for (const bar of edited.tracks[0]?.bars ?? []) {
      for (const voice of bar.voices) for (const beat of voice.beats) delete beat.effects.wah;
    }
    const plain = await renderScore(edited, { instruments: font, tail: 0.5 });
    const restarted = await renderScore(marked, {
      instruments: font,
      seconds: 1.2 + 4 + 0.5,
      actions: [
        {
          at: 0.9,
          run: (t) => {
            t.stop();
          },
        },
        {
          at: 1,
          run: (t) => {
            t.load(edited);
            t.play();
          },
        },
      ],
    });
    // The second run starts when `play` ran, at a suspension after 1 s: its offset from the plain
    // render's first note is the difference of the first notes' times.
    const first = restarted.scheduled.find((n) => n.when >= 1);
    const offset = (first?.when ?? Number.NaN) - (plain.scheduled[0]?.when ?? Number.NaN);
    for (const beat of [1, 2, 5]) {
      const from = START + beat * 0.5 + 0.05;
      const bandOf = (signal: typeof plain, at: number) =>
        spectralCentroid(signal, at, at + 0.2, { low: 100, high: 8000, resolution: 25 });
      expect(bandOf(restarted, from + offset)).toBeCloseTo(bandOf(plain, from), -1);
      const level =
        rms(restarted, from + offset, from + offset + 0.2) / rms(plain, from, from + 0.2);
      expect(Math.abs(20 * Math.log10(level))).toBeLessThan(0.5);
    }
  });
});

/** One whole note per pitch, E2 to A5 across the strings, each bar marked alike. */
const PITCHES: readonly (readonly [number, number])[] = [
  [6, 0],
  [5, 0],
  [4, 0],
  [3, 0],
  [2, 0],
  [1, 0],
  [6, 5],
  [4, 5],
  [3, 5],
  [2, 5],
  [1, 5],
  [1, 12],
  [1, 17],
  [4, 2],
];

function pitches(program: number, mark?: 'closed' | 'open'): Score {
  const builder = score().tempo(120).track('guitar', { program });
  for (const [string, fret] of PITCHES) {
    builder
      .bar()
      .beat('1', [note(string, fret, { dynamics: 'f' })], mark ? { effects: { wah: mark } } : {});
  }
  return builder.build();
}

/** Wah level minus plain level in dB over the settled part of each note, in pitch order. */
async function levels(program: number, mark: 'closed' | 'open'): Promise<number[]> {
  if (!font) throw new Error('GeneralUser GS is not present; run `pnpm sounds:fetch`');
  const options = { instruments: font, tap: 'strips', tail: 0.5 } as const;
  const plain = await renderScore(pitches(program), options);
  const wah = await renderScore(pitches(program, mark), options);
  return PITCHES.map((_, index) => {
    const from = START + index * 2 + 0.3;
    return 20 * Math.log10(rms(wah, from, from + 1.2) / rms(plain, from, from + 1.2));
  });
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

describe('the level of the wah on GM guitars', () => {
  // Measured with GeneralUser GS 2.0.3 and a makeup gain of 3.5 (`ARTICULATION.wah`), median over
  // E2 to A5 of the wah's level against the plain note, in dB:
  //   steel (25):     closed +1.0, open -3.2
  //   clean (27):     closed +1.7, open -6.1
  //   overdrive (29): closed +2.5, open -3.0
  // A single pitch ranges far wider (a partial on the centre is boosted, the rest cut), which is
  // the wah's character, so only the median is pinned.
  it.each([
    ['steel', 25],
    ['clean electric', 27],
    ['overdrive', 29],
  ] as const)('keeps %s within a few dB of the plain note, closed and open', async (_, program) => {
    expect(median(await levels(program, 'closed'))).toBeGreaterThan(-1.5);
    expect(median(await levels(program, 'closed'))).toBeLessThan(3.5);
    expect(median(await levels(program, 'open'))).toBeGreaterThan(-8);
    expect(median(await levels(program, 'open'))).toBeLessThan(-1.5);
  });

  it('keeps a loud chord under 0 dBFS before the master limiter, closed and open', async () => {
    if (!font) throw new Error('GeneralUser GS is not present; run `pnpm sounds:fetch`');
    const chord = (mark?: 'closed' | 'open'): Score => {
      const builder = score().tempo(120).track('guitar', {
        program: 29,
      });
      builder.bar().beat(
        '1',
        [6, 5, 4, 3, 2, 1].map((string) => note(string, 3, { dynamics: 'fff' })),
        mark ? { effects: { wah: mark } } : {},
      );
      return builder.build();
    };
    const options = { instruments: font, tap: 'strips', tail: 0.5 } as const;
    for (const mark of ['closed', 'open'] as const) {
      const rendered = await renderScore(chord(mark), options);
      expect(peak(rendered, 0, 10)).toBeLessThan(1);
    }
  });
});
