import {
  barStartTicks,
  beatStartTicks,
  type Beat,
  type Chord,
  type Clef,
  type Note,
  type Score,
  type Track,
} from '@reprise/model';

import { dispatchLyrics } from '../src/gpif/lyrics';

/**
 * What a gp round trip must preserve, in a form two scores can be compared by `toEqual`. The
 * reader builds fresh ids and places a few things differently from where a hand-built score put
 * them, all without changing what the score says; each normalisation below is one of those.
 *
 * - Ids are dropped.
 * - Clefs become the clef in effect at each bar: the reader takes the first bar's as the
 *   track's, and keeps only changes on later bars.
 * - Tempo marks and beat tempo changes become one list of changes in written order: gpif has
 *   one tempo track, so the reader puts a beat-level change on the first track's beat at that
 *   moment, a change at a bar start on the bar, and a ramp's end as a mark of its own. Marks
 *   that repeat the tempo in effect say nothing and are left out. Changes are timed as playback
 *   times them, an over-full bar lasting its longest voice.
 * - Program changes become a list per track by moment, for the same reason.
 * - Slide kinds are a set (gpif stores bit flags); barres are a set; all-empty lyric lines,
 *   an all-empty fingering, and a lyric block that only the reader dispatched say nothing.
 * - Bend and whammy positions and tempo values compare to 1e-6, the float noise of the ×0.6 and
 *   unit-factor conversions.
 */
export interface RoundTripView {
  score: unknown;
  tempos: unknown[];
  programs: unknown[][];
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutIds(item));
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'id') copy[key] = withoutIds(item);
    }
    return copy;
  }
  return value;
}

function tempoEvents(score: Score): unknown[] {
  const starts = barStartTicks(score);
  const marks = new Map<
    number,
    { tick: number; bpm: number; unit?: string; label?: string; ramp: number }[]
  >();
  const key = (tick: number): number => Math.round(tick * 1000);
  score.masterBars.forEach((masterBar, index) => {
    const tempo = masterBar.tempo;
    const tick = starts[index] ?? 0;
    if (tempo) marks.set(key(tick), [{ tick, ...tempo, ramp: 0 }]);
  });
  const fromBeats = new Set<number>();
  for (const track of score.tracks) {
    track.bars.forEach((bar, barIndex) => {
      for (const voice of bar.voices) {
        voice.beats.forEach((beat, beatIndex) => {
          const tempo = beat.mix?.tempo;
          if (!tempo) return;
          const tick = (starts[barIndex] ?? 0) + beatStartTicks(voice, beatIndex);
          if (fromBeats.has(key(tick))) return;
          fromBeats.add(key(tick));
          const { duration, ...mark } = tempo;
          const event = { tick, ...mark, ramp: duration ?? 0 };
          const existing = marks.get(key(tick)) ?? [];
          marks.set(key(tick), event.ramp === 0 ? [event] : [...existing, event]);
        });
      }
    });
  }
  const sorted = [...marks.values()].flat().sort((a, b) => a.tick - b.tick);
  const result: unknown[] = [];
  let previous: (typeof sorted)[number] | undefined;
  for (const event of sorted) {
    const same =
      previous !== undefined &&
      round(previous.bpm) === round(event.bpm) &&
      previous.unit === event.unit &&
      previous.label === event.label;
    if (!(event.ramp === 0 && same)) {
      result.push({ ...event, tick: round(event.tick), bpm: round(event.bpm) });
    }
    previous = event;
  }
  return result;
}

function programEvents(score: Score, track: Track): unknown[] {
  const starts = barStartTicks(score);
  const byTick = new Map<number, { tick: number; program: number }>();
  track.bars.forEach((bar, barIndex) => {
    for (const voice of bar.voices) {
      voice.beats.forEach((beat, beatIndex) => {
        const program = beat.mix?.program;
        if (program === undefined) return;
        const tick = (starts[barIndex] ?? 0) + beatStartTicks(voice, beatIndex);
        const at = Math.round(tick * 1000);
        if (!byTick.has(at)) byTick.set(at, { tick: round(tick), program });
      });
    }
  });
  let current = track.program;
  const result: unknown[] = [];
  for (const event of [...byTick.values()].sort((a, b) => a.tick - b.tick)) {
    if (event.program !== current) result.push(event);
    current = event.program;
  }
  return result;
}

function normaliseNote(note: Note): void {
  if (note.slide) note.slide = [...note.slide].sort();
  if (note.bend) {
    note.bend.points = note.bend.points.map((p) => ({
      position: round(p.position),
      value: round(p.value),
    }));
  }
}

function normaliseChord(chord: Chord): void {
  const diagram = chord.diagram;
  if (!diagram) return;
  if (diagram.fingering?.every((finger) => finger === null) === true) delete diagram.fingering;
  if (diagram.barres) {
    diagram.barres.sort((a, b) => a.fret - b.fret || a.firstString - b.firstString);
    if (diagram.barres.length === 0) delete diagram.barres;
  }
}

function normaliseBeat(beat: Beat): void {
  if (beat.mix) {
    delete beat.mix.tempo;
    delete beat.mix.program;
    if (Object.keys(beat.mix).length === 0) delete beat.mix;
  }
  if (beat.lyrics?.every((line) => line === '') === true) delete beat.lyrics;
  if (beat.chord) normaliseChord(beat.chord);
  if (beat.effects.whammy) {
    beat.effects.whammy.points = beat.effects.whammy.points.map((p) => ({
      position: round(p.position),
      value: round(p.value),
    }));
  }
  for (const note of beat.notes) normaliseNote(note);
  for (const grace of beat.grace ?? []) for (const note of grace.notes) normaliseNote(note);
}

function clefsOf(track: Track): Clef[] {
  let clef: Clef = track.display.clef ?? (track.kind === 'drums' ? 'percussion' : 'treble');
  return track.bars.map((bar) => {
    if (bar.clef) clef = bar.clef;
    return clef;
  });
}

/** The comparable view of a score; see `RoundTripView`. Works on a copy. */
export function roundTripView(source: Score): RoundTripView {
  const score = structuredClone(source);
  for (const track of score.tracks) {
    if (track.lyrics.every((line) => line.text === '')) track.lyrics = [];
    const beatLyrics = track.bars.some((bar) =>
      bar.voices.some((voice) => voice.beats.some((beat) => beat.lyrics)),
    );
    // A block with no beat lyrics is laid onto the beats by the reader, as by Guitar Pro.
    if (track.lyrics.length > 0 && !beatLyrics) dispatchLyrics(track, track.lyrics);
  }
  const tempos = tempoEvents(score);
  const programs = score.tracks.map((track) => programEvents(score, track));
  for (const masterBar of score.masterBars) delete masterBar.tempo;
  const tracks = score.tracks.map((track) => {
    const clefs = clefsOf(track);
    delete track.display.clef;
    for (const bar of track.bars) {
      delete bar.clef;
      for (const voice of bar.voices) for (const beat of voice.beats) normaliseBeat(beat);
    }
    return { ...track, clefs };
  });
  return { score: withoutIds({ ...score, tracks }), tempos, programs };
}
