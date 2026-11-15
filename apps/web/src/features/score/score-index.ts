import { beatTicks, type Id, type Score } from '@reprise/model';

export interface BeatInfo {
  masterBarIndex: number;
  /** Index into `score.tracks`. */
  trackIndex: number;
  /** `Bar.voices` index. */
  voice: number;
  /** Index among the voice's beats. */
  index: number;
  /** Ticks from the start of its bar, in its voice. */
  tick: number;
  /** The only beat of its voice and a rest: the tab staff centres it, away from its onset. */
  loneRest: boolean;
}

export interface ScoreIndex {
  barIndex: ReadonlyMap<Id, number>;
  beats: ReadonlyMap<Id, BeatInfo>;
  /** Note id, grace notes included, to its beat's id. */
  noteBeat: ReadonlyMap<Id, Id>;
  /** Note id, grace notes included, to `Note.string`. */
  noteString: ReadonlyMap<Id, number>;
}

const scoreIndexes = new WeakMap<Score, ScoreIndex>();

/** Lookups by id, built once per `Score` (an edit makes a new one, so an index is never stale). */
export function scoreIndex(score: Score): ScoreIndex {
  const cached = scoreIndexes.get(score);
  if (cached) return cached;
  const barIndex = new Map(score.masterBars.map((bar, index) => [bar.id, index]));
  const beats = new Map<Id, BeatInfo>();
  const noteBeat = new Map<Id, Id>();
  const noteString = new Map<Id, number>();
  score.tracks.forEach((track, trackIndex) => {
    track.bars.forEach((bar, masterBarIndex) => {
      bar.voices.forEach((voice, voiceIndex) => {
        let tick = 0;
        voice.beats.forEach((beat, index) => {
          const loneRest = beat.rest && voice.beats.length === 1;
          beats.set(beat.id, {
            masterBarIndex,
            trackIndex,
            voice: voiceIndex,
            index,
            tick,
            loneRest,
          });
          const own = [...beat.notes, ...(beat.grace ?? []).flatMap((grace) => grace.notes)];
          for (const note of own) {
            noteBeat.set(note.id, beat.id);
            noteString.set(note.id, note.string);
          }
          tick += beatTicks(beat);
        });
      });
    });
  });
  const index = { barIndex, beats, noteBeat, noteString };
  scoreIndexes.set(score, index);
  return index;
}

/** The index of a master bar in the score, or -1. */
export function masterBarIndexOf(score: Score, id: Id): number {
  return scoreIndex(score).barIndex.get(id) ?? -1;
}
