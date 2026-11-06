import type { Score } from '@reprise/model';
import { strToU8, zipSync, type ZipOptions, type Zippable } from 'fflate';

import type { GpifDropped } from '../gpif/dropped';
import { writeGpif } from '../gpif/write-gpif';
import { notationFlags } from '../gpif/write-tracks';

export interface GpWriteOptions {
  /** Deflate level for the zip entries, 0 (stored) to 9; 6 by default. */
  level?: ZipOptions['level'];
}

export interface GpWriteResult {
  bytes: Uint8Array;
  /** Score features the file could not carry; see `writeGpif`. */
  dropped: GpifDropped[];
}

/**
 * Zip timestamps are fixed so the same score always gives the same bytes; Guitar Pro writes its
 * own entries with the DOS epoch too.
 */
const ZIP_TIME = new Date(1980, 0, 1);

class BigEndian {
  readonly #bytes: number[] = [];

  byte(value: number): this {
    this.#bytes.push(value & 0xff);
    return this;
  }

  int(value: number): this {
    return this.byte(value >>> 24)
      .byte(value >>> 16)
      .byte(value >>> 8)
      .byte(value);
  }

  short(value: number): this {
    return this.byte(value >>> 8).byte(value);
  }

  raw(bytes: Uint8Array): this {
    for (const byte of bytes) this.#bytes.push(byte);
    return this;
  }

  done(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

/**
 * `PartConfiguration`: which tracks show standard notation and tablature, the only record the
 * reader has of a fretted track's notation and the half of its keyboard-track rule. Big-endian:
 * a count of score views, then per view a multi-rest flag, a track count and one flag byte per
 * track. Guitar Pro writes the full score view first and then one view per track, and ends with
 * the selected view's index.
 */
export function partConfiguration(score: Score): Uint8Array {
  const flags = score.tracks.map((track) => notationFlags(track));
  const out = new BigEndian().int(1 + flags.length);
  out.byte(0).int(flags.length);
  for (const flag of flags) out.byte(flag);
  for (const flag of flags) out.byte(0).int(1).byte(flag);
  return out.int(0).done();
}

/**
 * `LayoutConfiguration`: zoom, view mode and the multi-voice cursor, then a visibility byte per
 * track in every score view of the part configuration, then the selected track. Every track is
 * visible; the page view and zoom are Guitar Pro's defaults in the fixtures.
 */
export function layoutConfiguration(score: Score): Uint8Array {
  const out = new BigEndian().int(4).byte(1).byte(0);
  // The full score view's tracks, then the one track of each single-track view.
  for (let entry = 0; entry < score.tracks.length * 2; entry++) out.byte(0xff);
  return out.int(0).done();
}

type StyleValue = boolean | number | string;

/**
 * A minimal `BinaryStylesheet`: a few page and system settings with the values Guitar Pro 7
 * writes by default, so the file opens with Guitar Pro's usual look. Guitar Pro fills every
 * key a stylesheet leaves out from its defaults. Each entry is a length-prefixed key, a type
 * byte (0 bool, 1 int, 3 string) and the big-endian value.
 */
const STYLESHEET: readonly (readonly [key: string, value: StyleValue])[] = [
  ['Global/DrawChords', true],
  ['Global/DisplayTuning', true],
  ['Global/useSystemSignSeparator', false],
  ['Header/drawTitle', true],
  ['Header/Title', '%TITLE%'],
  ['Header/Artist', '%ARTIST%'],
  ['StandardNotation/hideDynamics', false],
  ['System/barIndexDrawType', 0],
  ['System/bracketExtendMode', 2],
  ['System/drawChordInScore', false],
  ['System/ExtendedBarLines', false],
  ['System/showTrackNameSingle', true],
  ['System/showTrackNameMulti', true],
  ['System/trackNameModeSingle', 0],
  ['System/trackNameModeMulti', 1],
];

export function binaryStylesheet(): Uint8Array {
  const out = new BigEndian().int(STYLESHEET.length);
  for (const [key, value] of STYLESHEET) {
    const name = strToU8(key);
    out.byte(name.length).raw(name);
    if (typeof value === 'boolean') out.byte(0).byte(value ? 1 : 0);
    else if (typeof value === 'number') out.byte(1).int(value);
    else {
      const text = strToU8(value);
      out.byte(3).short(text.length).raw(text);
    }
  }
  return out.done();
}

/** Guitar Pro 7's per-file playback preferences, every option off, as a new file has them. */
const PREFERENCES = JSON.stringify({
  tonality: { isActive: false, value: 0 },
  tempo: {
    isActive: false,
    mode: 'Constant',
    constantTempo: 100,
    fromTempo: 70,
    toTempo: 100,
    step: 10,
    repeatCount: 1,
  },
  view: { globalViewHeight: -1 },
});

/**
 * Writes a Guitar Pro 7 and 8 file: the zip Guitar Pro itself writes, with `score.gpif` from
 * `writeGpif` and generated minimal versions of the view entries beside it (stylesheet, layout,
 * part configuration, preferences), in Guitar Pro's entry order. What the score holds that the
 * file cannot is in `dropped`.
 */
export function writeGp(score: Score, options: GpWriteOptions = {}): GpWriteResult {
  const { xml, dropped } = writeGpif(score);
  const level = options.level ?? 6;
  const entries: Zippable = {
    'Content/': [new Uint8Array(0), { level: 0 }],
    'Content/BinaryStylesheet': binaryStylesheet(),
    'Content/LayoutConfiguration': layoutConfiguration(score),
    'Content/PartConfiguration': partConfiguration(score),
    'Content/Preferences.json': strToU8(PREFERENCES),
    'Content/score.gpif': strToU8(xml),
    VERSION: strToU8('7.0'),
  };
  return { bytes: zipSync(entries, { level, mtime: ZIP_TIME }), dropped };
}
