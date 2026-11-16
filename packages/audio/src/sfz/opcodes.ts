/**
 * The opcode table: the single place that says which SFZ opcodes v1 plays, ignores with a count
 * or refuses. A test walks `OPCODES` and checks the synthetic fixture uses every name and alias,
 * so the table and the fixture cannot drift apart.
 */

export type OpcodeKind = 'int' | 'float' | 'note' | 'path' | 'text' | 'enum';

export interface OpcodeSpec {
  /** The canonical name; the resolver reads values under it. */
  name: string;
  aliases?: readonly string[];
  kind: OpcodeKind;
  /** The legal values of an `enum`. */
  values?: readonly string[];
}

const op = (
  name: string,
  kind: OpcodeKind,
  extra: { aliases?: readonly string[]; values?: readonly string[] } = {},
): OpcodeSpec => ({ name, kind, ...extra });

/** In scope: these become `Region` fields, layers or inheritance state. */
export const OPCODES: readonly OpcodeSpec[] = [
  op('default_path', 'path'),
  op('note_offset', 'int'),
  op('octave_offset', 'int'),
  op('sample', 'path'),
  op('lokey', 'note'),
  op('hikey', 'note'),
  op('key', 'note'),
  op('pitch_keycenter', 'note'),
  op('lovel', 'int'),
  op('hivel', 'int'),
  op('tune', 'float'),
  op('transpose', 'float'),
  op('pitch_keytrack', 'float'),
  op('volume', 'float'),
  op('amp_veltrack', 'float'),
  op('pan', 'float'),
  op('ampeg_delay', 'float'),
  op('ampeg_attack', 'float'),
  op('ampeg_hold', 'float'),
  op('ampeg_decay', 'float'),
  op('ampeg_sustain', 'float'),
  op('ampeg_release', 'float'),
  op('loop_mode', 'enum', {
    aliases: ['loopmode'],
    values: ['no_loop', 'one_shot', 'loop_continuous', 'loop_sustain'],
  }),
  op('loop_start', 'int', { aliases: ['loopstart'] }),
  op('loop_end', 'int', { aliases: ['loopend'] }),
  op('offset', 'int'),
  op('group', 'int'),
  op('off_by', 'int', { aliases: ['offby'] }),
  op('trigger', 'enum', { values: ['attack', 'release', 'first', 'legato'] }),
  op('seq_length', 'int'),
  op('seq_position', 'int'),
  op('rt_decay', 'float'),
  op('lorand', 'float'),
  op('hirand', 'float'),
  op('sw_lokey', 'note'),
  op('sw_hikey', 'note'),
  op('sw_last', 'note'),
  op('sw_default', 'note'),
  op('sw_label', 'text'),
];

/** Recognized and deliberately not played in v1: counted under `report.unsupported`. */
const UNSUPPORTED_NAMES = new Set([
  'sw_up',
  'sw_down',
  'sw_previous',
  'sw_vel',
  'ampeg_start',
  'off_mode',
  'offmode',
  'off_time',
  'cutoff',
  'resonance',
  'amp_keytrack',
  'polyphony',
  'note_polyphony',
  'end',
  'count',
  'delay',
  'direction',
  'width',
  'position',
  'lochan',
  'hichan',
  'lobend',
  'hibend',
  'bend_up',
  'bend_down',
  'bend_step',
]);

const UNSUPPORTED_PATTERNS: readonly RegExp[] = [
  /^fil\d*_/,
  /^cutoff\d*$/,
  /^fileg_/,
  /^pitcheg_/,
  /^ampeg_vel2/,
  /lfo/,
  /^amp_velcurve_\d+$/,
  /^xf/,
  /^delay_/,
  /_random$/,
  /^effect\d+$/,
  /cc\d+$/,
];

/** Headers whose opcodes are skipped; `<curve>`, `<effect>`, `<midi>` and `<sample>`. */
export const IGNORED_HEADERS: ReadonlySet<string> = new Set(['curve', 'effect', 'midi', 'sample']);

const BY_SPELLING = new Map<string, OpcodeSpec>();
for (const spec of OPCODES) {
  BY_SPELLING.set(spec.name, spec);
  for (const alias of spec.aliases ?? []) BY_SPELLING.set(alias, spec);
}

export type OpcodeLookup =
  { type: 'supported'; spec: OpcodeSpec } | { type: 'unsupported' } | { type: 'unknown' };

export function lookupOpcode(spelling: string): OpcodeLookup {
  const spec = BY_SPELLING.get(spelling);
  if (spec) return { type: 'supported', spec };
  if (UNSUPPORTED_NAMES.has(spelling) || UNSUPPORTED_PATTERNS.some((p) => p.test(spelling))) {
    return { type: 'unsupported' };
  }
  return { type: 'unknown' };
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const NOTE_NAME = /^([a-g])([#b]?)(-?\d+)$/i;
const SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** A MIDI note from a number (-1 allowed, it disables a region) or a name, c4 = 60. */
export function parseNote(raw: string): number | undefined {
  if (/^[+-]?\d+$/.test(raw)) {
    const value = Number(raw);
    return value >= -1 && value <= 127 ? value : undefined;
  }
  const match = NOTE_NAME.exec(raw);
  if (!match) return undefined;
  const [, letter = '', accidental = '', octave = ''] = match;
  const semitone = SEMITONE[letter.toLowerCase()];
  if (semitone === undefined) return undefined;
  const shift = accidental === '#' ? 1 : accidental === '' ? 0 : -1;
  const note = (Number(octave) + 1) * 12 + semitone + shift;
  return note >= 0 && note <= 127 ? note : undefined;
}

/** `undefined` when the value does not parse for the opcode's kind. */
export function parseValue(spec: OpcodeSpec, raw: string): number | string | undefined {
  switch (spec.kind) {
    case 'int': {
      return /^[+-]?\d+$/.test(raw) ? Number(raw) : undefined;
    }
    case 'float': {
      // Plain decimals only: Number() would also take 0x10, 0b1 and whitespace.
      if (!DECIMAL.test(raw)) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'note': {
      return parseNote(raw);
    }
    case 'enum': {
      const value = raw.toLowerCase();
      return spec.values?.includes(value) ? value : undefined;
    }
    case 'path':
    case 'text': {
      return raw === '' ? undefined : raw;
    }
  }
}
