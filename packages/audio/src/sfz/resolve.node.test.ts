import { describe, expect, it } from 'vitest';

import { RegionMap } from '../sampler/region-map';
import { loadSfz } from './load';
import { isClean } from './report';
import { memoryReader } from './test-reader';

async function regionsOf(body: string, group = '') {
  const text = `<region> sample=s.wav ${body}`;
  const { regions, report } = await loadSfz(
    'a.sfz',
    memoryReader({ 'a.sfz': `${group}\n${text}` }),
    {
      packId: 'p',
    },
  );
  return { regions, report, first: regions[0] };
}

describe('opcode to Region', () => {
  it('defaults like SFZ', async () => {
    const { first } = await regionsOf('');
    expect(first).toEqual({
      keyLo: 0,
      keyHi: 127,
      velLo: 0,
      velHi: 127,
      rootKey: 60,
      tune: 0,
      sample: 'sfz:p/s.wav',
      envelope: { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.001 },
    });
  });

  it.each([
    ['lokey=c3 hikey=g#4', { keyLo: 48, keyHi: 68 }],
    ['lokey=C#2 hikey=Bb3', { keyLo: 37, keyHi: 58 }],
    ['key=a4', { keyLo: 69, keyHi: 69, rootKey: 69 }],
    ['key=60 pitch_keycenter=62', { rootKey: 62 }],
    ['lokey=10 hikey=20 pitch_keycenter=15', { keyLo: 10, rootKey: 15 }],
    ['lovel=20 hivel=90', { velLo: 20, velHi: 90 }],
    ['tune=12 transpose=2', { tune: 212 }],
    ['volume=-6', { attenuation: 6 }],
    ['volume=4', { attenuation: -4 }],
    ['amp_veltrack=0', { velocityTrack: 0 }],
    ['amp_veltrack=50', { velocityTrack: 0.5 }],
    ['pan=-50', { pan: -0.5 }],
    [
      'ampeg_delay=0.1 ampeg_attack=0.2 ampeg_hold=0.3 ampeg_decay=0.4 ampeg_sustain=25 ampeg_release=0.5',
      {
        envelope: { delay: 0.1, attack: 0.2, hold: 0.3, decay: 0.4, sustain: 0.25, release: 0.5 },
      },
    ],
    ['loop_mode=one_shot', { oneShot: true }],
    [
      'loop_mode=loop_continuous loop_start=10 loop_end=99',
      { loop: { start: 10, end: 100, unit: 'frames' } },
    ],
    [
      'loopmode=loop_sustain loopstart=5 loopend=50',
      { loop: { start: 5, end: 51, unit: 'frames' } },
    ],
    ['offset=1234', { startFrame: 1234 }],
    ['group=3 off_by=4', { group: 3, offBy: 4 }],
    ['group=3 offby=4', { group: 3, offBy: 4 }],
    ['trigger=release', { trigger: 'release' }],
    ['trigger=first', { trigger: 'first' }],
    ['trigger=attack', {}],
    ['seq_length=4 seq_position=3', { sequence: { length: 4, position: 3 } }],
    ['lorand=0.25 hirand=0.75', { random: { lo: 0.25, hi: 0.75 } }],
  ])('%s', async (body, expected) => {
    const { first, report } = await regionsOf(body);
    expect(first).toMatchObject(expected);
    expect(report.invalid).toEqual({});
    if (!('loop' in expected)) expect(first?.loop).toBeUndefined();
  });

  it('applies note_offset and octave_offset to the keys', async () => {
    const { first } = await regionsOf('key=60', '<control> note_offset=2 octave_offset=-1');
    expect(first).toMatchObject({ keyLo: 50, keyHi: 50, rootKey: 50 });
  });

  it('plays a loop mode without loop points unlooped and counts the embedded loop', async () => {
    const { first, report } = await regionsOf('loop_mode=loop_continuous');
    expect(first?.loop).toBeUndefined();
    expect(report.embeddedLoop).toBe(1);
  });

  it('clamps a veltrack outside 0..100 and counts it', async () => {
    const { first, report } = await regionsOf('amp_veltrack=-20');
    expect(first?.velocityTrack).toBe(0);
    expect(report.clamped).toEqual({ amp_veltrack: 1 });
  });

  it('expands pitch_keytrack into one region per key, rooted on itself', async () => {
    const { regions } = await regionsOf(
      'lokey=40 hikey=42 pitch_keycenter=40 pitch_keytrack=0 tune=7',
    );
    expect(regions.map((r) => [r.keyLo, r.keyHi, r.rootKey, r.tune])).toEqual([
      [40, 40, 40, 7],
      [41, 41, 41, 7],
      [42, 42, 42, 7],
    ]);
    const half = await regionsOf('lokey=40 hikey=41 pitch_keycenter=40 pitch_keytrack=50');
    expect(half.regions.map((r) => r.tune)).toEqual([0, 50]);
  });

  it('keeps a mono-key keytrack region pitched by the offset from its centre', async () => {
    const { first } = await regionsOf('key=44 pitch_keycenter=40 pitch_keytrack=50');
    expect(first).toMatchObject({ rootKey: 44, tune: 200 });
  });
});

describe('dropped regions', () => {
  it.each([
    ['', 'sample=', 'noSample'],
    ['', 'sample=*sine key=60', 'generator'],
    ['', 'sample=*silence', 'generator'],
    ['', 'key=-1', 'disabledKey'],
    ['', 'lokey=70 hikey=60', 'badKeyRange'],
    ['', 'lovel=90 hivel=20', 'badVelocity'],
    ['', 'hivel=200', 'badVelocity'],
    ['', 'lorand=0.8 hirand=0.2', 'badRandom'],
  ])('%s %s', async (_group, body, reason) => {
    const text = body.startsWith('sample=') ? `<region> ${body}` : `<region> sample=s.wav ${body}`;
    const { regions, report } = await loadSfz('a.sfz', memoryReader({ 'a.sfz': text }), {
      packId: 'p',
    });
    expect(regions).toEqual([]);
    expect(report.dropped).toEqual({ [reason]: 1 });
  });
});

describe('pack paths are untrusted', () => {
  it.each([
    '../../etc/passwd',
    '..\\secret.wav',
    '/abs/path.wav',
    'C:\\Windows\\x.wav',
    'a/../../b.wav',
  ])('refuses %s', async (sample) => {
    const { regions, report } = await loadSfz(
      'a.sfz',
      memoryReader({ 'a.sfz': `<region> sample=${sample}` }),
      { packId: 'p' },
    );
    expect(regions).toEqual([]);
    expect(report.escapedPaths).toEqual([sample]);
    expect(report.dropped).toEqual({ escapesRoot: 1 });
  });

  it('normalizes backslashes and dot segments, relative to the SFZ file', async () => {
    const { regions } = await loadSfz(
      'inst/guitar/a.sfz',
      memoryReader({
        'inst/guitar/a.sfz':
          '<control> default_path=..\\samples\\\n<region> sample=./sub\\x.wav\n<region> sample=y.wav',
      }),
      { packId: 'p' },
    );
    expect(regions.map((r) => r.sample)).toEqual([
      'sfz:p/inst/samples/sub/x.wav',
      'sfz:p/inst/samples/y.wav',
    ]);
  });
});

describe('keyswitch layers', () => {
  const pack = [
    '<global> sw_lokey=24 sw_hikey=26 sw_default=25',
    '<region> sample=plain.wav key=60',
    '<region> sample=a.wav key=60 sw_last=24 sw_label=Sustain',
    '<region> sample=b.wav key=60 sw_last=25 sw_label=Mute',
    '<region> sample=b2.wav key=61 sw_last=25',
  ].join('\n');

  it('names a layer per sw_last and copies unswitched regions into each', async () => {
    const { regions, layers, keyswitchRange } = await loadSfz(
      'a.sfz',
      memoryReader({ 'a.sfz': pack }),
      { packId: 'p' },
    );
    expect(layers).toEqual([
      { id: 'sw:24', key: 24, label: 'Sustain' },
      { id: 'sw:25', key: 25, label: 'Mute' },
    ]);
    expect(keyswitchRange).toEqual({ lo: 24, hi: 26 });
    const by = (layer: string | undefined) =>
      regions.filter((r) => r.layer === layer).map((r) => r.sample.slice(6));
    expect(by(undefined)).toEqual(['plain.wav', 'b.wav', 'b2.wav']);
    expect(by('sw:24')).toEqual(['plain.wav', 'a.wav']);
    expect(by('sw:25')).toEqual(['plain.wav', 'b.wav', 'b2.wav']);
    const copies = regions.filter((r) => r.sample === 'sfz:p/plain.wav');
    expect(copies).toHaveLength(3);
  });

  it('defaults to the lowest switch and says so when the pack names none', async () => {
    const { regions, report } = await loadSfz(
      'a.sfz',
      memoryReader({
        'a.sfz': '<region> sample=a.wav sw_last=30\n<region> sample=b.wav sw_last=28',
      }),
      { packId: 'p' },
    );
    expect(regions.filter((r) => r.layer === undefined).map((r) => r.sample)).toEqual([
      'sfz:p/b.wav',
    ]);
    expect(report.notes).toEqual(['No usable sw_default: the default layer plays sw:28']);
  });

  it('puts a whole file under one layer name', async () => {
    const { regions, layers } = await loadSfz('a.sfz', memoryReader({ 'a.sfz': pack }), {
      packId: 'p',
      layer: 'palmMute',
    });
    expect(layers.map((l) => l.id)).toEqual(['palmMute/sw:24', 'palmMute/sw:25']);
    expect(new Set(regions.map((r) => r.layer))).toEqual(
      new Set(['palmMute', 'palmMute/sw:24', 'palmMute/sw:25']),
    );
  });
});

describe('numeric opcodes are clamped to their range', () => {
  it.each([
    ['tune=1e308', 'tune', 1200],
    ['volume=1e300', 'attenuation', -6],
    ['volume=400', 'attenuation', -6],
    ['volume=-1e300', 'attenuation', 144],
    ['pan=900', 'pan', 1],
    ['transpose=1e300', 'tune', 12_700],
    ['ampeg_attack=1e300', undefined, undefined],
  ])('%s', async (body, field, expected) => {
    const { first, report } = await regionsOf(body);
    expect(Object.keys(report.clamped).length).toBeGreaterThan(0);
    const envelope = first?.envelope;
    for (const value of [first?.tune, first?.attenuation, first?.pan, envelope?.attack]) {
      if (value !== undefined) expect(Number.isFinite(value)).toBe(true);
    }
    if (field === 'tune') expect(first?.tune).toBe(Math.min(expected, 9600));
    else if (field) expect(first?.[field as 'attenuation' | 'pan']).toBe(expected);
    else expect(envelope?.attack).toBe(100);
  });

  it('keeps tune finite through pitch_keytrack', async () => {
    const { regions } = await regionsOf('lokey=0 hikey=127 pitch_keytrack=1e300 tune=1e300');
    expect(regions.every((r) => Math.abs(r.tune) <= 9600)).toBe(true);
  });

  it('shifts keyswitchRange by the note offset like sw_last', async () => {
    const { layers, keyswitchRange } = await loadSfz(
      'a.sfz',
      memoryReader({
        'a.sfz':
          '<control> note_offset=12\n<region> sample=a.wav sw_lokey=36 sw_hikey=40 sw_last=36',
      }),
      { packId: 'p' },
    );
    expect(layers[0]?.id).toBe('sw:48');
    expect(keyswitchRange).toEqual({ lo: 48, hi: 52 });
  });
});

describe('percent-encoded and device paths are refused', () => {
  it.each([
    '%2e%2e/%2e%2e/x.wav',
    '%2E%2E/x.wav',
    'a%2fb.wav',
    'a%5Cb.wav',
    'a%00.wav',
    'bad\u0001name.wav',
    'CON',
    'dir/nul.txt',
    'Com1.wav',
    'lpt9',
  ])('refuses %s', async (sample) => {
    const { regions, report } = await loadSfz(
      'a.sfz',
      memoryReader({ 'a.sfz': `<region> sample=${sample}` }),
      {
        packId: 'p',
      },
    );
    expect(regions).toEqual([]);
    expect(report.dropped).toEqual({ escapesRoot: 1 });
  });

  it('still accepts names that merely contain a device name or a percent sign', async () => {
    const { regions } = await loadSfz(
      'a.sfz',
      memoryReader({ 'a.sfz': '<region> sample=console 100%.wav\n<region> sample=conic.wav' }),
      { packId: 'p' },
    );
    expect(regions).toHaveLength(2);
  });
});

describe('seq_position outside seq_length', () => {
  it('keeps the impossible position so the region never plays, and counts it without failing isClean', async () => {
    const { regions, report } = await regionsOf('seq_length=3 seq_position=4 key=60');
    expect(regions[0]?.sequence).toEqual({ length: 3, position: 4 });
    expect(report.unreachable).toBe(1);
    expect(report.invalid).toEqual({});
    expect(isClean(report)).toBe(true);
    const map = new RegionMap(regions);
    for (let counter = 0; counter < 6; counter += 1) {
      expect(map.resolveAll(60, 100, undefined, { sequence: counter })).toEqual([]);
    }
  });

  it('does not layer it on the in-range takes', async () => {
    const { regions } = await regionsOf(
      'seq_position=4 key=60',
      '<group> seq_length=3\n<region> sample=a.wav seq_position=1 key=60',
    );
    const map = new RegionMap(regions);
    expect(map.resolveAll(60, 100, undefined, { sequence: 0 }).map((r) => r.sample)).toEqual([
      'sfz:p/a.wav',
    ]);
  });
});
