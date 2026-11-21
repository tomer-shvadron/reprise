import {
  PPQ,
  beatTicks,
  type Beat,
  type DirectionTarget,
  type JumpKind,
  type MasterBar,
  type Score,
  type Track,
} from '@reprise/model';

import type { AsciiDropCollector } from './dropped';
import type { LegendKey } from './legend';
import { length, singleLine } from './text';
import { noteToken } from './tokens';

const JUMP_WORDS: Readonly<Record<JumpKind, string>> = {
  daCapo: 'D.C.',
  dcAlCoda: 'D.C. al Coda',
  dcAlDoubleCoda: 'D.C. al Double Coda',
  dcAlFine: 'D.C. al Fine',
  dalSegno: 'D.S.',
  dsAlCoda: 'D.S. al Coda',
  dsAlDoubleCoda: 'D.S. al Double Coda',
  dsAlFine: 'D.S. al Fine',
  dalSegnoSegno: 'D.S.S.',
  dssAlCoda: 'D.S.S. al Coda',
  dssAlDoubleCoda: 'D.S.S. al Double Coda',
  dssAlFine: 'D.S.S. al Fine',
  toCoda: 'To Coda',
  toDoubleCoda: 'To Double Coda',
};

const TARGET_WORDS: Readonly<Record<DirectionTarget, string>> = {
  segno: 'Segno',
  segnoSegno: 'Segno Segno',
  coda: 'Coda',
  doubleCoda: 'Double Coda',
  fine: 'Fine',
};

export interface BlockContext {
  score: Score;
  trackIndex: number;
  track: Track;
  /** Master-bar indices, end exclusive. */
  range: { start: number; end: number };
  drops: AsciiDropCollector;
  used: Set<LegendKey>;
}

export interface BeatCell {
  /** Highest string first; `''` where the string is silent. */
  tokens: string[];
  width: number;
  chord: string;
  text: string;
  lyric: string;
  effect: 'PM' | 'LR' | undefined;
}

export type CloseKind = 'end' | 'double' | 'plain';
export type OpenKind = 'start' | 'plain';

export interface BarLayout {
  /** Master-bar index. */
  index: number;
  cells: BeatCell[];
  /** Width of the dashes between the bar lines, before any widening for words. */
  width: number;
  /** Section, time signature, tempo, volta and jumps, joined; the bar number is added per line. */
  words: string;
  /** `x3` above the repeat end, right-aligned. */
  repeatCount: string;
  open: OpenKind;
  close: CloseKind;
}

/** The tempo in force at a master bar: the last mark at or before it. */
export function tempoAt(score: Score, index: number): number | undefined {
  let bpm: number | undefined;
  for (const masterBar of score.masterBars.slice(0, index + 1)) {
    if (masterBar.tempo) bpm = masterBar.tempo.bpm;
  }
  return bpm;
}

export function bpmText(bpm: number): string {
  return String(Math.round(bpm * 10) / 10);
}

function sameEndings(a: MasterBar | undefined, b: MasterBar): boolean {
  return a !== undefined && a.alternateEndings.join(',') === b.alternateEndings.join(',');
}

function barWords(score: Score, index: number, first: boolean): string {
  const masterBar = score.masterBars[index];
  if (!masterBar) return '';
  const previous = index > 0 ? score.masterBars[index - 1] : undefined;
  const words: string[] = [];
  const { section } = masterBar;
  if (section) {
    const name = singleLine(section.name === '' ? (section.letter ?? '') : section.name);
    if (name !== '') words.push(`[${name}]`);
  }
  const { numerator, denominator } = masterBar.timeSignature;
  const timeChanged =
    previous === undefined
      ? numerator !== 4 || denominator !== 4
      : numerator !== previous.timeSignature.numerator ||
        denominator !== previous.timeSignature.denominator;
  // The first bar of a range is the reader's starting point, so it states both; bar 1 of the
  // song has its tempo in the track's header line instead.
  const startsRange = first && index > 0;
  if (timeChanged || startsRange) words.push(`${String(numerator)}/${String(denominator)}`);
  const bpm = tempoAt(score, index);
  const tempoChanged =
    index > 0 && masterBar.tempo !== undefined && masterBar.tempo.bpm !== tempoAt(score, index - 1);
  if (bpm !== undefined && (tempoChanged || startsRange)) words.push(`${bpmText(bpm)}bpm`);
  if (masterBar.alternateEndings.length > 0 && (first || !sameEndings(previous, masterBar))) {
    words.push(`${masterBar.alternateEndings.join(',')}.`);
  }
  for (const target of masterBar.targets) words.push(TARGET_WORDS[target]);
  for (const jump of masterBar.jumps) words.push(JUMP_WORDS[jump.kind]);
  return words.join(' ');
}

type RawCell = Omit<BeatCell, 'width'> & { ticks: number };

function rawCell(ctx: BlockContext, barIndex: number, beatIndex: number, beat: Beat): RawCell {
  const { track, trackIndex, drops, used } = ctx;
  const at = { bar: barIndex, voice: 0, beat: beatIndex };
  const where = { track: trackIndex, bar: barIndex, voice: 0, beat: beatIndex };
  const tokens = Array.from({ length: track.tuning.length }, () => '');
  if (!beat.rest) {
    for (const note of beat.notes) {
      const line = note.string - 1;
      if (line >= 0 && line < tokens.length) tokens[line] = noteToken(track, at, note, beat, used);
    }
  }
  if (beat.grace && beat.grace.length > 0) drops.drop('grace-notes', where);
  if (beat.effects.whammy) drops.drop('whammy', where);
  if (beat.effects.tremoloPicking !== undefined) drops.drop('tremolo-picking', where);
  if (beat.effects.brush || beat.effects.arpeggio || beat.effects.pickStroke !== undefined) {
    drops.drop('stroke', where);
  }
  if ((beat.lyrics ?? []).slice(1).some((line) => line.trim() !== '')) {
    drops.drop('lyrics-lines', where);
  }
  const palmMute = !beat.rest && beat.notes.some((note) => note.palmMute);
  const letRing = !beat.rest && beat.notes.some((note) => note.letRing);
  if (palmMute && letRing) drops.drop('effect-clash', where);
  let effect: BeatCell['effect'];
  if (palmMute) effect = 'PM';
  else if (letRing) effect = 'LR';
  return {
    tokens,
    ticks: beatTicks(beat),
    chord: singleLine(beat.chord?.name ?? ''),
    text: singleLine(beat.text ?? ''),
    lyric: singleLine(beat.lyrics?.[0] ?? ''),
    effect,
  };
}

/**
 * One master bar of the track as columns. Beats are spaced by duration: `cell` is the shortest
 * beat of the bar, kept between a sixteenth and a quarter note, and `slot` the widest token plus
 * a dash, so a beat is `slot` wide per `cell` of its length, and never narrower than what is
 * written on it. The floor keeps a bar of 64th notes from stretching a whole note across a page;
 * beats shorter than a sixteenth just get one slot.
 */
export function layoutBar(ctx: BlockContext, index: number): BarLayout {
  const { score, track, trackIndex, range } = ctx;
  const masterBar = score.masterBars[index];
  const bar = track.bars[index];
  const voice = bar?.voices[0].beats ?? [];
  bar?.voices.slice(1).forEach((other, offset) => {
    other.beats.forEach((beat, beatIndex) => {
      if (!beat.rest && beat.notes.length > 0) {
        ctx.drops.drop('other-voices', {
          track: trackIndex,
          bar: index,
          voice: offset + 1,
          beat: beatIndex,
        });
      }
    });
  });
  const raw = voice.map((beat, beatIndex) => rawCell(ctx, index, beatIndex, beat));
  const widest = Math.max(0, ...raw.flatMap((cell) => cell.tokens.map(length)));
  const slot = Math.max(2, widest + 1);
  const shortest = Math.max(PPQ / 4, Math.min(PPQ, ...raw.map((cell) => cell.ticks)));
  const cells = raw.map(({ ticks, ...cell }): BeatCell => {
    // An effect label is two characters, and a run needs a gap after it.
    const word = Math.max(
      length(cell.chord),
      length(cell.text),
      length(cell.lyric),
      cell.effect ? 2 : 0,
    );
    return { ...cell, width: Math.max(slot, Math.round((slot * ticks) / shortest), word + 1) };
  });
  const numerator = masterBar?.timeSignature.numerator ?? 4;
  const width =
    cells.length === 0 ? 2 * numerator : 1 + cells.reduce((sum, cell) => sum + cell.width, 0);
  const endCount = masterBar?.repeat.endCount ?? 0;
  return {
    index,
    cells,
    width,
    words: barWords(score, index, index === range.start),
    repeatCount: endCount > 2 ? `x${String(endCount)}` : '',
    open: masterBar?.repeat.start ? 'start' : 'plain',
    close: endCount > 0 ? 'end' : masterBar?.doubleBar ? 'double' : 'plain',
  };
}
