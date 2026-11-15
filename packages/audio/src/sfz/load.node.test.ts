import { describe, expect, it } from 'vitest';

import { loadSfz } from './load';
import { MAX_INCLUDE_DEPTH, SfzParseError } from './preprocess';
import { LIMITS, isClean } from './report';
import { memoryReader } from './test-reader';

const load = (files: Record<string, string>, root = 'a.sfz', layer?: string) =>
  loadSfz(root, memoryReader(files), { packId: 'p', ...(layer && { layer }) });

const one = async (text: string) => {
  const { regions, report } = await load({ 'a.sfz': text });
  return { regions, report, first: regions[0] };
};

describe('preprocessing and tokenizing', () => {
  it('strips both comment styles', async () => {
    const { regions } = await load({
      'a.sfz':
        '// note\n<region> /* inline */ sample=a.wav // tail\n/* multi\nline */ <region> sample=b.wav',
    });
    expect(regions.map((r) => r.sample)).toEqual(['sfz:p/a.wav', 'sfz:p/b.wav']);
  });

  it('keeps spaces in sample names and ends them at the next opcode', async () => {
    const { first } = await one('<region> sample=My Piano C4.wav lokey=60 hikey=62');
    expect(first?.sample).toBe('sfz:p/My Piano C4.wav');
    expect(first?.keyHi).toBe(62);
  });

  it('reads several headers and opcodes on one line', async () => {
    const { regions } = await one(
      '<group> lokey=10 <region> sample=a.wav <region> sample=b.wav hikey=20',
    );
    expect(regions.map((r) => [r.keyLo, r.keyHi])).toEqual([
      [10, 127],
      [10, 20],
    ]);
  });

  it('substitutes #define from its line on, including inside paths', async () => {
    const { regions } = await one(
      '<region> sample=$X.wav\n#define $X kick\n#define $KEY c3\n<region> sample=$X.wav key=$KEY',
    );
    expect(regions.map((r) => r.sample)).toEqual(['sfz:p/$X.wav', 'sfz:p/kick.wav']);
    expect(regions[1]?.keyLo).toBe(48);
  });

  it('includes through the reader, resolving against the root directory, nested', async () => {
    const { regions, report } = await load(
      {
        'inst/a.sfz': '#include "defs/one.sfzh"\n<region> sample=$S key=60',
        'inst/defs/one.sfzh': '#define $S s.wav\n#include "defs/two.sfzh"',
        'inst/defs/two.sfzh': '#define $T t.wav',
      },
      'inst/a.sfz',
    );
    expect(regions[0]?.sample).toBe('sfz:p/inst/s.wav');
    expect(report.unresolvedIncludes).toEqual([]);
  });

  it('reports a missing include, a cycle and too deep a nest, and keeps going', async () => {
    const files: Record<string, string> = {
      'a.sfz': '#include "gone.sfzh"\n#include "b.sfzh"\n<region> sample=ok.wav',
      'b.sfzh': '#include "a.sfz"\n#include "b.sfzh"',
    };
    const { regions, report } = await load(files);
    expect(regions).toHaveLength(1);
    expect(report.unresolvedIncludes).toEqual(['gone.sfzh', 'a.sfz (cycle)', 'b.sfzh (cycle)']);

    const deep: Record<string, string> = { 'a.sfz': '#include "n0.sfzh"\n<region> sample=ok.wav' };
    for (let i = 0; i <= MAX_INCLUDE_DEPTH + 1; i += 1) {
      deep[`n${String(i)}.sfzh`] = `#include "n${String(i + 1)}.sfzh"`;
    }
    const nested = await load(deep);
    expect(nested.report.unresolvedIncludes.at(-1)).toMatch(/\(depth\)$/);
  });

  it('refuses an include that escapes the pack', async () => {
    const { report } = await load({
      'a.sfz': '#include "../../secret.sfzh"\n<region> sample=a.wav',
    });
    expect(report.escapedPaths).toEqual(['../../secret.sfzh']);
  });

  it('throws only when the root file is unreadable', async () => {
    await expect(load({}, 'missing.sfz')).rejects.toBeInstanceOf(SfzParseError);
    await expect(load({ 'a.sfz': '' })).resolves.toMatchObject({ regions: [] });
  });
});

describe('inheritance', () => {
  it('flows global to master to group to region, and a new header resets below it', async () => {
    const { regions } = await one(
      [
        '<global> lokey=1 hikey=100 volume=-1',
        '<master> hikey=90',
        '<group> hikey=80',
        '<region> sample=a.wav hikey=70',
        '<region> sample=b.wav',
        '<group>',
        '<region> sample=c.wav',
        '<master>',
        '<region> sample=d.wav',
        '<global>',
        '<region> sample=e.wav',
      ].join('\n'),
    );
    expect(regions.map((r) => [r.keyLo, r.keyHi, r.attenuation])).toEqual([
      [1, 70, 1],
      [1, 80, 1],
      [1, 90, 1],
      [1, 100, 1],
      [0, 127, undefined],
    ]);
  });

  it('lets a region override across opcode aliases', async () => {
    const { first } = await one(
      '<group> loopmode=loop_continuous loop_start=0 loop_end=9\n<region> sample=a.wav loop_mode=no_loop',
    );
    expect(first?.loop).toBeUndefined();
  });

  it('keeps <control> state for what follows, replaced by the next <control>', async () => {
    const { regions } = await one(
      '<control> default_path=a/ octave_offset=1\n<region> sample=x.wav key=60\n<control> default_path=b\\\n<region> sample=x.wav key=60',
    );
    expect(regions.map((r) => [r.sample, r.keyLo])).toEqual([
      ['sfz:p/a/x.wav', 72],
      ['sfz:p/b/x.wav', 60],
    ]);
  });
});

describe('counting what is left out', () => {
  it('counts unknown, unsupported, ignored headers and invalid values', async () => {
    const { regions, report } = await one(
      [
        '<curve> v001=0.5',
        '<effect> bus=main',
        '<region> sample=a.wav lokey=xyz foo=1 foo=2 cutoff=300 fil_type=lpf_2p lfo01_freq=2 volume_oncc7=3',
        '<region> sample=b.wav pitch_keycenter=sample sw_up=40',
      ].join('\n'),
    );
    expect(regions).toHaveLength(2);
    expect(report.invalid).toEqual({ lokey: 1 });
    expect(report.unknown).toEqual({ foo: 2 });
    expect(report.unsupported).toEqual({
      cutoff: 1,
      fil_type: 1,
      lfo01_freq: 1,
      volume_oncc7: 1,
      'pitch_keycenter=sample': 1,
      sw_up: 1,
    });
    expect(report.ignoredHeaders).toEqual({ curve: 1, effect: 1 });
    expect(regions[0]?.keyLo).toBe(0);
  });
});

describe('work caps on untrusted packs', () => {
  it('stops a diamond of includes at the read cap, without throwing', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 17; i += 1) {
      const next = `#include "f${String(i + 1)}.sfzh"\n`;
      files[`f${String(i)}.sfzh`] = i === 16 ? '<region> sample=leaf.wav' : next + next;
    }
    files['a.sfz'] = '#include "f0.sfzh"';
    const { report, regions } = await load(files);
    expect(report.limits).toHaveLength(1);
    expect(report.limits[0]).toMatch(/^include reads/);
    expect(regions.length).toBeLessThan(300);
    expect(isClean(report)).toBe(false);
  });

  it('stops a doubling #define chain before it allocates', async () => {
    const lines = ['#define $A0 xx'];
    for (let i = 1; i <= 40; i += 1)
      lines.push(`#define $A${String(i)} $A${String(i - 1)}$A${String(i - 1)}`);
    lines.push('<region> sample=$A40.wav');
    const { report } = await load({ 'a.sfz': lines.join('\n') });
    expect(report.limits).toHaveLength(1);
    expect(report.limits[0]).toMatch(/^define length/);
  });

  it('stops at the text cap when a define is used many times', async () => {
    const big = 'x'.repeat(LIMITS.defineLength - 10);
    const lines = [`#define $B ${big}`];
    for (let i = 0; i < 100; i += 1) lines.push('<region> sample=$B.wav');
    const { report } = await load({ 'a.sfz': lines.join('\n') });
    expect(report.limits[0]).toMatch(/^text length/);
  });

  it('stops expanding regions at the cap', async () => {
    const line = '<region> sample=t.wav lokey=0 hikey=127 pitch_keytrack=0\n';
    const { report, regions } = await load({ 'a.sfz': line.repeat(1000) });
    expect(report.limits[0]).toMatch(/^regions/);
    expect(regions.length).toBeLessThanOrEqual(LIMITS.regions);
    expect(regions.length).toBeGreaterThan(0);
  });

  it('stops copying keyswitch layers at the cap', async () => {
    const files = {
      'a.sfz': `${'<region> sample=t.wav lokey=0 hikey=127 pitch_keytrack=0\n'.repeat(700)}<region> sample=a.wav sw_last=1\n<region> sample=b.wav sw_last=2`,
    };
    const { report, regions } = await load(files);
    expect(report.limits.some((l) => l.startsWith('regions (keyswitch'))).toBe(true);
    expect(regions.length).toBeLessThanOrEqual(LIMITS.regions);
  });
});

describe('tokenizing and numbers', () => {
  it('reads an opcode straight after a header', async () => {
    const { regions, report } = await one('<group>lovel=64\n<region>sample=x.wav');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ sample: 'sfz:p/x.wav', velLo: 64 });
    expect(report.dropped).toEqual({});
  });

  it('refuses hex, binary, Infinity and padded numbers as invalid', async () => {
    const { report, first } = await one(
      '<region> sample=a.wav volume=0x10 tune=Infinity pan=0b1 transpose=1e999',
    );
    expect(report.invalid).toEqual({ volume: 1, tune: 1, pan: 1, transpose: 1 });
    expect(first?.attenuation).toBeUndefined();
  });

  it('counts loop points that come without a loop_mode', async () => {
    const { first, report } = await one('<region> sample=a.wav loop_start=1 loop_end=9');
    expect(first?.loop).toBeUndefined();
    expect(report.loopWithoutMode).toBe(1);
  });
});
