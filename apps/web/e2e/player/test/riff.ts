import type { Score } from '@reprise/model';
import { note, score, type DurationSpec } from '@reprise/model/testing';

/** A rhythm as the entry keys spell it: '8' an eighth, '4.' a dotted quarter, '8t' a triplet. */
type Spec = DurationSpec;

/** `[string, fret]`, string 1 the highest. */
type Pitch = readonly [number, number];

interface Beat {
  rhythm: Spec;
  rest?: true;
  notes?: readonly Pitch[];
  tie?: true;
}

export type Bar = Partial<Record<0 | 1, Beat[]>>;

export type Step = { press: string; pending?: string } | { toggleInsert: 'Insert' | 'Overwrite' };

const FRETS = 24;

const parse = (spec: Spec) => ({
  duration: Number.parseInt(spec, 10),
  dots: spec.endsWith('.') ? 1 : 0,
  triplet: spec.endsWith('t'),
});

/**
 * Writes the riff once, as the keys to press and the bars they must produce, so the two cannot
 * drift. Every method pushes the keys of one gesture and records the beat it makes. `entries`
 * counts what is one undo step each: a committed fret, a rest, a tie, an appended bar.
 */
export class Riff {
  steps: Step[] = [];
  bars: Bar[] = [{}];
  entries = 0;
  /** The entry count when each bar's last beat was in, before the next bar is appended. */
  entriesAtBarEnd: number[] = [];
  #rhythm: Spec = '4';
  #string = 1;
  #voice: 0 | 1 = 0;
  /** The cursor is on the end slot of an empty voice, so the next beat needs no move first. */
  #fresh = true;

  #press(press: string) {
    this.steps.push({ press });
  }

  #advance() {
    if (!this.#fresh) this.#press('ArrowRight');
    this.#fresh = false;
  }

  #rhythmKeys(to: Spec) {
    const from = parse(this.#rhythm);
    const next = parse(to);
    if (from.triplet !== next.triplet) this.#press('/');
    if (from.dots !== next.dots) this.#press('.');
    for (let d = from.duration; d !== next.duration; d = d < next.duration ? d * 2 : d / 2) {
      this.#press(d < next.duration ? '=' : '-');
    }
    this.#rhythm = to;
  }

  #toString(string: number) {
    while (this.#string !== string) {
      const down = string > this.#string;
      this.#press(down ? 'ArrowDown' : 'ArrowUp');
      this.#string += down ? 1 : -1;
    }
  }

  /** A fret from 1 to 2 (or two digits) waits for a second digit; the status line shows it. */
  #fret(fret: number) {
    const [first, second] = String(fret);
    if (first === undefined) return;
    const waits = fret > 0 && (second !== undefined || fret * 10 <= FRETS);
    this.steps.push({ press: first, ...(waits && { pending: first }) });
    if (second !== undefined) this.#press(second);
    this.entries += 1;
  }

  #here(): Beat[] {
    const bar = this.bars.at(-1);
    if (!bar) throw new Error('no bar');
    return (bar[this.#voice] ??= []);
  }

  /** The full bar's → appends the next one: an undo step of its own. */
  nextBar() {
    this.entriesAtBarEnd.push(this.entries);
    this.#press('ArrowRight');
    this.entries += 1;
    this.bars.push({});
    this.#fresh = true;
    this.#voice = 0;
  }

  beat(rhythm: Spec, notes: readonly Pitch[]) {
    this.#advance();
    this.#rhythmKeys(rhythm);
    for (const [string, fret] of notes) {
      this.#toString(string);
      this.#fret(fret);
    }
    this.#here().push({ rhythm, notes });
  }

  rest(rhythm: Spec, via: 'r' | 'Enter' = 'r') {
    this.#advance();
    this.#rhythmKeys(rhythm);
    this.#press(via);
    this.entries += 1;
    this.#here().push({ rhythm, rest: true });
  }

  /** `l` on the end slot repeats the previous note on the string, tied to it. */
  tie(rhythm: Spec, string: number, fret: number) {
    this.#advance();
    this.#rhythmKeys(rhythm);
    this.#toString(string);
    this.#press('l');
    this.entries += 1;
    this.#here().push({ rhythm, notes: [[string, fret]], tie: true });
  }

  /** A chord with one note too many, which Backspace takes off again: two undo steps. */
  mistaken(rhythm: Spec, notes: readonly Pitch[], wrong: Pitch) {
    this.beat(rhythm, [...notes, wrong]);
    this.#press('Backspace');
    this.entries += 1;
    const beat = this.#here().at(-1);
    if (beat) beat.notes = notes;
  }

  /** Types a wrong fret, then the right one over it. */
  corrected(rhythm: Spec, string: number, wrong: number, fret: number) {
    this.#advance();
    this.#rhythmKeys(rhythm);
    this.#toString(string);
    this.#fret(wrong);
    this.#fret(fret);
    this.#here().push({ rhythm, notes: [[string, fret]] });
  }

  voice(voice: 0 | 1) {
    this.#press(`ControlOrMeta+${String(voice + 1)}`);
    this.#voice = voice;
    this.#fresh = true;
  }

  /** In insert mode, a note before the beat the cursor is on, then back to the end slot. */
  insertBeforeLast(string: number, fret: number) {
    // Off the beat and back, so it is not "just inserted", which would take the digit as a chord note.
    this.#press('ArrowLeft');
    this.#press('ArrowRight');
    this.steps.push({ toggleInsert: 'Insert' });
    this.#toString(string);
    this.#fret(fret);
    this.steps.push({ toggleInsert: 'Overwrite' });
    const beats = this.#here();
    const last = beats.pop();
    if (!last) throw new Error('nothing to insert before');
    beats.push({ rhythm: last.rhythm, notes: [[string, fret]] }, last);
    // From the new beat, over the one after it, onto the end slot.
    this.#press('ArrowRight');
    this.#press('ArrowRight');
    this.#fresh = true;
  }
}

export function riff(): Riff {
  const r = new Riff();
  // 1. A half note, long enough to be heard, then eighths on the low string.
  r.beat('2', [[6, 0]]);
  for (const fret of [0, 3, 0, 5]) r.beat('8', [[6, fret]]);
  r.nextBar();
  // 2. A dotted quarter, an eighth and a half note.
  r.beat('4.', [[5, 5]]);
  r.beat('8', [[5, 7]]);
  r.beat('2', [[4, 0]]);
  r.nextBar();
  // 3. Two-digit frets, and a lone 1 that the next key commits.
  r.beat('4', [[5, 10]]);
  r.beat('4', [[5, 12]]);
  r.beat('4', [[4, 15]]);
  r.beat('4', [[4, 1]]);
  r.nextBar();
  // 4. Chords with ↑ and ↓, then a rest typed by Enter.
  r.beat('4', [
    [4, 7],
    [5, 7],
  ]);
  r.mistaken(
    '4',
    [
      [4, 5],
      [5, 5],
    ],
    [6, 9],
  );
  r.rest('2', 'Enter');
  r.nextBar();
  // 5. A triplet group between a quarter and a half note.
  r.beat('4', [[5, 7]]);
  for (const fret of [5, 7, 9]) r.beat('8t', [[4, fret]]);
  r.beat('2', [[5, 0]]);
  r.nextBar();
  // 6 and 7. A tie across the bar line, then a rest by R.
  r.beat('2', [[3, 9]]);
  r.beat('2', [[3, 12]]);
  r.nextBar();
  r.tie('2', 3, 12);
  r.beat('4', [[3, 10]]);
  r.rest('4');
  r.nextBar();
  // 8. A whole note in voice 2 under four quarters in voice 1.
  r.voice(1);
  r.beat('1', [[6, 3]]);
  r.voice(0);
  for (const fret of [5, 5, 7, 5]) r.beat('4', [[2, fret]]);
  r.nextBar();
  // 9. A fret typed wrong and corrected.
  r.corrected('4', 5, 8, 9);
  r.beat('4', [[5, 9]]);
  r.beat('2', [[4, 10]]);
  r.nextBar();
  // 10. A note inserted before one that is there.
  r.beat('4', [[2, 3]]);
  r.beat('4', [[2, 5]]);
  r.insertBeforeLast(2, 0);
  r.beat('4', [[2, 7]]);
  r.nextBar();
  // 11. Sixteenths.
  for (const fret of [0, 0, 3, 5]) r.beat('16', [[6, fret]]);
  r.beat('8', [[6, 3]]);
  r.beat('8', [[6, 0]]);
  r.beat('4', [[6, 5]]);
  r.beat('4', [[6, 3]]);
  r.nextBar();
  // 12. A dotted rest.
  r.rest('4.');
  r.beat('8', [[5, 7]]);
  r.beat('4', [[5, 7]]);
  r.beat('4', [[4, 5]]);
  r.nextBar();
  // 13. A whole-note chord.
  r.beat('1', [
    [4, 2],
    [5, 2],
    [6, 0],
  ]);
  r.nextBar();
  // 14. Voice 2 again, under a half and two quarters.
  r.voice(1);
  r.beat('1', [[6, 5]]);
  r.voice(0);
  r.beat('2', [[5, 3]]);
  r.beat('4', [[5, 5]]);
  r.beat('4', [[5, 7]]);
  r.nextBar();
  // 15.
  for (const fret of [0, 2, 3, 0, 2, 3, 5, 3]) r.beat('8', [[6, fret]]);
  r.nextBar();
  // 16. The last note.
  r.beat('1', [[6, 0]]);
  r.entriesAtBarEnd.push(r.entries);
  return r;
}

/** The given bars, from the first, as a score. */
export function expectedScore(bars: readonly Bar[]): Score {
  const built = score().track('guitar');
  for (const bar of bars) {
    built.bar();
    for (const voice of [0, 1] as const) {
      const beats = bar[voice];
      if (!beats) continue;
      built.voice(voice);
      for (const { rhythm, rest, notes, tie } of beats) {
        if (rest) built.rest(rhythm);
        else {
          built.beat(
            rhythm,
            (notes ?? []).map(([string, fret]) => note(string, fret, tie ? { tie: true } : {})),
          );
        }
      }
    }
  }
  return built.build();
}
