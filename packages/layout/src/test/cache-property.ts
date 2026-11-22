/**
 * Shared by the cache-property-<notation>.test.ts files, one per notation so Vitest runs them in
 * parallel: the property runs are the longest tests in the layout project.
 *
 * Random edit sequences against a warm cache: after every step the cached layout must equal a
 * cold one byte for byte, in every notation and both modes. Continuous segment breaks are stable
 * (#147), so "a cold one" starts from the same previous breaks as the cache does. Undo and redo go through the model's
 * history, which replays patches into new objects as the app does, and option steps change what
 * the same cache lays out between edits.
 */
import {
  CommandError,
  createHistory,
  insertBar,
  insertBeat,
  midiNote,
  openStringPitch,
  removeBar,
  removeBeat,
  setBeatDuration,
  setBeatEffect,
  setMasterBar,
  setNote,
  setNoteEffect,
  type Beat,
  type ChordDiagram,
  type Command,
  type Id,
  type Dynamics,
  type Notation,
  type Score,
  type Track,
} from '@reprise/model';
import { largeScore, note, score as scoreBuilder } from '@reprise/model/testing';
import { array, assert, constantFrom, integer, oneof, property, record } from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { expect } from 'vitest';

import {
  DEFAULT_MARGINS,
  LayoutCache,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from '../index';
import { layoutWith } from '../layout';
import { resolveOptions } from '../options';
import { breakIds, expectInsidePages, expectValid, stable } from './check-result';
import { withEffects, withNoteMarks } from './effects';
import { randomScore } from './random-score';

/** The keep rule's band in lines, written out so that changing `UNDERFLOW` or `OVERFLOW` fails here. */
const MIN_LINES = 0.5;
const MAX_LINES = 1.5;

/** Raise locally to soak the cache; 20 keeps the unit suite fast. */
const RUNS = 20;

type Edit =
  | { kind: 'note'; at: Where; string: number; fret: number }
  | { kind: 'tie'; at: Where; string: number }
  | { kind: 'lyric'; at: Where; syllable: string }
  | { kind: 'dynamics'; at: Where; dynamics: Dynamics }
  | { kind: 'duration'; at: Where; duration: 1 | 2 | 4 | 8 | 16 }
  | { kind: 'insertBeat'; at: Where }
  | { kind: 'removeBeat'; at: Where }
  | { kind: 'insertBar'; bar: number }
  | { kind: 'removeBar'; bar: number }
  | { kind: 'masterBar'; bar: number; change: 'time' | 'key' | 'repeat' }
  | { kind: 'chord'; at: Where; diagram: 'none' | 'open' | 'barre' }
  | { kind: 'mark'; at: Where; mark: Mark }
  | { kind: 'unison'; at: Where; string: number }
  | { kind: 'voiceUnison'; at: Where; string: number }
  | { kind: 'voiceDuration'; at: Where; duration: 1 | 8 }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'jump'; steps: number }
  | { kind: 'options'; change: OptionChange };

type OptionChange = 'subset' | 'notation' | 'width' | 'zoom' | 'diagrams';

/** A note effect the five-line staves draw at the notes, toggled on a beat's first note. */
type Mark =
  'staccato' | 'accent' | 'ghost' | 'hammer' | 'harmonic' | 'slide' | 'tremolo' | 'arpeggio';

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
  record({
    kind: constantFrom('lyric' as const),
    at: where,
    syllable: constantFrom('la-', 'longer-', 'x', ''),
  }),
  record({
    kind: constantFrom('chord' as const),
    at: where,
    diagram: constantFrom<'none' | 'open' | 'barre'>('none', 'open', 'barre'),
  }),
  record({
    kind: constantFrom('mark' as const),
    at: where,
    mark: constantFrom<Mark>(
      'staccato',
      'accent',
      'ghost',
      'hammer',
      'harmonic',
      'slide',
      'tremolo',
      'arpeggio',
    ),
  }),
  record({ kind: constantFrom('unison' as const), at: where, string: integer({ min: 1, max: 6 }) }),
  record({
    kind: constantFrom('voiceUnison' as const),
    at: where,
    string: integer({ min: 1, max: 6 }),
  }),
  record({
    kind: constantFrom('voiceDuration' as const),
    at: where,
    duration: constantFrom<1 | 8>(1, 8),
  }),
  record({ kind: constantFrom('undo' as const) }),
  record({ kind: constantFrom('redo' as const) }),
  record({
    kind: constantFrom('jump' as const),
    steps: oneof(integer({ min: -4, max: -1 }), integer({ min: 1, max: 4 })),
  }),
  record({
    kind: constantFrom('options' as const),
    change: constantFrom<OptionChange>('subset', 'notation', 'width', 'zoom', 'diagrams'),
  }),
);

/** The horizontal half of `expectInsidePages`: no item past its page's sides, no system past the right margin. */
function expectInsidePagesHorizontally(result: LayoutResult): void {
  const margin = DEFAULT_MARGINS.paged.right;
  for (const system of result.systems) {
    const page = result.pages[system.page];
    if (!page) throw new Error(`${system.id} has no page`);
    const left = page.bbox.x;
    const right = page.bbox.x + page.bbox.width;
    expect(
      system.bbox.x + system.bbox.width,
      `${system.id} past the right margin`,
    ).toBeLessThanOrEqual(right - margin + 0.02);
    const items = [
      ...result.primitives.slice(system.primitives.start, system.primitives.end),
      ...result.anchors.slice(system.anchors.start, system.anchors.end),
    ];
    for (const { bbox } of items) {
      expect(bbox.x, `${system.id} item past the left edge`).toBeGreaterThanOrEqual(left - 0.02);
      expect(bbox.x + bbox.width, `${system.id} item past the right edge`).toBeLessThanOrEqual(
        right + 0.02,
      );
    }
  }
}

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

/**
 * A note on `target` at the pitch of `source`'s first note: on the first string from `string`
 * onward that `source` leaves free and that reaches the pitch within 24 frets.
 */
function unisonOn(track: Track, source: Beat, target: Beat, string: number): Command | undefined {
  const first = source.notes[0];
  if (track.kind !== 'fretted' || !first) return undefined;
  const pitch = midiNote(track, first);
  const used = new Set(source.notes.map((n) => n.string));
  for (let s = string; s <= track.tuning.length; s++) {
    const open = openStringPitch(track, s);
    if (open === undefined || used.has(s)) continue;
    const fret = pitch - open;
    if (fret >= 0 && fret <= 24) return setNote({ beatId: target.id }, { string: s, fret });
  }
  return undefined;
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
    case 'jump':
    case 'options':
      return undefined;
    default:
      break;
  }
  const found = beatAt(score, step.at);
  const beat = found?.beat;
  if (step.kind === 'voiceUnison' || step.kind === 'voiceDuration') {
    const second = found?.bar.voices[1];
    if (!found || !second) return undefined;
    const other = second.beats[0];
    // An empty second voice gets a beat first; the next such edit fills it.
    if (!other) return insertBeat({ voiceId: second.id, index: 0 }, { duration: 4 });
    if (step.kind === 'voiceDuration') {
      return setBeatDuration({ beatId: other.id }, { duration: step.duration });
    }
    const first = found.bar.voices[0].beats[0];
    return first && unisonOn(found.track, first, other, step.string);
  }
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
    case 'lyric':
      return setBeatEffect({ beatId: beat.id }, { lyrics: [step.syllable] });
    case 'chord':
      return setBeatEffect(
        { beatId: beat.id },
        { chord: { name: 'Cmaj7(add9,#11)/G', ...diagramFor(found.track, step.diagram) } },
      );
    case 'mark':
      return markCommand(beat, step.mark);
    case 'unison':
      return unisonOn(found.track, beat, beat, step.string);
  }
}

/** A diagram to add, change or leave out of a chord, so the cache sees one come, change and go. */
function diagramFor(
  track: Track,
  kind: 'none' | 'open' | 'barre',
): { diagram: ChordDiagram } | undefined {
  const strings = track.tuning.length;
  if (kind === 'none') return undefined;
  if (kind === 'open') {
    return {
      diagram: {
        baseFret: 1,
        frets: Array.from({ length: strings }, (_, i) => (i === 0 ? null : i % 3)),
      },
    };
  }
  return {
    diagram: {
      baseFret: 5,
      frets: Array.from({ length: strings }, () => 5),
      barres: [{ fret: 5, firstString: 1, lastString: strings }],
    },
  };
}

function markCommand(beat: Beat, mark: Mark): Command | undefined {
  const { effects } = beat;
  if (mark === 'tremolo') {
    const tremoloPicking = effects.tremoloPicking ? null : 32;
    return setBeatEffect({ beatId: beat.id }, { effects: { tremoloPicking } });
  }
  if (mark === 'arpeggio') {
    const arpeggio = effects.arpeggio ? null : { direction: 'down' as const };
    return setBeatEffect({ beatId: beat.id }, { effects: { arpeggio } });
  }
  const first = beat.notes[0];
  if (!first) return undefined;
  const target = { noteId: first.id };
  switch (mark) {
    case 'staccato':
      return setNoteEffect(target, { staccato: !first.staccato });
    case 'accent':
      return setNoteEffect(target, { accent: first.accent === 'none' ? 'accent' : 'none' });
    case 'ghost':
      return setNoteEffect(target, { ghost: !first.ghost });
    case 'hammer':
      return setNoteEffect(target, { hammerPull: !first.hammerPull });
    case 'harmonic':
      return setNoteEffect(target, {
        harmonic: first.harmonic ? null : { kind: 'artificial', value: 12 },
      });
    case 'slide':
      return setNoteEffect(target, { slide: first.slide ? null : ['shift'] });
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

/**
 * Hyphens that read the next bar: every bar of the first track ends on `la-` and the next opens
 * on `la`. Changes `built` in place.
 */
function withHyphens(built: Score): Score {
  for (const bar of built.tracks[0]?.bars ?? []) {
    const beats = bar.voices[0].beats;
    const first = beats[0];
    const last = beats.at(-1);
    if (first && !first.rest) first.lyrics = ['la'];
    if (last && last !== first && !last.rest) last.lyrics = ['la-'];
  }
  return built;
}

/** The first random score, by seed, that is fretted and carries diagrams. */
function diagramScore(): Score {
  for (let seed = 1; ; seed += 1) {
    const built = randomScore(seed, { diagrams: true, techniques: true });
    const diagrams = built.tracks.some((track) =>
      track.bars.some((bar) =>
        bar.voices.some((voice) => voice.beats.some((beat) => beat.chord?.diagram)),
      ),
    );
    if (diagrams) return built;
  }
}

const SCORES: Record<'large' | 'sparse' | 'diagrams', () => Score> = {
  large: () => withHyphens(withNoteMarks(withEffects(largeScore(3, 32, { structure: true })))),
  sparse: sparseScore,
  diagrams: diagramScore,
};

/**
 * Pages short enough that the large score's systems split across pages (#85): at 300 every system
 * splits, some through a track and some with a staff taller than the room; at 640 standard
 * notation, with its words, lanes and note marks, splits most systems and keeps some whole, so
 * whole and split systems share pages.
 */
const SPLIT_PAGE_HEIGHTS = [300, 640] as const;

/** Widths a sequence starts at and steps through: A4, the narrow content widths 320, 480 and 640 px, Letter. */
const WIDTHS: Readonly<Record<LayoutOptions['mode'], readonly number[]>> = {
  paged: [PAGE_SIZES.a4.width, 416, 576, 736, PAGE_SIZES.letter.width],
  continuous: [640, 900, 320, 480],
};

const widthAt = (mode: LayoutOptions['mode'], die: number): number => {
  const widths = WIDTHS[mode];
  return widths[die % widths.length] ?? PAGE_SIZES.a4.width;
};

function optionsFor(
  score: Score,
  notation: Notation,
  mode: LayoutOptions['mode'],
  subset: boolean,
  width: number,
  pageHeight: number = PAGE_SIZES.a4.height,
): LayoutOptions {
  const tracks = subset ? score.tracks.filter((_, i) => i % 3 !== 1).map(({ id }) => id) : 'all';
  return {
    mode,
    width,
    pageHeight,
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
    case 'width': {
      const widths = WIDTHS[options.mode];
      return { ...options, width: widthAt(options.mode, widths.indexOf(options.width) + 1) };
    }
    case 'zoom':
      return { ...options, zoom: options.zoom === 1 ? 1.25 : 1 };
    case 'diagrams':
      return { ...options, chordDiagrams: options.chordDiagrams === false };
  }
}

/** The (label, mode, split page height) cases each notation runs. */
export const CACHE_PROPERTY_MODES = [
  ['paged', 'paged', undefined],
  ['continuous', 'continuous', undefined],
  ...SPLIT_PAGE_HEIGHTS.map(
    (height) => [`paged at ${String(height)} px high`, 'paged', height] as const,
  ),
] as const;

/**
 * Asserts, over random edit sequences, that the warm cache equals a cold layout after every step.
 *
 * With `withReach` (continuous mode), every edit's layout passes a random `verticalReach` (0 to 6),
 * then 0 to 2 follow-up calls with no dirty bars (reach 1 to 6; 0 never makes progress, as nothing
 * is redrawn without dirty bars), each strictly lowering `staleSystems`. The next edit may land on
 * a cache that is still stale, as the app's does when a new edit cancels the follow-ups. A layout
 * is compared with cold whenever nothing is stale, and the sequence ends by converging, randomly
 * by reach calls or by one call without the option, and comparing.
 */
export function checkCachedEqualsCold(
  notation: Notation,
  mode: LayoutOptions['mode'],
  height: number | undefined,
  withReach = false,
): void {
  const split = height !== undefined;
  assert(
    property(
      constantFrom<'large' | 'sparse' | 'diagrams'>('large', 'sparse', 'diagrams'),
      integer({ min: 0, max: 2 }),
      integer({ min: 0, max: 4 }),
      array(edit, { minLength: 1, maxLength: 8 }),
      integer({ min: 0, max: 6 }),
      integer({ min: 1, max: 6 }),
      array(integer({ min: 0, max: 2 }), { minLength: 8, maxLength: 8 }),
      (which, subsetDie, widthDie, edits, reachDie, followReach, follows) => {
        const verticalReach = withReach ? reachDie : undefined;
        const followUp = withReach ? followReach : undefined;
        let score = SCORES[which]();
        const width = widthAt(mode, widthDie);
        let options = optionsFor(score, notation, mode, subsetDie === 0, width, height);
        const cache = new LayoutCache();
        const first = layout(score, options, cache);
        let breaks: ReadonlySet<Id> = breakIds(score, first);
        let systemKey = resolveOptions(score, options).systemKey;
        if (split && which === 'large' && subsetDie !== 0 && width === PAGE_SIZES.a4.width) {
          expect(first.systems.some(({ part }) => part !== undefined)).toBe(true);
          if (height === 640 && notation === 'standard') {
            expect(first.systems.some(({ part }) => part === undefined)).toBe(true);
          }
        }
        const history = createHistory();
        let lastStale = false;
        for (const [stepIndex, step] of edits.entries()) {
          let touched: string[] = [];
          let afresh = false;
          if (step.kind === 'options') {
            options = changeOptions(score, options, step.change);
            // Another width, zoom, track set or notation lays the segments out afresh; an
            // option change the layout does not key on (a subset that is every track) does not.
            const key = resolveOptions(score, options).systemKey;
            afresh = key !== systemKey;
            systemKey = key;
          } else if (step.kind === 'undo' || step.kind === 'redo') {
            const replayed = step.kind === 'undo' ? history.undo() : history.redo();
            if (!replayed) continue;
            score = replayed.score;
            touched = replayed.change.touchedBars;
          } else if (step.kind === 'jump') {
            // One layout for the whole jump, with the union of the steps' touched bars.
            const replayed = history.step(step.steps);
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
          let cached = layout(score, { ...options, dirtyBars: touched, verticalReach }, cache);
          let stale = cached.metrics.staleSystems;
          if (verticalReach === undefined) expect(stale).toBe(0);
          for (let call = 0; call < (follows[stepIndex] ?? 0) && stale > 0; call++) {
            cached = layout(score, { ...options, verticalReach: followUp }, cache);
            expect(cached.metrics.staleSystems, JSON.stringify(step)).toBeLessThan(stale);
            stale = cached.metrics.staleSystems;
          }
          if (stale > 0) {
            // Breaks do not depend on the vertical layout, so a stale layout's are the right ones.
            breaks = breakIds(score, cached);
            lastStale = true;
            continue;
          }
          lastStale = false;
          const cold = layoutWith(score, options, undefined, afresh ? undefined : breaks);
          expect(stable(cached), JSON.stringify(step)).toBe(stable(cold));
          breaks = breakIds(score, cached);
          if (mode === 'continuous') {
            // Every segment holds a bar, and they tile the score.
            let end = 0;
            cached.systems.forEach(({ bars, bbox }, i) => {
              expect(bars.start, JSON.stringify(step)).toBe(end);
              expect(bars.end).toBeGreaterThan(bars.start);
              end = bars.end;
              const lines = bbox.width / options.width;
              // A segment of several bars is at most OVERFLOW lines wide (the first one's
              // names and clefs count against its line, so this is loose there), and one
              // that is neither first nor last, nor followed by a bar too wide to share it,
              // is at least UNDERFLOW lines wide.
              if (bars.end - bars.start > 1) expect(lines).toBeLessThanOrEqual(MAX_LINES + 0.03);
              const next = cached.systems[i + 1];
              // Greedy filling ends a segment where the next bar no longer fits, so a segment
              // may be short when that bar is wide: its column plus this segment overflows
              // the line (#244). Several bars at about half a line each do this at a narrow
              // width.
              const columnId = next && score.masterBars[next.bars.start]?.id;
              const column = cached.anchors.find(
                (a) => a.kind === 'bar' && a.track === undefined && a.masterBar === columnId,
              );
              const blocked =
                column !== undefined && lines + column.bbox.width / options.width > 1 - 0.03;
              if (i > 0 && next && !blocked) expect(lines).toBeGreaterThanOrEqual(MIN_LINES - 0.03);
            });
            expect(end).toBe(score.masterBars.length);
          }
          expectValid(cached);
          if (!split) expectInsidePages(cached, DEFAULT_MARGINS[mode]);
          // At the split heights only the bottom margin overflows by design (#85): a staff taller than the room.
          else expectInsidePagesHorizontally(cached);
        }
        if (lastStale) {
          // Converge as the app does, by reach calls, or as a full run does, by one call without
          // the option; both must give a cold layout.
          const oneCall = reachDie % 2 === 0;
          let stale = Infinity;
          let converged = oneCall ? layout(score, options, cache) : undefined;
          while (!converged || converged.metrics.staleSystems > 0) {
            converged = layout(score, { ...options, verticalReach: followUp }, cache);
            if (converged.metrics.staleSystems === 0) break;
            expect(converged.metrics.staleSystems).toBeLessThan(stale);
            stale = converged.metrics.staleSystems;
          }
          expect(converged.metrics.staleSystems).toBe(0);
          expect(stable(converged)).toBe(stable(layoutWith(score, options, undefined, breaks)));
        }
      },
    ),
    { numRuns: RUNS },
  );
}
