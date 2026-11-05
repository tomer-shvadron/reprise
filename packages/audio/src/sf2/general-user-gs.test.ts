import { describe, expect, it } from 'vitest';

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

function total(presets: readonly ResolvedPreset[], pick: (report: PresetReport) => number): number {
  return presets.reduce((sum, preset) => sum + pick(preset.report), 0);
}

// The suite body runs at collection even when skipped, so nothing here may assume the file.
const font = bytes && Sf2Soundfont.parse(bytes);

describe.skipIf(!font)('GeneralUser GS', () => {
  const programs = Array.from({ length: 128 }, (_, program) => font?.preset(0, program));
  const kit = font?.preset(PERCUSSION_BANK, 0);

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

  it('serves every region of the GM set through the provider', async () => {
    const all = [...programs, kit].filter((preset) => preset !== undefined);
    const refs = new Set(all.flatMap((preset) => preset.regions.map((region) => region.sample)));
    let bytesFetched = 0;
    for (const ref of refs) {
      if (!font) break;
      const raw = await font.fetch(ref);
      expect(raw.byteLength).toBe(font.byteLength(ref));
      bytesFetched += raw.byteLength;
    }
    const estimate = all.reduce((sum, preset) => sum + preset.bytes, 0);
    expect(bytesFetched).toBe(estimate);
    console.info(
      `GeneralUser GS GM set: ${String(all.length)} presets, ${String(refs.size)} sample refs, ` +
        `${(estimate / 1_048_576).toFixed(1)} MiB decoded as Float32`,
    );
  });

  it('records what the Region cannot express', () => {
    const all = [...programs, kit].filter((preset) => preset !== undefined);
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
      skippedZones: total(all, (r) => r.skippedZones),
      invalidLoops: total(all, (r) => r.invalidLoops),
      unsupported,
    };
    console.info(`GeneralUser GS GM set report: ${JSON.stringify(summary)}`);
    expect(summary.skippedZones).toBe(0);
  });
});
