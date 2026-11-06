/**
 * Random edit sequences against a warm cache: after every step the cached layout must equal a
 * cold one byte for byte, in every notation and both modes. Undo and redo go through the model's
 * history, which replays patches into new objects as the app does, and option steps change what
 * the same cache lays out between edits.
 */
import {
  CommandError,
  createHistory,
  insertBar,
  insertBeat,
  removeBar,
  removeBeat,
  setBeatDuration,
  setBeatEffect,
  setMasterBar,
  setNote,
  setNoteEffect,
  type Command,
  type Dynamics,
  type Notation,
  type Score,
} from '@reprise/model';
import { largeScore, note, score as scoreBuilder } from '@reprise/model/testing';
import { array, assert, constantFrom, integer, oneof, property, record } from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { expectValid, stable } from './test/check-result';
import { withEffects } from './test/effects';

/** Raise locally to soak the cache; 20 keeps the unit suite fast. */
const RUNS = 20;

type Edit =
  | { kind: 'note'; at: Where; string: number; fret: number }
  | { kind: 'tie'; at: Where; string: number }
  | { kind: 'dynamics'; at: Where; dynamics: Dynamics }
  | { kind: 'duration'; at: Where; duration: 1 | 2 | 4 | 8 | 16 }
  | { kind: 'insertBeat'; at: Where }
  | { kind: 'removeBeat'; at: Where }
  | { kind: 'insertBar'; bar: number }
  | { kind: 'removeBar'; bar: number }
  | { kind: 'masterBar'; bar: number; change: 'time' | 'key' | 'repeat' }
  | { kind: 'chord'; at: Where }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'options'; change: OptionChange };

type OptionChange = 'subset' | 'notation' | 'width' | 'zoom';

/** Indices taken modulo what the score has when the edit applies. */
interface Where {
  track: number;
  bar: number;
  beat: number;
}

const where: Arbitrary<Where> = record({
  track: integer({ min: 0, max: 7 }),
  bar: integer({ min: 0, max: 63 }),
  beat: integer({ min: 0, max: 7 }),
});

const edit: Arbitrary<Edit> = oneof(
  record({
    kind: constantFrom('note' as const),
    at: where,
    string: integer({ min: 1, max: 6 }),
    fret: integer({ min: 0, max: 24 }),
  }),
  record({ kind: constantFrom('tie' as const), at: where, string: integer({ min: 1, max: 6 }) }),
  record({
    kind: constantFrom('dynamics' as const),
    at: where,
    dynamics: constantFrom<Dynamics>('pp', 'p', 'mf', 'f', 'ff'),
  }),
  record({
    kind: constantFrom('duration' as const),
    at: where,
    duration: constantFrom<1 | 2 | 4 | 8 | 16>(1, 2, 4, 8, 16),
  }),
  record({ kind: constantFrom('insertBeat' as const), at: where }),
  record({ kind: constantFrom('removeBeat' as const), at: where }),
  record({ kind: constantFrom('insertBar' as const), bar: integer({ min: 0, max: 63 }) }),
  record({ kind: constantFrom('removeBar' as const), bar: integer({ min: 0, max: 63 }) }),
  record({
    kind: constantFrom('masterBar' as const),
    bar: integer({ min: 0, max: 63 }),
    change: constantFrom<'time' | 'key' | 'repeat'>('time', 'key', 'repeat'),
  }),
  record({ kind: constantFrom('chord' as const), at: where }),
  record({ kind: constantFrom('undo' as const) }),
  record({ kind: constantFrom('redo' as const) }),
  record({
    kind: constantFrom('options' as const),
    change: constantFrom<OptionChange>('subset', 'notation', 'width', 'zoom'),
  }),
);

function beatAt(score: Score, at: Where) {
  const track = score.tracks[at.track % score.tracks.length];
  const bar = track?.bars[at.bar % Math.max(1, track.bars.length)];
  const beats = bar?.voices[0]?.beats ?? [];
  const beat = beats[at.beat % Math.max(1, beats.length)];
  return track && bar && { track, bar, beat, index: at.bar % track.bars.length };
}

/** The fret of the latest note on `string` before the beat, in voice 1, within three bars. */
function previousFret(score: Score, at: Where, string: number): number | undefined {
  const found = beatAt(score, at);
  if (!found?.beat) return undefined;
  const { track, index } = found;
  let fret: number | undefined;
  for (let b = Math.max(0, index - 3); b <= index; b++) {
    for (const beat of track.bars[b]?.voices[0]?.beats ?? []) {
      if (beat.id === found.beat.id) return fret;
      fret = beat.notes.find((n) => n.string === string)?.fret ?? fret;
    }
  }
  return fret;
}

function command(score: Score, step: Edit): Command | undefined {
  const masterBar = (bar: number) => score.masterBars[bar % score.masterBars.length];
  switch (step.kind) {
    case 'insertBar':
      return insertBar({ index: step.bar % (score.masterBars.length + 1) });
    case 'removeBar': {
      const target = masterBar(step.bar);
      return target && removeBar({ masterBarId: target.id });
    }
    case 'masterBar': {
      const target = masterBar(step.bar);
      if (!target) return undefined;
      if (step.change === 'time') {
        const { numerator } = target.timeSignature;
        return setMasterBar(
          { masterBarId: target.id },
          { timeSignature: { numerator: numerator === 4 ? 3 : 4, denominator: 4 } },
        );
      }
      if (step.change === 'key') {
        const fifths = target.keySignature.fifths === 0 ? 3 : 0;
        return setMasterBar(
          { masterBarId: target.id },
          { keySignature: { ...target.keySignature, fifths } },
        );
      }
      return setMasterBar(
        { masterBarId: target.id },
        { repeat: { start: !target.repeat.start, endCount: target.repeat.endCount > 0 ? 0 : 3 } },
      );
    }
    case 'undo':
    case 'redo':
    case 'options':
      return undefined;
    default:
      break;
  }
  const found = beatAt(score, step.at);
  const beat = found?.beat;
  if (step.kind === 'insertBeat') {
    const voice = found?.bar.voices[0];
    return voice && insertBeat({ voiceId: voice.id, index: 0 }, { duration: 16 });
  }
  if (!beat) return undefined;
  switch (step.kind) {
    case 'note':
      return setNote({ beatId: beat.id }, { string: step.string, fret: step.fret });
    case 'tie': {
      const fret = previousFret(score, step.at, step.string);
      return fret === undefined
        ? undefined
        : setNote({ beatId: beat.id }, { string: step.string, fret, tie: true });
    }
    case 'dynamics': {
      const first = beat.notes[0];
      return first && setNoteEffect({ noteId: first.id }, { dynamics: step.dynamics });
    }
    case 'duration':
      return setBeatDuration({ beatId: beat.id }, { duration: step.duration });
    case 'removeBeat':
      return removeBeat({ beatId: beat.id });
    case 'chord':
      return setBeatEffect({ beatId: beat.id }, { chord: { name: 'Cmaj7(add9,#11)/G' } });
  }
}

/**
 * String 1 rests for two bars between tied notes, so a tie's continuation sits three bars after
 * its origin, across system breaks at a narrow width.
 */
function sparseScore(): Score {
  const builder = scoreBuilder().track('guitar');
  for (let bar = 0; bar < 24; bar++) {
    const phase = bar % 4;
    builder.bar();
    if (phase === 0) builder.beat('2', [note(1, 5)]).beat('2', [note(1, 7)]);
    else if (phase === 3) builder.beat('2', [note(1, 7, { tie: true })]).beat('2', [note(2, 3)]);
    else builder.beat('1', [note(3, 2)]);
  }
  return builder.build();
}

const SCORES: Record<'large' | 'sparse', () => Score> = {
  large: () => withEffects(largeScore(3, 32, { structure: true })),
  sparse: sparseScore,
};

function optionsFor(
  score: Score,
  notation: Notation,
  mode: LayoutOptions['mode'],
  subset: boolean,
): LayoutOptions {
  const tracks = subset ? score.tracks.filter((_, i) => i % 3 !== 1).map(({ id }) => id) : 'all';
  return {
    mode,
    width: mode === 'paged' ? PAGE_SIZES.a4.width : 640,
    pageHeight: PAGE_SIZES.a4.height,
    zoom: 1,
    tracks,
    notation: Object.fromEntries(score.tracks.map(({ id }) => [id, notation])),
  };
}

const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];

/** Toggles one option the cache keys on; the track ids are the score's, which edits keep. */
function changeOptions(score: Score, options: LayoutOptions, change: OptionChange): LayoutOptions {
  switch (change) {
    case 'subset':
      return {
        ...options,
        tracks:
          options.tracks === 'all'
            ? score.tracks.filter((_, i) => i % 3 !== 1).map(({ id }) => id)
            : 'all',
      };
    case 'notation': {
      const id = score.tracks[0]?.id ?? '';
      const current = options.notation[id] ?? 'tab';
      const next = NOTATIONS[(NOTATIONS.indexOf(current) + 1) % NOTATIONS.length] ?? 'tab';
      return { ...options, notation: { ...options.notation, [id]: next } };
    }
    case 'width':
      return { ...options, width: options.width === 480 ? PAGE_SIZES.a4.width : 480 };
    case 'zoom':
      return { ...options, zoom: options.zoom === 1 ? 1.25 : 1 };
  }
}

describe('LayoutCache: random edits', () => {
  const cases = (['tab', 'standard', 'both'] as const).flatMap((notation) =>
    (['paged', 'continuous'] as const).map((mode) => [notation, mode] as const),
  );
  it.each(cases)(
    'keeps cached equal to cold in %s notation, %s mode',
    (notation, mode) => {
      assert(
        property(
          constantFrom<'large' | 'sparse'>('large', 'sparse'),
          integer({ min: 0, max: 2 }),
          array(edit, { minLength: 1, maxLength: 8 }),
          (which, subsetDie, edits) => {
            let score = SCORES[which]();
            let options = optionsFor(score, notation, mode, subsetDie === 0);
            const cache = new LayoutCache();
            layout(score, options, cache);
            const history = createHistory();
            for (const step of edits) {
              let touched: string[] = [];
              if (step.kind === 'options') {
                options = changeOptions(score, options, step.change);
              } else if (step.kind === 'undo' || step.kind === 'redo') {
                const replayed = step.kind === 'undo' ? history.undo() : history.redo();
                if (!replayed) continue;
                score = replayed.score;
                touched = replayed.change.touchedBars;
              } else {
                const made = command(score, step);
                if (!made) continue;
                try {
                  const applied = history.apply(score, made);
                  score = applied.score;
                  touched = applied.change.touchedBars;
                } catch (error) {
                  if (error instanceof CommandError) continue;
                  throw error;
                }
              }
              const cached = layout(score, { ...options, dirtyBars: touched }, cache);
              expect(stable(cached), JSON.stringify(step)).toBe(stable(layout(score, options)));
              expectValid(cached);
            }
          },
        ),
        { numRuns: RUNS },
      );
    },
    60_000,
  );
});
