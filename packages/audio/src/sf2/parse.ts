import { Gen, RANGE_GENERATORS } from './generators';

export class Sf2ParseError extends Error {
  override name = 'Sf2ParseError';
}

/** A zone's generators by operator; range amounts are kept as `lo | hi << 8`. */
export interface Sf2Zone {
  generators: ReadonlyMap<number, number>;
  modulators: number;
}

export interface Sf2Preset {
  name: string;
  program: number;
  bank: number;
  /** The global zone, when the preset has one: the first zone, without an `instrument`. */
  global?: Sf2Zone;
  zones: Sf2Zone[];
}

export interface Sf2Instrument {
  name: string;
  global?: Sf2Zone;
  zones: Sf2Zone[];
}

export const SampleType = { mono: 1, right: 2, left: 4, linked: 8, rom: 0x80_00 } as const;

/** One `shdr` record; addresses are sample frames into `smpl`. */
export interface Sf2Sample {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  link: number;
  type: number;
}

export interface Sf2Info {
  version: { major: number; minor: number };
  name: string;
  engine?: string;
  copyright?: string;
  comment?: string;
}

/** Where the PCM sits in the file bytes; nothing is copied or converted at parse time. */
export interface Sf2Pcm {
  bytes: Uint8Array;
  smplOffset: number;
  frames: number;
  /** The `sm24` low bytes, honoured only from version 2.04 on as the spec requires. */
  sm24Offset?: number;
}

export interface Sf2File {
  info: Sf2Info;
  presets: Sf2Preset[];
  instruments: Sf2Instrument[];
  samples: Sf2Sample[];
  pcm: Sf2Pcm;
}

interface Chunk {
  id: string;
  offset: number;
  size: number;
}

const decoder = new TextDecoder('latin1');

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

/** Names are NUL-padded and, in old files, may carry garbage after the NUL. */
function zstring(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end)).trim();
}

/** The sub-chunks of a chunk body; RIFF pads each chunk to an even size. */
function chunks(bytes: Uint8Array, view: DataView, start: number, end: number): Chunk[] {
  const result: Chunk[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const id = fourcc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > end) {
      throw new Sf2ParseError(`Chunk ${id} at ${String(offset)} runs past its parent`);
    }
    result.push({ id, offset: offset + 8, size });
    offset += 8 + size + (size % 2);
  }
  return result;
}

function list(bytes: Uint8Array, view: DataView, top: Chunk[], type: string): Chunk[] {
  const chunk = top.find((c) => c.id === 'LIST' && fourcc(bytes, c.offset) === type);
  if (!chunk) throw new Sf2ParseError(`Missing LIST ${type}`);
  return chunks(bytes, view, chunk.offset + 4, chunk.offset + chunk.size);
}

function records(sub: Chunk[], id: string, size: number): { offset: number; count: number } {
  const chunk = sub.find((c) => c.id === id);
  if (!chunk) throw new Sf2ParseError(`Missing ${id} chunk`);
  if (chunk.size % size !== 0 || chunk.size < size) {
    throw new Sf2ParseError(
      `${id} size ${String(chunk.size)} is not a multiple of ${String(size)}`,
    );
  }
  return { offset: chunk.offset, count: chunk.size / size };
}

interface Bag {
  gen: number;
  mod: number;
}

function readBags(view: DataView, at: { offset: number; count: number }): Bag[] {
  return Array.from({ length: at.count }, (_, i) => ({
    gen: view.getUint16(at.offset + i * 4, true),
    mod: view.getUint16(at.offset + i * 4 + 2, true),
  }));
}

/**
 * Builds the zones of one header from its bag range. A zone ends at its terminal generator
 * (`instrument` or `sampleID`) and the spec ignores anything after it; a first zone without
 * one is the global zone, any later one is malformed and dropped.
 */
function readZones(
  view: DataView,
  bags: Bag[],
  gens: { offset: number; count: number },
  first: number,
  last: number,
  terminal: number,
): { global?: Sf2Zone; zones: Sf2Zone[] } {
  let global: Sf2Zone | undefined;
  const zones: Sf2Zone[] = [];
  for (let b = first; b < last; b += 1) {
    const bag = bags[b];
    const next = bags[b + 1];
    if (!bag || !next) throw new Sf2ParseError(`Bag ${String(b)} is out of range`);
    const generators = new Map<number, number>();
    let terminated = false;
    for (let g = bag.gen; g < next.gen && g < gens.count; g += 1) {
      const at = gens.offset + g * 4;
      const operator = view.getUint16(at, true);
      const amount = RANGE_GENERATORS.has(operator)
        ? view.getUint16(at + 2, true)
        : operator === terminal
          ? view.getUint16(at + 2, true)
          : view.getInt16(at + 2, true);
      generators.set(operator, amount);
      if (operator === terminal) {
        terminated = true;
        break;
      }
    }
    const zone: Sf2Zone = { generators, modulators: Math.max(0, next.mod - bag.mod) };
    if (terminated) zones.push(zone);
    else if (b === first) global = zone;
  }
  return { ...(global && { global }), zones };
}

function readInfo(bytes: Uint8Array, view: DataView, sub: Chunk[]): Sf2Info {
  const text = (id: string): string | undefined => {
    const chunk = sub.find((c) => c.id === id);
    return chunk ? zstring(bytes, chunk.offset, chunk.size) : undefined;
  };
  const ifil = sub.find((c) => c.id === 'ifil');
  if (!ifil) throw new Sf2ParseError('Missing ifil chunk');
  const engine = text('isng');
  const copyright = text('ICOP');
  const comment = text('ICMT');
  return {
    version: {
      major: view.getUint16(ifil.offset, true),
      minor: view.getUint16(ifil.offset + 2, true),
    },
    name: text('INAM') ?? '',
    ...(engine !== undefined && { engine }),
    ...(copyright !== undefined && { copyright }),
    ...(comment !== undefined && { comment }),
  };
}

/** Reads headers, zones and sample descriptors; the PCM is left in place for `fetch`. */
export function parseSf2(input: ArrayBuffer | Uint8Array): Sf2File {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'sfbk') {
    throw new Sf2ParseError('Not a SoundFont 2 file (no RIFF sfbk header)');
  }
  const riffEnd = Math.min(bytes.byteLength, 8 + view.getUint32(4, true));
  const top = chunks(bytes, view, 12, riffEnd);

  const info = readInfo(bytes, view, list(bytes, view, top, 'INFO'));

  const sdta = list(bytes, view, top, 'sdta');
  const smpl = sdta.find((c) => c.id === 'smpl');
  if (!smpl) throw new Sf2ParseError('Missing smpl chunk');
  const frames = Math.floor(smpl.size / 2);
  const sm24 = sdta.find((c) => c.id === 'sm24');
  const has24 =
    sm24 !== undefined &&
    (info.version.major > 2 || (info.version.major === 2 && info.version.minor >= 4)) &&
    sm24.size >= frames;
  const pcm: Sf2Pcm = {
    bytes,
    smplOffset: smpl.offset,
    frames,
    ...(has24 && { sm24Offset: sm24.offset }),
  };

  const pdta = list(bytes, view, top, 'pdta');
  const phdr = records(pdta, 'phdr', 38);
  const pbag = readBags(view, records(pdta, 'pbag', 4));
  const pgen = records(pdta, 'pgen', 4);
  const inst = records(pdta, 'inst', 22);
  const ibag = readBags(view, records(pdta, 'ibag', 4));
  const igen = records(pdta, 'igen', 4);
  const shdr = records(pdta, 'shdr', 46);

  // Every header list ends in a terminal record (EOP, EOI, EOS) that only bounds the last bag.
  const presets: Sf2Preset[] = [];
  for (let i = 0; i < phdr.count - 1; i += 1) {
    const at = phdr.offset + i * 38;
    const zones = readZones(
      view,
      pbag,
      pgen,
      view.getUint16(at + 24, true),
      view.getUint16(at + 38 + 24, true),
      Gen.instrument,
    );
    presets.push({
      name: zstring(bytes, at, 20),
      program: view.getUint16(at + 20, true),
      bank: view.getUint16(at + 22, true),
      ...zones,
    });
  }

  const instruments: Sf2Instrument[] = [];
  for (let i = 0; i < inst.count - 1; i += 1) {
    const at = inst.offset + i * 22;
    instruments.push({
      name: zstring(bytes, at, 20),
      ...readZones(
        view,
        ibag,
        igen,
        view.getUint16(at + 20, true),
        view.getUint16(at + 22 + 20, true),
        Gen.sampleID,
      ),
    });
  }

  const samples: Sf2Sample[] = [];
  for (let i = 0; i < shdr.count - 1; i += 1) {
    const at = shdr.offset + i * 46;
    samples.push({
      name: zstring(bytes, at, 20),
      start: view.getUint32(at + 20, true),
      end: view.getUint32(at + 24, true),
      loopStart: view.getUint32(at + 28, true),
      loopEnd: view.getUint32(at + 32, true),
      sampleRate: view.getUint32(at + 36, true),
      originalPitch: view.getUint8(at + 40),
      pitchCorrection: view.getInt8(at + 41),
      link: view.getUint16(at + 42, true),
      type: view.getUint16(at + 44, true),
    });
  }

  return { info, presets, instruments, samples, pcm };
}
