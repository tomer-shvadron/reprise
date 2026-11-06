/**
 * Writes `packages/audio/test-fixtures/synthetic.sf2`, the few-KB SoundFont the SF2 loader's
 * tests run against. Every value is chosen so a test can assert it by hand; the comments on
 * each zone say which behaviour it exists to prove.
 *
 *   node scripts/sounds/make-test-sf2.ts           rewrite the fixture
 *   node scripts/sounds/make-test-sf2.ts --check   exit 1 if the committed fixture differs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

export const FIXTURE_PATH = join(
  import.meta.dirname,
  '../../packages/audio/test-fixtures/synthetic.sf2',
);

/** SF2 2.04 generator operators used below. */
const G = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modEnvToFilterFc: 11,
  pan: 17,
  sustainModEnv: 29,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  initialAttenuation: 48,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

type Generator = readonly [operator: number, amount: number];
const range = (lo: number, hi: number): number => lo | (hi << 8);

interface Zone {
  generators: Generator[];
  modulators?: number;
}

interface SampleSpec {
  name: string;
  frames: number;
  /** Signed 24-bit values; the 16-bit word goes to smpl, the low byte to sm24. */
  value: (frame: number) => number;
  rate: number;
  pitch: number;
  correction: number;
  loop?: readonly [number, number];
  type: number;
  link: number;
}

const SAMPLE_PADDING = 46;

export const SAMPLES: readonly SampleSpec[] = [
  // 0, 1: a linked stereo pair, distinct per channel so the merge's channel order is checkable.
  {
    name: 'Pair L',
    frames: 64,
    value: (i) => i * 1000,
    rate: 22_050,
    pitch: 69,
    correction: 0,
    type: 4,
    link: 1,
  },
  {
    name: 'Pair R',
    frames: 64,
    value: (i) => -i * 1000,
    rate: 22_050,
    pitch: 69,
    correction: 0,
    type: 2,
    link: 0,
  },
  // 2: looped, with a pitch correction and 24-bit low bytes.
  {
    name: 'Loop C4',
    frames: 200,
    value: (i) => ((i % 50) - 25) * 65_536 + 0x7f,
    rate: 32_000,
    pitch: 60,
    correction: -7,
    loop: [40, 140],
    type: 1,
    link: 0,
  },
  // 3, 4: drum hits; 255 is SF2's "unpitched" originalPitch, read as 60.
  {
    name: 'Kick',
    frames: 32,
    value: (i) => (32 - i) * 100_000,
    rate: 22_050,
    pitch: 255,
    correction: 0,
    type: 1,
    link: 0,
  },
  {
    name: 'Snare',
    frames: 32,
    value: (i) => (i % 2 === 0 ? 1 : -1) * 2_000_000,
    rate: 22_050,
    pitch: 38,
    correction: 0,
    type: 1,
    link: 0,
  },
  // 5, 6: a second linked pair with distinct headers, so the right zone's pitch rule and the
  // unpaired fallback are checkable apart from the pad.
  {
    name: 'Pair2 L',
    frames: 48,
    value: (i) => i * 500,
    rate: 22_050,
    pitch: 60,
    correction: 0,
    type: 4,
    link: 6,
  },
  {
    name: 'Pair2 R',
    frames: 48,
    value: (i) => -i * 500,
    rate: 22_050,
    pitch: 62,
    correction: 3,
    type: 2,
    link: 5,
  },
];

const INSTRUMENTS: readonly { name: string; global?: Zone; zones: Zone[] }[] = [
  {
    name: 'Stereo Pad',
    global: {
      generators: [
        [G.attackVolEnv, -1200],
        [G.releaseVolEnv, 0],
        [G.initialAttenuation, 30],
      ],
    },
    zones: [
      // A pair's pitch follows the right zone (7.10): the left coarseTune must not be heard.
      {
        generators: [
          [G.keyRange, range(48, 72)],
          [G.pan, -500],
          [G.coarseTune, 1],
          [G.sampleID, 0],
        ],
      },
      {
        generators: [
          [G.keyRange, range(48, 72)],
          [G.pan, 500],
          [G.fineTune, 20],
          [G.sampleID, 1],
        ],
      },
    ],
  },
  {
    name: 'Looped Lead',
    global: {
      generators: [
        [G.holdVolEnv, -2400],
        [G.decayVolEnv, 1200],
        [G.sustainVolEnv, 300],
      ],
    },
    zones: [
      // Overriding root key, fine tune, address offsets, a mono pan, loop mode 1.
      {
        generators: [
          [G.keyRange, range(0, 59)],
          [G.velRange, range(0, 63)],
          [G.startAddrsOffset, 10],
          [G.endAddrsOffset, -20],
          [G.startloopAddrsOffset, 5],
          [G.pan, -250],
          [G.fineTune, 10],
          [G.sampleModes, 1],
          [G.overridingRootKey, 62],
          [G.sampleID, 2],
        ],
      },
      // Key-scaled hold and decay: expanded to one region per key.
      {
        generators: [
          [G.keyRange, range(60, 63)],
          [G.keynumToVolEnvHold, 100],
          [G.keynumToVolEnvDecay, -50],
          [G.sampleModes, 3],
          [G.sampleID, 2],
        ],
      },
      // A filter, a delayed envelope, and the modulation envelope's transients, which are
      // reported; its sustain share of the pitch depth (700 × 50%) and of the cutoff sweep
      // (-1200 × 50%) are fixed offsets the tune and the filter must carry.
      {
        generators: [
          [G.keyRange, range(64, 127)],
          [G.initialFilterFc, 6000],
          [G.initialFilterQ, 60],
          [G.modEnvToFilterFc, -1200],
          [G.delayVolEnv, -3600],
          [G.coarseTune, 1],
          [G.modEnvToPitch, 700],
          [G.sustainModEnv, 500],
          [G.sampleModes, 3],
          [G.sampleID, 2],
        ],
      },
    ],
  },
  {
    name: 'Kit',
    zones: [
      {
        generators: [
          [G.keyRange, range(36, 36)],
          [G.scaleTuning, 0],
          [G.sampleID, 3],
        ],
        modulators: 1,
      },
      {
        generators: [
          [G.keyRange, range(38, 38)],
          [G.exclusiveClass, 1],
          [G.sampleID, 4],
        ],
      },
    ],
  },
  // A pair whose right zone differs in a non-pitch generator: merged, and counted as a mismatch.
  {
    name: 'Stereo Mismatch',
    zones: [
      {
        generators: [
          [G.keyRange, range(48, 72)],
          [G.pan, -500],
          [G.attackVolEnv, -1200],
          [G.sampleID, 5],
        ],
      },
      {
        generators: [
          [G.keyRange, range(48, 72)],
          [G.pan, 500],
          [G.attackVolEnv, 0],
          [G.sampleID, 6],
        ],
      },
    ],
  },
  // A pair whose zones cover different keys: two mono halves, each with its own pan.
  {
    name: 'Stereo Split',
    zones: [
      {
        generators: [
          [G.keyRange, range(48, 60)],
          [G.pan, -500],
          [G.sampleID, 5],
        ],
      },
      {
        generators: [
          [G.keyRange, range(48, 72)],
          [G.pan, 500],
          [G.sampleID, 6],
        ],
      },
    ],
  },
];

const PRESETS: readonly {
  name: string;
  bank: number;
  program: number;
  global?: Zone;
  zones: Zone[];
}[] = [
  {
    name: 'Pad',
    bank: 0,
    program: 0,
    zones: [
      // Offsets add to the instrument's values; keyRange intersects; sampleModes is
      // instrument-only and must be ignored at preset level.
      {
        generators: [
          [G.keyRange, range(60, 127)],
          [G.attackVolEnv, 1200],
          [G.initialAttenuation, 20],
          [G.sampleModes, 1],
          [G.instrument, 0],
        ],
      },
    ],
  },
  {
    name: 'Lead',
    bank: 0,
    program: 25,
    global: { generators: [[G.fineTune, 5]] },
    zones: [{ generators: [[G.instrument, 1]] }],
  },
  {
    name: 'Lead Variation',
    bank: 8,
    program: 25,
    zones: [
      {
        generators: [
          [G.coarseTune, -12],
          [G.instrument, 1],
        ],
      },
    ],
  },
  { name: 'Standard Kit', bank: 128, program: 0, zones: [{ generators: [[G.instrument, 2]] }] },
  { name: 'Stereo Mismatch', bank: 0, program: 1, zones: [{ generators: [[G.instrument, 3]] }] },
  { name: 'Stereo Split', bank: 0, program: 2, zones: [{ generators: [[G.instrument, 4]] }] },
];

class Writer {
  readonly #parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.#parts.push(bytes);
    this.length += bytes.length;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

function record(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

function text(view: DataView, offset: number, value: string, length: number): void {
  for (let i = 0; i < Math.min(value.length, length - 1); i += 1) {
    view.setUint8(offset + i, value.codePointAt(i) ?? 0);
  }
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length + (body.length % 2);
  return record(8 + padded, (view) => {
    text(view, 0, id, 5);
    view.setUint32(4, body.length, true);
    new Uint8Array(view.buffer).set(body, 8);
  });
}

function list(type: string, children: Uint8Array[]): Uint8Array {
  const body = new Writer();
  body.push(
    record(4, (view) => {
      text(view, 0, type, 5);
    }),
  );
  for (const child of children) body.push(child);
  return chunk('LIST', body.bytes());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const writer = new Writer();
  for (const part of parts) writer.push(part);
  return writer.bytes();
}

function zstr(value: string): Uint8Array {
  return record(value.length + 1 + ((value.length + 1) % 2), (view) => {
    text(view, 0, value, value.length + 1);
  });
}

/** Zones as bag, gen and mod records; `bagBase` and the counters carry across headers. */
function zoneRecords(headers: readonly { global?: Zone; zones: Zone[] }[]): {
  bags: number[];
  gens: Uint8Array[];
  bagStarts: number[];
  mods: number;
} {
  const bags: number[] = [];
  const genRecords: Uint8Array[] = [];
  const bagStarts: number[] = [];
  let mods = 0;
  const modIndex: number[] = [];
  for (const header of headers) {
    bagStarts.push(bags.length);
    for (const zone of [...(header.global ? [header.global] : []), ...header.zones]) {
      bags.push(genRecords.length);
      modIndex.push(mods);
      mods += zone.modulators ?? 0;
      for (const [operator, amount] of zone.generators) {
        genRecords.push(
          record(4, (view) => {
            view.setUint16(0, operator, true);
            view.setInt16(2, amount > 0x7f_ff ? amount - 0x1_00_00 : amount, true);
          }),
        );
      }
    }
  }
  bagStarts.push(bags.length);
  bags.push(genRecords.length);
  modIndex.push(mods);
  const packed = bags.flatMap((gen, i) => [gen, modIndex[i] ?? 0]);
  return { bags: packed, gens: genRecords, bagStarts, mods };
}

function bagChunk(id: string, packed: number[]): Uint8Array {
  return chunk(
    id,
    record(packed.length * 2, (view) => {
      for (const [i, value] of packed.entries()) view.setUint16(i * 2, value, true);
    }),
  );
}

function genChunk(id: string, gens: Uint8Array[]): Uint8Array {
  return chunk(id, concat([...gens, new Uint8Array(4)]));
}

/** `count` modulator records that each route the default velocity source to nothing harmful. */
function modChunk(id: string, count: number): Uint8Array {
  return chunk(
    id,
    concat(
      Array.from({ length: count + 1 }, (_, i) =>
        record(10, (view) => {
          if (i === count) return;
          view.setUint16(0, 0x02, true); // source: note-on velocity
          view.setUint16(2, G.initialAttenuation, true);
          view.setInt16(4, 10, true);
        }),
      ),
    ),
  );
}

export function buildTestSf2(): Uint8Array {
  const totalFrames = SAMPLES.reduce((sum, s) => sum + s.frames + SAMPLE_PADDING, 0);
  const smpl = new DataView(new ArrayBuffer(totalFrames * 2));
  const sm24 = new Uint8Array(totalFrames + (totalFrames % 2));
  const starts: number[] = [];
  let at = 0;
  for (const sample of SAMPLES) {
    starts.push(at);
    for (let i = 0; i < sample.frames; i += 1) {
      const value = Math.max(-8_388_608, Math.min(8_388_607, sample.value(i)));
      smpl.setInt16((at + i) * 2, Math.floor(value / 256), true);
      sm24[at + i] = value & 0xff;
    }
    at += sample.frames + SAMPLE_PADDING;
  }

  const info = list('INFO', [
    chunk(
      'ifil',
      record(4, (view) => {
        view.setUint16(0, 2, true);
        view.setUint16(2, 4, true);
      }),
    ),
    chunk('isng', zstr('EMU8000')),
    chunk('INAM', zstr('Reprise synthetic test bank')),
    chunk('ICMT', zstr('Generated by scripts/sounds/make-test-sf2.ts')),
  ]);
  const sdta = list('sdta', [chunk('smpl', new Uint8Array(smpl.buffer)), chunk('sm24', sm24)]);

  const presetZones = zoneRecords(PRESETS);
  const phdr = concat([
    ...PRESETS.map((preset, i) =>
      record(38, (view) => {
        text(view, 0, preset.name, 20);
        view.setUint16(20, preset.program, true);
        view.setUint16(22, preset.bank, true);
        view.setUint16(24, presetZones.bagStarts[i] ?? 0, true);
      }),
    ),
    record(38, (view) => {
      text(view, 0, 'EOP', 20);
      view.setUint16(24, presetZones.bagStarts.at(-1) ?? 0, true);
    }),
  ]);
  const instrumentZones = zoneRecords(INSTRUMENTS);
  const inst = concat([
    ...INSTRUMENTS.map((instrument, i) =>
      record(22, (view) => {
        text(view, 0, instrument.name, 20);
        view.setUint16(20, instrumentZones.bagStarts[i] ?? 0, true);
      }),
    ),
    record(22, (view) => {
      text(view, 0, 'EOI', 20);
      view.setUint16(20, instrumentZones.bagStarts.at(-1) ?? 0, true);
    }),
  ]);
  const shdr = concat([
    ...SAMPLES.map((sample, i) =>
      record(46, (view) => {
        const start = starts[i] ?? 0;
        text(view, 0, sample.name, 20);
        view.setUint32(20, start, true);
        view.setUint32(24, start + sample.frames, true);
        view.setUint32(28, start + (sample.loop?.[0] ?? 0), true);
        view.setUint32(32, start + (sample.loop?.[1] ?? 0), true);
        view.setUint32(36, sample.rate, true);
        view.setUint8(40, sample.pitch);
        view.setInt8(41, sample.correction);
        view.setUint16(42, sample.link, true);
        view.setUint16(44, sample.type, true);
      }),
    ),
    record(46, (view) => {
      text(view, 0, 'EOS', 20);
    }),
  ]);
  const pdta = list('pdta', [
    chunk('phdr', phdr),
    bagChunk('pbag', presetZones.bags),
    modChunk('pmod', presetZones.mods),
    genChunk('pgen', presetZones.gens),
    chunk('inst', inst),
    bagChunk('ibag', instrumentZones.bags),
    modChunk('imod', instrumentZones.mods),
    genChunk('igen', instrumentZones.gens),
    chunk('shdr', shdr),
  ]);

  const body = concat([
    record(4, (view) => {
      text(view, 0, 'sfbk', 5);
    }),
    info,
    sdta,
    pdta,
  ]);
  return chunk('RIFF', body);
}

async function main(): Promise<void> {
  const bytes = buildTestSf2();
  if (argv.includes('--check')) {
    const committed = new Uint8Array(await readFile(FIXTURE_PATH));
    if (Buffer.compare(committed, bytes) !== 0) {
      console.error(`${FIXTURE_PATH} is stale; run node scripts/sounds/make-test-sf2.ts`);
      exit(1);
    }
    return;
  }
  await writeFile(FIXTURE_PATH, bytes);
  console.log(`Wrote ${FIXTURE_PATH} (${String(bytes.length)} bytes)`);
}

if (import.meta.main) await main();
