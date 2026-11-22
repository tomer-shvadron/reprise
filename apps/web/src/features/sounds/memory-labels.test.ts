import { describe, expect, it } from 'vitest';

import type { InstalledPack } from './manifest';
import { instrumentLabel } from './memory-labels';
import { syntheticManifest } from './test/pack-fixtures';

const installed = (overrides: Partial<InstalledPack> = {}): InstalledPack => ({
  ...syntheticManifest(),
  curated: false,
  source: 'zip',
  installedAt: '2026-01-01T00:00:00.000Z',
  files: [],
  ...overrides,
});

describe('instrumentLabel', () => {
  const packs = [installed()];

  it('names General MIDI programs, with the bank when it is not 0', () => {
    expect(instrumentLabel('gm:0:29', [])).toBe('General MIDI: Overdriven Guitar');
    expect(instrumentLabel('gm:8:29', [])).toBe('General MIDI: Overdriven Guitar (bank 8)');
  });

  it('names drum kits, and falls back to "Kit n"', () => {
    expect(instrumentLabel('gm:drums:0', [])).toBe('General MIDI: Standard Kit');
    expect(instrumentLabel('gm:drums:3', [])).toBe('General MIDI: Kit 3');
  });

  it('maps a pack resident back to its instrument through the entries', () => {
    expect(instrumentLabel('sfz:SynthPack001@4:default.sfz', packs)).toBe(
      'Synthetic Pack: Default',
    );
    expect(instrumentLabel('sfz:SynthPack001@4:alt.sfz', packs)).toBe('Synthetic Pack: Alt');
  });

  it('drops the instrument name for a single-instrument pack, and marks a non-default set', () => {
    const [only] = installed().instruments;
    if (!only) throw new Error('no instrument');
    const single = [
      installed({
        instruments: [{ ...only, entries: { default: 'default.sfz', palmMute: 'pm.sfz' } }],
      }),
    ];
    expect(instrumentLabel('sfz:SynthPack001@1:default.sfz', single)).toBe('Synthetic Pack');
    expect(instrumentLabel('sfz:SynthPack001@1:pm.sfz', single)).toBe('Synthetic Pack (Palm mute)');
  });

  it('labels a file by its path when an entry carries noise keys after it', () => {
    const [only] = installed().instruments;
    if (!only) throw new Error('no instrument');
    const single = [
      installed({
        instruments: [{ ...only, entries: { default: 'a.sfz', dead: 'noises.sfz#key:91-95' } }],
      }),
    ];
    expect(instrumentLabel('sfz:SynthPack001@1:noises.sfz', single)).toBe(
      'Synthetic Pack (Dead note)',
    );
  });

  it('names an unknown set by its key', () => {
    const [only] = installed().instruments;
    if (!only) throw new Error('no instrument');
    const odd = [
      installed({ instruments: [{ ...only, entries: { default: 'd.sfz', odd: 'o.sfz' } }] }),
    ];
    expect(instrumentLabel('sfz:SynthPack001@1:o.sfz', odd)).toBe('Synthetic Pack (odd)');
  });

  it('falls back to the path, then to the pack id, then to the id itself', () => {
    expect(instrumentLabel('sfz:SynthPack001@1:other/x.sfz', packs)).toBe(
      'Synthetic Pack: other/x.sfz',
    );
    expect(instrumentLabel('sfz:GonePack0001@1:default.sfz', packs)).toBe('GonePack0001 (removed)');
    expect(instrumentLabel('sfz:malformed', packs)).toBe('sfz:malformed');
    expect(instrumentLabel('gm:x:y', packs)).toBe('gm:x:y');
    expect(instrumentLabel('something', packs)).toBe('something');
  });
});
