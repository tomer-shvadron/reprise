import { expandPlaybackSequence, midiNote } from '@reprise/model';
import type { Score, Track } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { GM_BUDGET_BYTES, MEGABYTE, ManagedSampleSource } from './managed-sample-source';
import { gmInstrumentId, planInstruments, planSamples } from './plan';
import {
  GM_DEDUPLICATED_BYTES,
  GM_PER_PRESET_BYTES,
  SyntheticProvider,
  generalUserGs,
} from './test/synthetic';

const factory = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });

function asDrums(track: Track): Track {
  return {
    ...track,
    kind: 'drums',
    tuning: [],
    capo: 0,
    fretCount: 0,
    program: 0,
    bars: track.bars.map((bar) => ({
      ...bar,
      voices: [
        {
          ...bar.voices[0],
          beats: bar.voices[0].beats.map((beat) => ({
            ...beat,
            notes: beat.notes.map((n) => ({
              ...n,
              string: 0,
              fret: 35 + ((n.string + n.fret) % 12),
            })),
          })),
        },
        bar.voices[1],
        bar.voices[2],
        bar.voices[3],
      ],
    })),
  };
}

/** The reference long score with one GM program per track, and a kit on the last when asked. */
function band(programs: readonly number[], drums: boolean): Score {
  const song = largeScore(programs.length + (drums ? 1 : 0), 300, { structure: true });
  return {
    ...song,
    tracks: song.tracks.map((track, t) => {
      const program = programs[t];
      return program === undefined ? asDrums(track) : { ...track, program };
    }),
  };
}

/** Every note of the song in playback order, as the scheduler would start them. */
async function playThrough(
  source: ManagedSampleSource,
  provider: SyntheticProvider,
  song: Score,
): Promise<{ notes: number; misses: number; peak: number }> {
  let notes = 0;
  let misses = 0;
  let peak = source.memory().decodedBytes;
  for (const { masterBarIndex } of expandPlaybackSequence(song).sequence) {
    for (const track of song.tracks) {
      const regions = provider.regionMap(gmInstrumentId(track, track.program));
      for (const voice of track.bars[masterBarIndex]?.voices ?? []) {
        for (const beat of voice.beats) {
          for (const n of beat.notes) {
            const sample = regions.resolve(midiNote(track, n), 96)?.sample;
            if (sample === undefined) continue;
            notes += 1;
            if (!source.peekBuffer(sample)) {
              misses += 1;
              await source.getBuffer(sample);
            }
            peak = Math.max(peak, source.memory().decodedBytes);
          }
        }
      }
    }
  }
  return { notes, misses, peak };
}

const mb = (bytes: number) => `${(bytes / MEGABYTE).toFixed(1)} MiB`;

describe('GM-tier memory budget', () => {
  it('holds 80 MiB through two long eight-track songs and the switch between them', async () => {
    const gm = generalUserGs();
    const provider = new SyntheticProvider(gm);
    const source = new ManagedSampleSource(provider, factory, { budgetBytes: GM_BUDGET_BYTES });
    const songA = band([24, 25, 26, 27, 29, 30, 33, 34], false);
    const songB = band([25, 27, 0, 48, 56, 65, 73], true);

    const started = performance.now();
    const planA = planInstruments(songA);
    const planMs = performance.now() - started;
    const setsA = new Set(planA.instruments.map((id) => gm.sampleSet(id)));
    const wholeA = [...setsA].reduce((sum, set) => sum + gm.setBytes(set), 0);

    const report: string[] = [`plan 8x300: ${planMs.toFixed(1)} ms`];
    for (const { name, song } of [
      { name: 'A', song: songA },
      { name: 'B', song: songB },
    ]) {
      const plan = await source.load(song, provider.regionMap);
      await source.settled();
      const needed = planSamples(plan, provider.regionMap).reduce(
        (sum, ref) => sum + provider.byteLength(ref),
        0,
      );
      const warm = source.memory().decodedBytes;
      const played = await playThrough(source, provider, song);
      report.push(
        `song ${name}: ${String(plan.instruments.length)} instruments, needs ${mb(needed)}, ` +
          `resident ${mb(warm)}, peak ${mb(played.peak)}, ${String(played.misses)} misses ` +
          `in ${String(played.notes)} notes`,
      );

      expect(source.memory().residents).toEqual(expect.arrayContaining(plan.instruments));
      expect(warm).toBeGreaterThanOrEqual(needed);
      expect(played.peak).toBeLessThanOrEqual(GM_BUDGET_BYTES);
      expect(played.misses).toBe(0);
      expect(source.counters.pinnedEvictions).toBe(0);
    }
    report.push(`song A, every zone of its ${String(setsA.size)} sample sets: ${mb(wholeA)}`);
    console.info(report.join('\n'));

    expect(source.memory().residents).not.toContain('gm:0:29');
    expect(source.memory().residents).not.toContain('gm:0:33');
    expect(source.memory().residents).toContain('gm:0:25');
    expect(wholeA).toBeLessThanOrEqual(GM_BUDGET_BYTES);
  });

  it('holds the whole GM set, deduplicated, inside the budget', async () => {
    const gm = generalUserGs();
    const provider = new SyntheticProvider(gm);
    const source = new ManagedSampleSource(provider, factory, { budgetBytes: GM_BUDGET_BYTES });
    const refs = new Set(
      gm.instruments.flatMap((id) => provider.regionMap(id).regions.map((r) => r.sample)),
    );
    for (const ref of refs) await source.getBuffer(ref);
    const perPreset = gm.instruments.reduce((sum, id) => sum + gm.setBytes(gm.sampleSet(id)), 0);
    console.info(
      `whole GM set: ${String(gm.instruments.length)} presets, ${String(refs.size)} samples, ` +
        `${mb(source.memory().decodedBytes)} resident (${mb(perPreset)} counted per preset)`,
    );

    expect(Math.abs(perPreset - GM_PER_PRESET_BYTES)).toBeLessThan(0.1 * MEGABYTE);
    expect(Math.abs(source.memory().decodedBytes - GM_DEDUPLICATED_BYTES)).toBeLessThan(
      0.1 * MEGABYTE,
    );
    expect(source.memory().decodedBytes).toBeLessThanOrEqual(GM_BUDGET_BYTES);
    expect(source.memory().residents).toHaveLength(gm.instruments.length);
    expect(source.counters.evictions).toBe(0);
  });

  it("degrades under half the long score's needs without throwing or exceeding the budget", async () => {
    const provider = new SyntheticProvider(generalUserGs());
    const song = band([24, 25, 26, 27, 29, 30, 33, 34], false);
    const needed = planSamples(planInstruments(song), provider.regionMap).reduce(
      (sum, ref) => sum + provider.byteLength(ref),
      0,
    );
    const budgetBytes = Math.floor(needed / 2);
    const source = new ManagedSampleSource(provider, factory, { budgetBytes });
    await source.load(song, provider.regionMap);
    await source.settled();
    const played = await playThrough(source, provider, song);
    console.info(
      `budget ${mb(budgetBytes)} for ${mb(needed)}: peak ${mb(played.peak)}, ` +
        `${String(played.misses)} misses in ${String(played.notes)} notes, ` +
        `${String(source.counters.fetches)} fetches`,
    );

    expect(played.peak).toBeLessThanOrEqual(budgetBytes);
    expect(played.misses).toBeGreaterThan(0);
    expect(source.counters.pinnedEvictions).toBeGreaterThan(0);
  });
});
