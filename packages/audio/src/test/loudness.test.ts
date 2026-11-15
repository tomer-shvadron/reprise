/**
 * Playback must come out at a usable level (#169): a steel-guitar note at forte, a band mix and
 * an overloaded mix, rendered through the real transport, strips, master bus and GeneralUser GS.
 * Before the fix a single note peaked at -33.5 dBFS and a band's loudest 3 s sat near -25 dBFS
 * RMS, about 40 dB under the metronome click. The numbers below are measured with GeneralUser GS
 * 2.0.3; a soundfont bump re-measures them. Peak dBFS, before this change -> now:
 * - steel E3 at forte, volume 104, strips tap: -33.4 -> -23.6
 * - distortion power chord, same setup: -31.9 -> -17.9
 * - band mix, master tap: loudest 3 s RMS -22.8 -> -18.6, peak -8.9 -> -5.1
 * - overload (fff, volume 127, four extra distortion tracks): -0.4 both, the ceiling holds it
 */
import { score as buildScore, midi, note } from '@reprise/model/testing';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { loadGeneralUser, renderScore } from './harness';
import { peak, rms } from './signal';
import type { Signal } from './signal';

// Fetched by `pnpm sounds:fetch`, never committed; without it this suite skips.
const font = await loadGeneralUser();
if (!font)
  console.warn('GeneralUser GS is not present; run `pnpm sounds:fetch` to include this suite.');

const SAMPLE_RATE = 22_050;
/** The soft ceiling's asymptote, -0.2 dBFS. */
const CEILING = 10 ** (-0.2 / 20);

function db(amplitude: number): number {
  return 20 * Math.log10(amplitude);
}

function channel(volume: number) {
  return { volume, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0, mute: false, solo: false };
}

type Dynamics = 'f' | 'fff';

/** One steel-guitar E3 (string 4, fret 2) at forte. */
function singleNote(volume: number): Score {
  return buildScore()
    .track('guitar', { program: 25, channel: channel(volume) })
    .bar()
    .beat('1', [note(4, 2)])
    .build();
}

/** Four bars of quarter-note hits; each track repeats its one figure. */
function band(volume: number, dynamics: Dynamics, extraDistortion = 0): Score {
  const power = () => [
    note(6, 3, { dynamics }),
    note(5, 5, { dynamics }),
    note(4, 5, { dynamics }),
  ];
  const builder = buildScore().tempo(120);
  builder.track('guitar', { program: 25, channel: channel(volume) });
  const steel = () => [
    note(6, 0, { dynamics }),
    note(5, 2, { dynamics }),
    note(4, 2, { dynamics }),
    note(3, 1, { dynamics }),
    note(2, 0, { dynamics }),
    note(1, 0, { dynamics }),
  ];
  for (let bar = 0; bar < 4; bar += 1) {
    builder.bar();
    for (let beat = 0; beat < 4; beat += 1) builder.beat('4', steel());
  }
  for (let layer = 0; layer < 1 + extraDistortion; layer += 1) {
    builder.track('guitar', { program: 30, channel: channel(volume) });
    for (let bar = 0; bar < 4; bar += 1) {
      builder.bar();
      for (let beat = 0; beat < 4; beat += 1) builder.beat('4', power());
    }
  }
  builder.track('bass', { channel: channel(volume) });
  for (let bar = 0; bar < 4; bar += 1) {
    builder.bar();
    for (let beat = 0; beat < 4; beat += 1) builder.beat('4', [note(3, 0, { dynamics })]);
  }
  builder.track('drums', { channel: channel(volume) });
  for (let bar = 0; bar < 4; bar += 1) {
    builder.bar();
    builder.beat('8', [midi(36, { dynamics }), midi(42, { dynamics })]);
    builder.beat('8', [midi(42, { dynamics })]);
    builder.beat('8', [midi(38, { dynamics }), midi(42, { dynamics })]);
    builder.beat('8', [midi(42, { dynamics })]);
    builder.beat('8', [midi(36, { dynamics }), midi(42, { dynamics })]);
    builder.beat('8', [midi(42, { dynamics })]);
    builder.beat('8', [midi(38, { dynamics }), midi(42, { dynamics })]);
    builder.beat('8', [midi(42, { dynamics })]);
  }
  return builder.build();
}

function loudestRms(signal: Signal, window = 3, step = 0.25): number {
  const seconds = signal.data.length / signal.sampleRate;
  let loudest = 0;
  for (let from = 0; from + window <= seconds; from += step) {
    loudest = Math.max(loudest, rms(signal, from, from + window));
  }
  return loudest;
}

async function notePeak(
  volume: number,
  masterVolume = 1,
  tap: 'strips' | 'master' = 'strips',
): Promise<number> {
  if (!font) return 0;
  const rendered = await renderScore(singleNote(volume), {
    instruments: font,
    sampleRate: SAMPLE_RATE,
    tap,
    masterVolume,
    tail: 1,
  });
  return peak(rendered, 0, Number.POSITIVE_INFINITY);
}

describe.skipIf(!font)('playback loudness', () => {
  it('plays a steel-guitar note at forte near -24 dBFS', async () => {
    const level = db(await notePeak(104));
    console.info(`steel E3 f, volume 104: ${level.toFixed(2)} dBFS`);
    // With the filter envelope and modulators (the next change) the note reaches about -17.
    expect(level).toBeGreaterThanOrEqual(-26);
    expect(level).toBeLessThanOrEqual(-22);
  }, 60_000);

  it('plays a distortion power chord no quieter than -19.5 dBFS', async () => {
    if (!font) return;
    const chord = buildScore()
      .track('guitar', { program: 30, channel: channel(104) })
      .bar()
      .beat('1', [note(6, 3), note(5, 5), note(4, 5)])
      .build();
    const rendered = await renderScore(chord, {
      instruments: font,
      sampleRate: SAMPLE_RATE,
      tap: 'strips',
      tail: 1,
    });
    const level = db(peak(rendered, 0, Number.POSITIVE_INFINITY));
    console.info(`distortion power chord: ${level.toFixed(2)} dBFS`);
    expect(level).toBeGreaterThanOrEqual(-19.5);
  }, 60_000);

  it('mixes a band to a loud but unclipped master output', async () => {
    if (!font) return;
    const rendered = await renderScore(band(104, 'f'), {
      instruments: font,
      sampleRate: SAMPLE_RATE,
      tail: 1,
    });
    const loudest = db(loudestRms(rendered));
    const top = peak(rendered, 0, Number.POSITIVE_INFINITY);
    console.info(`band: 3 s RMS ${loudest.toFixed(2)} dBFS, peak ${db(top).toFixed(2)} dBFS`);
    expect(loudest).toBeGreaterThanOrEqual(-24);
    expect(loudest).toBeLessThanOrEqual(-12);
    expect(db(top)).toBeGreaterThanOrEqual(-6);
    expect(top).toBeLessThanOrEqual(CEILING + 1e-4);
  }, 120_000);

  it('keeps an overloaded mix under the ceiling', async () => {
    if (!font) return;
    const rendered = await renderScore(band(127, 'fff', 4), {
      instruments: font,
      sampleRate: SAMPLE_RATE,
      tail: 1,
    });
    console.info(
      `overload: peak ${db(peak(rendered, 0, Number.POSITIVE_INFINITY)).toFixed(2)} dBFS`,
    );
    for (let c = 0; c < rendered.buffer.numberOfChannels; c += 1) {
      const data = rendered.buffer.getChannelData(c);
      expect(data.findIndex((value) => !Number.isFinite(value))).toBe(-1);
      expect(
        peak({ data, sampleRate: SAMPLE_RATE }, 0, Number.POSITIVE_INFINITY),
      ).toBeLessThanOrEqual(CEILING + 1e-4);
    }
  }, 180_000);

  it('keeps the volume controls audible and proportional', async () => {
    // The master gain sits after the strips' tap, and the note is far below the limiter.
    const master = await notePeak(104, 1, 'master');
    expect(db((await notePeak(104, 0.5, 'master')) / master)).toBeCloseTo(-6.02, 1);
    const loud = await notePeak(127);
    const soft = await notePeak(64);
    // The GM channel volume curve: (64 / 127)^2 against 1.
    expect(db(soft / loud)).toBeCloseTo(-11.9, 0);
    expect(db(soft)).toBeGreaterThan(-45);
  }, 120_000);
});
