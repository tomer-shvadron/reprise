import { describe, expect, it } from 'vitest';

import type { SampleRef } from '../sampler/region-map';
import type { SampleSource } from '../sampler/sample-source';
import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { cents, offline, rms, zeroCrossingFrequency } from '../sampler/test/offline';
import type { PresetReport, ResolvedPreset } from './resolve';
import { PERCUSSION_BANK, Sf2Soundfont } from './soundfont';

// Fetched by `pnpm sounds:fetch`, never committed; without it this suite skips.
const BANK = new URL('../../../../apps/web/public/sounds/gm/GeneralUser-GS.sf2', import.meta.url);

async function load(): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(BANK);
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A dev server may answer a missing file with its HTML fallback rather than a 404.
    const riff = String.fromCodePoint(...bytes.subarray(0, 4));
    return riff === 'RIFF' ? bytes : undefined;
  } catch {
    return undefined;
  }
}

const bytes = await load();
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

/** One note of a GM program through the real sampler, rendered offline. */
async function play(font: Sf2Soundfont, program: number, key: number): Promise<Float32Array> {
  const regions = font.regionMapFor(0, program);
  if (!regions) throw new Error(`No program ${String(program)}`);
  const source = new BufferSource(font);
  const region = regions.resolve(key, 127);
  if (!region) throw new Error(`No region for key ${String(key)}`);
  await source.getBuffer(region.sample);
  const context = offline(1.5);
  const sampler = new Sampler(context);
  sampler.addTrack(TRACK, { regions, source });
  const voice = sampler.noteOn('t', { key, velocity: 127, when: 0 });
  if (voice) sampler.noteOff(voice, 1.2);
  return (await context.startRendering()).getChannelData(0);
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
});
