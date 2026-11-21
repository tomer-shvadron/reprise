import {
  TIE_REACH_BARS,
  tieOriginOf,
  type Beat,
  type Bend,
  type Note,
  type Track,
  type TiePosition,
} from '@reprise/model';

import type { LegendKey } from './legend';

/** Whole numbers as they are, anything between frets with one decimal (`7.5`). */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The note on `note`'s string that follows `at` in its voice, within the tie reach. */
function nextOnString(
  track: Pick<Track, 'bars'>,
  at: TiePosition,
  note: Pick<Note, 'string'>,
): Note | undefined {
  const last = Math.min(track.bars.length - 1, at.bar + TIE_REACH_BARS);
  let from = at.beat + 1;
  for (let bar = at.bar; bar <= last; bar++) {
    const beats = track.bars[bar]?.voices[at.voice]?.beats ?? [];
    for (let i = from; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const found = beat.notes.find((candidate) => candidate.string === note.string);
      if (found) return found;
    }
    from = 0;
  }
  return undefined;
}

/**
 * The letters of a bend, relative to the fret it starts on. Bend values are quarter tones, so the
 * target is `fret + value / 2`.
 */
function bendText(fret: number, bend: Bend, used: Set<LegendKey>): string {
  const to = (value: number): string => num(fret + value / 2);
  const values = bend.points.map((point) => point.value);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? 0;
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const bendTo = (value: number): string => {
    used.add('b');
    return `b${to(value)}`;
  };
  const releaseTo = (value: number): string => {
    used.add('r');
    return `r${to(value)}`;
  };
  const prebendTo = (value: number): string => {
    used.add('pb');
    return `pb${to(value)}`;
  };
  switch (bend.kind) {
    case 'bend':
      return bendTo(peak);
    case 'bendRelease':
      return bendTo(peak) + releaseTo(last);
    case 'bendReleaseBend':
      return bendTo(peak) + releaseTo(low) + bendTo(last);
    case 'prebend':
      return prebendTo(peak);
    case 'prebendBend':
      return prebendTo(first) + bendTo(peak);
    case 'prebendRelease':
      return prebendTo(first) + releaseTo(last);
    case 'release':
      return releaseTo(last);
    case 'hold':
    case 'custom':
      if (peak <= 0) return '';
      return bendTo(peak) + (last === peak ? '' : releaseTo(last));
  }
}

function slideText(
  track: Pick<Track, 'bars'>,
  at: TiePosition,
  note: Note,
  used: Set<LegendKey>,
): { prefix: string; suffix: string } {
  const kinds = note.slide ?? [];
  let prefix = '';
  if (kinds.includes('intoFromBelow')) prefix = '/';
  else if (kinds.includes('intoFromAbove')) prefix = '\\';
  let suffix = '';
  const out = kinds.find((kind) => kind !== 'intoFromBelow' && kind !== 'intoFromAbove');
  if (out === 'outDown') suffix = '\\';
  else if (out === 'outUp') suffix = '/';
  else if (out !== undefined) {
    // A shift or legato slide goes to the next note on the string; with none, up is assumed.
    const next = nextOnString(track, at, note);
    suffix = next !== undefined && next.fret < note.fret ? '\\' : '/';
  }
  for (const mark of [prefix, suffix]) {
    if (mark === '/' || mark === '\\') used.add(mark);
  }
  return { prefix, suffix };
}

function fretText(note: Note, used: Set<LegendKey>): string {
  if (note.dead) {
    used.add('x');
    return 'x';
  }
  const { harmonic } = note;
  if (harmonic?.kind === 'natural') {
    used.add('<>');
    return `<${num(harmonic.value ?? note.fret)}>`;
  }
  if (harmonic) {
    used.add('[]');
    return `[${num(note.fret + (harmonic.value ?? 0))}]`;
  }
  if (note.ghost) {
    used.add('()');
    return `(${String(note.fret)})`;
  }
  return String(note.fret);
}

/**
 * One note as it is written on its string: the fret, with the technique's letters around it. A
 * tied note is nothing, so the dashes continue the note before it.
 */
export function noteToken(
  track: Pick<Track, 'kind' | 'bars'>,
  at: TiePosition,
  note: Note,
  beat: Pick<Beat, 'effects'>,
  used: Set<LegendKey>,
): string {
  if (note.tie) return '';
  let prefix = '';
  if (note.hammerPull) {
    const origin = tieOriginOf(track, at, note);
    const pull = origin !== undefined && note.fret < origin.note.fret;
    const letter = pull ? 'p' : 'h';
    used.add(letter);
    prefix = letter;
  }
  const { effects } = beat;
  if (effects.tapping) {
    prefix += 't';
    used.add('t');
  } else if (effects.slapping) {
    prefix += 's';
    used.add('s');
  } else if (effects.popping) {
    prefix += 'P';
    used.add('P');
  }
  const slide = slideText(track, at, note, used);
  let text = prefix + slide.prefix + fretText(note, used);
  if (note.bend) text += bendText(note.fret, note.bend, used);
  if (note.trill) {
    used.add('tr');
    text += `tr${String(note.trill.fret)}`;
  }
  text += slide.suffix;
  if (note.vibrato !== 'none' || (effects.vibrato !== undefined && effects.vibrato !== 'none')) {
    used.add('~');
    text += '~';
  }
  return text;
}
