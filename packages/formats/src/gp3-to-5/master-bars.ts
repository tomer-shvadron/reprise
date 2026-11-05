import { ALTERNATE_ENDING_MAX, DirectionTargetSchema, createMasterBar } from '@reprise/model';
import type { MasterBar, TimeSignature, TripletFeel } from '@reprise/model';

import { hasFlag } from '../binary/binary-reader';
import { invalid } from './context';
import type { Context } from './context';
import type { Header } from './header';

const DENOMINATORS: ReadonlySet<number> = new Set([1, 2, 4, 8, 16, 32]);

function isDenominator(value: number): value is TimeSignature['denominator'] {
  return DENOMINATORS.has(value);
}
const TARGET_ORDER = DirectionTargetSchema.options;

/** Bit `n` of an alternate-ending mask is ending `n + 1`. */
function endingsOf(mask: number): number[] {
  const endings: number[] = [];
  for (let bit = 0; bit < ALTERNATE_ENDING_MAX; bit++) {
    if (hasFlag(mask, 1 << bit)) endings.push(bit + 1);
  }
  return endings;
}

/**
 * GP3 and GP4 store a count rather than a mask: the bar takes every ending up to that number
 * that no earlier bar of the same repeat has taken, so the brackets "1." and "2." are written
 * as 1 and 2, and a bracket "1.-3." followed by "4." as 3 and 4.
 */
function legacyEndings(count: number, masterBars: readonly MasterBar[]): number[] {
  const taken = new Set<number>();
  for (let i = masterBars.length - 1; i >= 0; i--) {
    const bar = masterBars[i];
    if (!bar) break;
    if ((i < masterBars.length - 1 && bar.repeat.endCount > 0) || bar.repeat.start) break;
    for (const ending of bar.alternateEndings) taken.add(ending);
  }
  const endings: number[] = [];
  for (let ending = 1; ending <= Math.min(count, ALTERNATE_ENDING_MAX); ending++) {
    if (!taken.has(ending)) endings.push(ending);
  }
  return endings;
}

export function readMasterBar(
  context: Context,
  header: Header,
  masterBars: readonly MasterBar[],
): MasterBar {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const index = masterBars.length;
  const previous = masterBars.at(-1);
  const location = { offset, bar: index };
  const flags = reader.byte();

  const time: TimeSignature = previous
    ? { ...previous.timeSignature }
    : { numerator: 4, denominator: 4 };
  if (hasFlag(flags, 0x01)) {
    const numerator = reader.byte();
    if (numerator >= 1 && numerator <= 32) time.numerator = numerator;
    else invalid(context, location, 'time signature numerator', numerator, time.numerator);
  }
  if (hasFlag(flags, 0x02)) {
    const denominator = reader.byte();
    if (isDenominator(denominator)) time.denominator = denominator;
    else invalid(context, location, 'time signature denominator', denominator, time.denominator);
  }

  const masterBar = createMasterBar({
    timeSignature: time,
    keySignature: previous ? { ...previous.keySignature } : { fifths: 0, minor: false },
    doubleBar: hasFlag(flags, 0x80),
  });
  masterBar.repeat.start = hasFlag(flags, 0x04);
  if (hasFlag(flags, 0x08)) {
    // GP5 stores the total number of plays; GP3 and GP4 store the repeats after the first.
    const count = reader.byte();
    masterBar.repeat.endCount = version >= 500 ? count : count + 1;
  }
  if (hasFlag(flags, 0x10) && version < 500) {
    masterBar.alternateEndings = legacyEndings(reader.byte(), masterBars);
  }
  if (hasFlag(flags, 0x20)) {
    const name = reader.intByteString('int');
    masterBar.section = { name, color: reader.color() };
  }
  if (hasFlag(flags, 0x40)) {
    const fifths = reader.signedByte();
    const minor = reader.byte();
    if (fifths >= -7 && fifths <= 7) masterBar.keySignature.fifths = fifths;
    else invalid(context, location, 'key signature', fifths, masterBar.keySignature.fifths);
    masterBar.keySignature.minor = minor !== 0;
  }
  if (version >= 500) {
    if (hasFlag(flags, 0x03)) {
      log.info('beam-grouping-dropped', 'beam grouping of a time signature', location);
      reader.skip(4);
    }
    masterBar.alternateEndings = endingsOf(reader.byte());
    masterBar.tripletFeel = readTripletFeel(context, location);
    // Padding.
    reader.skip(1);
  } else if (header.tripletFeel) {
    masterBar.tripletFeel = 'eighth';
  }

  for (const direction of header.directions.get(index) ?? []) {
    if ('jump' in direction) masterBar.jumps.push({ kind: direction.jump });
    else masterBar.targets.push(direction.target);
  }
  masterBar.targets.sort((a, b) => TARGET_ORDER.indexOf(a) - TARGET_ORDER.indexOf(b));
  return masterBar;
}

function readTripletFeel(context: Context, location: { offset: number; bar: number }): TripletFeel {
  const value = context.reader.byte();
  switch (value) {
    case 0: {
      return 'none';
    }
    case 1: {
      return 'eighth';
    }
    case 2: {
      return 'sixteenth';
    }
    default: {
      invalid(context, location, 'triplet feel', value, 'none');
      return 'none';
    }
  }
}

/**
 * The model puts the ending numbers on every bar of a bracket; GP5 marks only the first. A
 * marked bar passes its numbers on through the bar that closes the repeat, stopping early at a
 * bar with numbers of its own or a repeat start. A bracket with no repeat end ahead of it (the
 * final ending) stays one bar long, which is all Guitar Pro draws for it.
 */
export function propagateEndings(masterBars: MasterBar[]): void {
  for (let i = 0; i < masterBars.length; i++) {
    const bar = masterBars[i];
    if (!bar || bar.alternateEndings.length === 0 || bar.repeat.endCount > 0) continue;
    for (let j = i + 1; j < masterBars.length; j++) {
      const next = masterBars[j];
      if (!next || next.alternateEndings.length > 0 || next.repeat.start) break;
      if (next.repeat.endCount > 0) {
        for (let k = i + 1; k <= j; k++) {
          const inside = masterBars[k];
          if (inside) inside.alternateEndings = [...bar.alternateEndings];
        }
        i = j;
        break;
      }
    }
  }
}
