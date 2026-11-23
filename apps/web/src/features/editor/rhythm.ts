import {
  PPQ,
  beatTicks,
  createBeat,
  type Beat,
  type Dots,
  type Duration,
  type Tuplet,
} from '@reprise/model';

/** The length of a beat as the entry keys edit it: note value, dots and tuplet. */
export interface Rhythm {
  duration: Duration;
  dots: Dots;
  tuplet: Tuplet | undefined;
}

const EPSILON = 1e-6;

/** Entry stops at a whole note and a 64th, as Guitar Pro's duration keys do. */
const LONGEST: Duration = 1;
const SHORTEST: Duration = 64;

export const TRIPLET: Tuplet = { n: 3, of: 2 };

export const QUARTER: Rhythm = { duration: 4, dots: 0, tuplet: undefined };

export function rhythmOf(beat: Pick<Beat, 'duration' | 'dots' | 'tuplet'>): Rhythm {
  return { duration: beat.duration, dots: beat.dots, tuplet: beat.tuplet };
}

export function sameRhythm(a: Rhythm, b: Rhythm): boolean {
  return (
    a.duration === b.duration &&
    a.dots === b.dots &&
    a.tuplet?.n === b.tuplet?.n &&
    a.tuplet?.of === b.tuplet?.of
  );
}

export const rhythmTicks = (rhythm: Rhythm): number =>
  beatTicks({
    duration: rhythm.duration,
    dots: rhythm.dots,
    ...(rhythm.tuplet && { tuplet: rhythm.tuplet }),
  });

/** Halves the denominator (a longer note), down to a whole note; undefined at the limit. */
export function longer(rhythm: Rhythm): Rhythm | undefined {
  if (rhythm.duration <= LONGEST) return undefined;
  const duration = (rhythm.duration / 2) as Duration;
  return { ...rhythm, duration };
}

/** Doubles the denominator (a shorter note), up to a 64th; undefined at the limit. */
export function shorter(rhythm: Rhythm): Rhythm | undefined {
  if (rhythm.duration >= SHORTEST) return undefined;
  const duration = (rhythm.duration * 2) as Duration;
  return { ...rhythm, duration };
}

/** One dot on, or off when there is one or two. */
export const toggleDot = (rhythm: Rhythm): Rhythm => ({
  ...rhythm,
  dots: rhythm.dots === 0 ? 1 : 0,
});

/** Two dots on, or off when there are two. */
export const toggleDoubleDot = (rhythm: Rhythm): Rhythm => ({
  ...rhythm,
  dots: rhythm.dots === 2 ? 0 : 2,
});

/** A triplet on, or off when the beat is any tuplet. */
export const toggleTriplet = (rhythm: Rhythm): Rhythm => ({
  ...rhythm,
  tuplet: rhythm.tuplet ? undefined : TRIPLET,
});

const NAMES: Record<number, string> = {
  1: 'whole',
  2: 'half',
  4: 'quarter',
  8: 'eighth',
  16: 'sixteenth',
  32: 'thirty-second',
  64: 'sixty-fourth',
  128: '128th',
  256: '256th',
};

const DOT_PREFIX = ['', 'dotted ', 'double-dotted '];

/** "Quarter", "Dotted eighth", "Eighth triplet". */
export function rhythmLabel(rhythm: Rhythm): string {
  const name = NAMES[rhythm.duration] ?? `1/${String(rhythm.duration)}`;
  const tuplet = rhythm.tuplet
    ? rhythm.tuplet.n === 3 && rhythm.tuplet.of === 2
      ? ' triplet'
      : ` ${String(rhythm.tuplet.n)}:${String(rhythm.tuplet.of)}`
    : '';
  const text = `${DOT_PREFIX[rhythm.dots] ?? ''}${name}${tuplet}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DURATIONS: readonly Duration[] = [1, 2, 4, 8, 16, 32, 64];

const article = (text: string): string => (/^[aeiou]/i.test(text) ? 'an' : 'a');

/** A length in ticks as a phrase: "an eighth" for a plain or dotted note, else "0.33 of a quarter". */
export function ticksLabel(ticks: number): string {
  for (const duration of DURATIONS) {
    for (const dots of [0, 1, 2] as const) {
      const rhythm: Rhythm = { duration, dots, tuplet: undefined };
      if (Math.abs(rhythmTicks(rhythm) - ticks) < EPSILON) {
        const name = rhythmLabel(rhythm).toLowerCase();
        return `${article(name)} ${name}`;
      }
    }
  }
  return `${String(Math.round((ticks / PPQ) * 100) / 100)} of a quarter`;
}

/**
 * The refusal for something that does not fit: "Bar 3 has an eighth left: a quarter does not
 * fit", or "Bar 3 is full". `room` and `needed` are ticks.
 */
export function overfullMessage(bar: number, room: number, needed: number): string {
  const wanted = ticksLabel(needed);
  if (room < EPSILON) return `Bar ${String(bar)} is full: ${wanted} does not fit`;
  return `Bar ${String(bar)} has ${ticksLabel(room)} left: ${wanted} does not fit`;
}

/** Every plain and single-dotted value a rest can take, longest first. */
const REST_VALUES: Rhythm[] = DURATIONS.flatMap((duration) =>
  ([0, 1] as const).map((dots): Rhythm => ({ duration, dots, tuplet: undefined })),
).sort((a, b) => rhythmTicks(b) - rhythmTicks(a));

/**
 * A length in ticks as rests, longest first (a greedy split into plain and dotted values);
 * undefined when it cannot be written that way, a gap shorter than a 64th or a tuplet's remainder.
 */
export function restsFor(ticks: number): Rhythm[] | undefined {
  const rests: Rhythm[] = [];
  let left = ticks;
  while (left > EPSILON) {
    const next = REST_VALUES.find((rhythm) => rhythmTicks(rhythm) <= left + EPSILON);
    if (!next) return undefined;
    rests.push(next);
    left -= rhythmTicks(next);
  }
  return rests;
}

/** Every plain and single-dotted value the model allows, longest first, down to a 256th. */
const SPLIT_VALUES: Rhythm[] = ([1, 2, 4, 8, 16, 32, 64, 128, 256] as const)
  .flatMap((duration) =>
    ([0, 1] as const).map((dots): Rhythm => ({ duration, dots, tuplet: undefined })),
  )
  .sort((a, b) => rhythmTicks(b) - rhythmTicks(a));

/**
 * A length in ticks as note values, longest first: the greedy split that `restsFor` does, but
 * reaching the 128th and 256th the model allows. Undefined when the length is not a multiple of
 * the shortest value.
 */
export function valuesFor(ticks: number): Rhythm[] | undefined {
  const values: Rhythm[] = [];
  let left = ticks;
  while (left > EPSILON) {
    const next = SPLIT_VALUES.find((rhythm) => rhythmTicks(rhythm) <= left + EPSILON);
    if (!next) return undefined;
    values.push(next);
    left -= rhythmTicks(next);
  }
  return values;
}

/** The total length of beats, in ticks. */
export const ticksOf = (beats: readonly Pick<Beat, 'duration' | 'dots' | 'tuplet'>[]): number =>
  beats.reduce((sum, beat) => sum + beatTicks(beat), 0);

/** Rest beats, with fresh ids, that fill `ticks`; undefined when no run of plain and dotted rests does. */
export function restBeats(ticks: number): Beat[] | undefined {
  return restsFor(ticks)?.map(({ duration, dots, tuplet }) =>
    createBeat({ duration, dots, rest: true, ...(tuplet && { tuplet }) }),
  );
}
