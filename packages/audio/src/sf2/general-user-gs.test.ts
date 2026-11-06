import { describe, expect, it } from 'vitest';

import { RegionMap } from '../sampler/region-map';
import type { Region, SampleRef } from '../sampler/region-map';
import type { SampleSource } from '../sampler/sample-source';
import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import {
  bandEnergy,
  cents,
  offline,
  peak,
  rms,
  zeroCrossingFrequency,
} from '../sampler/test/offline';
import { loadGeneralUserBytes } from '../test/harness';
import type { PresetReport, ResolvedPreset } from './resolve';
import { PERCUSSION_BANK, Sf2Soundfont } from './soundfont';

// Fetched by `pnpm sounds:fetch`, never committed; without it this suite skips.
const bytes = await loadGeneralUserBytes();
if (!bytes) {
  console.warn('GeneralUser GS is not present; run `pnpm sounds:fetch` to include its suite.');
}

/** Percussion keys of the GM 1 standard kit, Acoustic Bass Drum to Open Triangle. */
const GM_DRUM_KEYS = Array.from({ length: 81 - 35 + 1 }, (_, i) => 35 + i);
const A4 = 69;

function total(presets: readonly ResolvedPreset[], pick: (report: PresetReport) => number): number {
  return presets.reduce((sum, preset) => sum + pick(preset.report), 0);
}

/** What the memory manager does with a `RawSample`, reduced to the one buffer a test plays. */
class BufferSource implements SampleSource {
  readonly #buffers = new Map<SampleRef, AudioBuffer>();

  constructor(private readonly font: Sf2Soundfont) {}

  async getBuffer(ref: SampleRef): Promise<AudioBuffer> {
    const cached = this.#buffers.get(ref);
    if (cached) return cached;
    const raw = await this.font.fetch(ref);
    const length = raw.channels[0]?.length ?? 0;
    const buffer = new AudioBuffer({
      length,
      sampleRate: raw.sampleRate,
      numberOfChannels: raw.channels.length,
    });
    for (const [index, channel] of raw.channels.entries())
      buffer.getChannelData(index).set(channel);
    this.#buffers.set(ref, buffer);
    return buffer;
  }

  peekBuffer(ref: SampleRef): AudioBuffer | undefined {
    return this.#buffers.get(ref);
  }
}

const TRACK: SamplerTrack = {
  id: 't',
  kind: 'pitched',
  tuning: [],
  capo: 0,
  channel: {
    volume: 127,
    pan: 64,
    chorus: 0,
    reverb: 0,
    phaser: 0,
    tremolo: 0,
    mute: false,
    solo: false,
  },
};

interface Strike {
  key: number;
  when: number;
  off: number;
  velocity?: number;
}

/**
 * Notes of a region map through the real sampler, every layer preloaded, rendered offline before
 * the master bus, so levels compare without the limiter; the result is left plus right.
 */
async function playMap(
  font: Sf2Soundfont,
  regions: RegionMap,
  strikes: readonly Strike[],
  seconds = 1.5,
): Promise<Float32Array> {
  const source = new BufferSource(font);
  const context = offline(seconds);
  const sampler = new Sampler(context);
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  sampler.addTrack(TRACK, { regions, source });
  await sampler.preload(
    't',
    strikes.map(({ key, velocity }) => ({ key, velocity: velocity ?? 127 })),
  );
  for (const { key, when, off, velocity } of strikes) {
    const voice = sampler.noteOn('t', { key, velocity: velocity ?? 127, when });
    if (!voice) throw new Error(`No voice for key ${String(key)}`);
    sampler.noteOff(voice, off);
  }
  const rendered = await context.startRendering();
  const right = rendered.getChannelData(1);
  // Both channels summed: GM layers are often hard-panned mono samples.
  return rendered.getChannelData(0).map((left, index) => left + (right[index] ?? 0));
}

/** One note of a GM program through the real sampler. */
async function play(font: Sf2Soundfont, program: number, key: number): Promise<Float32Array> {
  const regions = font.regionMapFor(0, program);
  if (!regions) throw new Error(`No program ${String(program)}`);
  return playMap(font, regions, [{ key, when: 0, off: 1.2 }]);
}

/** The map with each region changed by `edit`, to render the same notes without a feature. */
function without(regions: RegionMap, edit: (region: Region) => Region): RegionMap {
  return new RegionMap(regions.regions.map(edit));
}

// The suite body runs at collection even when skipped, so nothing here may assume the file.
const font = bytes && Sf2Soundfont.parse(bytes);

describe.skipIf(!font)('GeneralUser GS', () => {
  const programs = Array.from({ length: 128 }, (_, program) => font?.preset(0, program));
  const kit = font?.preset(PERCUSSION_BANK, 0);
  const all = [...programs, kit].filter((preset) => preset !== undefined);

  it('parses, with presets in bank 0 and the percussion bank', () => {
    expect(font?.info.name).toMatch(/^GeneralUser GS 2\.0\.3/);
    expect(font?.presets.some((p) => p.bank === PERCUSSION_BANK)).toBe(true);
  });

  it('resolves every GM program in bank 0 to a non-empty region map', () => {
    for (const [program, preset] of programs.entries()) {
      expect(preset, `program ${String(program)}`).toBeDefined();
      expect(preset?.regions.length, `program ${String(program)}`).toBeGreaterThan(0);
      expect(font?.regionMapFor(0, program)?.resolve(60, 100)).toBeDefined();
    }
  });

  it('resolves every GM percussion key to a region of the standard kit that covers it', () => {
    const map = font?.drumKitRegionMap();
    for (const key of GM_DRUM_KEYS) {
      const region = map?.resolve(key, 100);
      expect(region && region.keyLo <= key && key <= region.keyHi, `drum key ${String(key)}`).toBe(
        true,
      );
    }
  });

  it('serves every region of the GM set through the provider, one ref per PCM span', async () => {
    const refs = new Set(all.flatMap((preset) => preset.regions.map((region) => region.sample)));
    let bytesFetched = 0;
    for (const ref of refs) {
      if (!font) break;
      const raw = await font.fetch(ref);
      expect(raw.byteLength).toBe(font.byteLength(ref));
      bytesFetched += raw.byteLength;
    }
    // Every preset's own estimate counts a span shared by two presets twice; the fetch once.
    const estimate = all.reduce((sum, preset) => sum + preset.bytes, 0);
    expect(refs.size).toBe(971);
    expect(estimate).toBe(127_528_740);
    expect(bytesFetched).toBe(74_988_892);
    console.info(
      `GeneralUser GS GM set: ${String(all.length)} presets, ${String(refs.size)} sample refs, ` +
        `${(bytesFetched / 1_048_576).toFixed(1)} MiB decoded as Float32 ` +
        `(${(estimate / 1_048_576).toFixed(1)} MiB summed per preset)`,
    );
  });

  it('names exactly the presets that play a slice, so a shared sample survives one eviction', () => {
    const usedBy = new Map<SampleRef, Set<string>>();
    for (const preset of all) {
      for (const region of preset.regions) {
        let ids = usedBy.get(region.sample);
        if (!ids) usedBy.set(region.sample, (ids = new Set()));
        ids.add(preset.id);
      }
    }
    const gm = new Set(all.map((preset) => preset.id));
    let shared = 0;
    for (const [ref, ids] of usedBy) {
      const listed = font?.instrumentsOf(ref) ?? [];
      if (listed.length > 1) shared += 1;
      // Every GM preset using the slice is listed, and every listed GM preset uses it; the rest
      // of the list is the GS variation banks, which the set above does not resolve.
      for (const id of ids) expect(listed, ref).toContain(id);
      for (const id of listed) if (gm.has(id)) expect(ids.has(id), `${ref} -> ${id}`).toBe(true);
    }
    expect(shared).toBe(579);
    expect(font?.instrumentsOf('gm/0/0-1')).toEqual([]);
  });

  it('records what the Region cannot express', () => {
    const unsupported: Record<string, number> = {};
    for (const preset of all) {
      for (const [name, count] of Object.entries(preset.report.unsupported)) {
        unsupported[name] = (unsupported[name] ?? 0) + count;
      }
    }
    const summary = {
      regions: all.reduce((sum, preset) => sum + preset.regions.length, 0),
      keyExpanded: total(all, (r) => r.keyExpanded),
      modulated: total(all, (r) => r.modulated),
      layered: total(all, (r) => r.layered),
      stereoMismatches: total(all, (r) => r.stereoMismatches),
      unpairedStereo: total(all, (r) => r.unpairedStereo),
      skippedZones: total(all, (r) => r.skippedZones),
      invalidLoops: total(all, (r) => r.invalidLoops),
      unsupported,
    };
    console.info(`GeneralUser GS GM set report: ${JSON.stringify(summary)}`);
    // The file is pinned by hash, so these are fixed; a change here is a change in the resolver.
    expect(summary).toMatchObject({
      regions: 16_100,
      keyExpanded: 687,
      stereoMismatches: 0,
      unpairedStereo: 0,
      skippedZones: 0,
      invalidLoops: 3,
    });
  });

  it("carries the modulation envelope's held pitch: the Ocarina is written as coarseTune -7 + 700", () => {
    const region = font?.regionMapFor(0, 79)?.resolve(A4, 100);
    expect(region?.rootKey).toBe(73);
    expect(region?.tune).toBeCloseTo(-700 + 4 - 3 + 700, 12);
  });

  it.each([
    { program: 78, name: 'Whistle' },
    { program: 79, name: 'Ocarina' },
  ])('plays $name at A4 through the sampler, audible and in tune', async ({ program }) => {
    if (!font) return;
    const data = await play(font, program, A4);
    expect(rms(data, 0.3, 1)).toBeGreaterThan(0.05);
    const measured = zeroCrossingFrequency(data, 0.3, 1);
    expect(Math.abs(cents(measured, 440))).toBeLessThan(5);
  });
  it('sounds every layer of a layered GM program: Fast Strings', async () => {
    if (!font) return;
    const regions = font.regionMapFor(0, 48);
    if (!regions) throw new Error('No Fast Strings');
    const layers = regions.resolveAll(60, 127);
    expect(layers).toHaveLength(2);
    const strikes = [{ key: 60, when: 0, off: 1.2 }];
    const energy = async (map: RegionMap): Promise<number> =>
      rms(await playMap(font, map, strikes), 0.1, 1) ** 2;
    const all = await energy(regions);
    const each = await Promise.all(layers.map((layer) => energy(new RegionMap([layer]))));
    const share = (each[1] ?? 0) / all;
    console.info(
      `Fast Strings C4: layer energies ${each.map((e) => (e / all).toFixed(3)).join(', ')} of the note's`,
    );
    // Two different samples are nearly uncorrelated: the note carries both layers' energy
    // (measured 1.10 of it, the rest correlation).
    expect(Math.abs(each.reduce((sum, e) => sum + e, 0) / all - 1)).toBeLessThan(0.15);
    expect(share).toBeGreaterThan(0.25);
  });

  it('filters a GM program at its held cutoff: Synth Bass 1 loses its top end', async () => {
    if (!font) return;
    const regions = font.regionMapFor(0, 38);
    if (!regions) throw new Error('No Synth Bass 1');
    const cutoffs = regions.resolveAll(48, 127).map((region) => region.filter?.cutoffHz);
    expect(cutoffs.some((cutoff) => cutoff !== undefined && cutoff < 4000)).toBe(true);
    const strikes = [{ key: 48, when: 0, off: 1.2 }];
    const filtered = await playMap(font, regions, strikes);
    const open = await playMap(
      font,
      without(regions, (region) => {
        const open = { ...region };
        delete open.filter;
        return open;
      }),
      strikes,
    );
    const ratio =
      bandEnergy(filtered, 3000, 10_000, 0.1, 0.6) / bandEnergy(open, 3000, 10_000, 0.1, 0.6);
    console.info(
      `Synth Bass 1 C3: cutoffs ${cutoffs.map((c) => (c ?? 0).toFixed(0)).join(', ')} Hz, ` +
        `energy above 3 kHz ×${ratio.toFixed(3)}`,
    );
    expect(ratio).toBeLessThan(0.5);
  });

  it('lowers a resonant zone by half its peak: Music Box', async () => {
    if (!font) return;
    const regions = font.regionMapFor(0, 10);
    if (!regions) throw new Error('No Music Box');
    const layers = regions.resolveAll(A4, 127);
    // Both layers: 170 cB of resonance at the open cutoff, so 8.5 dB off the DC gain.
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.filter?.q).toBeCloseTo(17 - 3.0103, 9);
      expect(layer.filter?.cutoffHz).toBeGreaterThan(19_000);
    }
    const strikes = [{ key: A4, when: 0, off: 1.2 }];
    const level = rms(await playMap(font, regions, strikes), 0.05, 1);
    // As main played it: no region filter and the zone's own attenuation.
    const unfiltered = without(regions, (region) => {
      const open = { ...region, attenuation: (region.attenuation ?? 0) - 8.5 };
      delete open.filter;
      return open;
    });
    const before = rms(await playMap(font, unfiltered, strikes), 0.05, 1);
    const db = 20 * Math.log10(level / before);
    console.info(`Music Box A4: ${db.toFixed(2)} dB against the unfiltered zone`);
    expect(Math.abs(db + 8.5)).toBeLessThan(1);
  });

  it('delays the volume envelope where a GM zone does: Synth Strings 2', async () => {
    if (!font) return;
    const regions = font.regionMapFor(0, 51);
    if (!regions) throw new Error('No Synth Strings 2');
    // One of its two hard-panned layers enters 150 ms late; render that one alone.
    const delayed = regions.regions.filter((region) => (region.envelope.delay ?? 0) > 0);
    const [layer] = delayed;
    expect(layer?.envelope.delay).toBeCloseTo(0.15, 2);
    const delay = layer?.envelope.delay ?? 0;
    const data = await playMap(font, new RegionMap(delayed), [{ key: 60, when: 0, off: 1.2 }]);
    expect(peak(data, 0, delay - 0.003)).toBe(0);
    expect(rms(data, delay + 0.3, 1)).toBeGreaterThan(0.01);
  });

  it('chokes the open hi-hat with the closed one in the standard kit', async () => {
    if (!font) return;
    const kit = font.drumKitRegionMap();
    if (!kit) throw new Error('No standard kit');
    const open = kit.resolveAll(46, 127);
    const closed = kit.resolveAll(42, 127);
    const classOf = (regions: Region[]) => new Set(regions.map((r) => r.exclusiveClass ?? 0));
    expect([...classOf(open)].every((c) => c > 0 && classOf(closed).has(c))).toBe(true);
    const ringing = await playMap(font, kit, [{ key: 46, when: 0, off: 1.4 }]);
    const choked = await playMap(font, kit, [
      { key: 46, when: 0, off: 1.4 },
      { key: 42, when: 0.3, off: 1.4 },
    ]);
    const solo = await playMap(font, kit, [{ key: 42, when: 0.3, off: 1.4 }]);
    // What is left after the choke is the closed hi-hat alone.
    const left = rms(choked, 0.35, 0.8);
    console.info(
      `Open hi-hat 0.35-0.8 s: ringing ${rms(ringing, 0.35, 0.8).toFixed(4)}, ` +
        `choked ${left.toFixed(4)}, closed alone ${rms(solo, 0.35, 0.8).toFixed(4)}`,
    );
    expect(left).toBeCloseTo(rms(solo, 0.35, 0.8), 4);
    expect(left).toBeLessThan(rms(ringing, 0.35, 0.8) / 2);
  });
});
