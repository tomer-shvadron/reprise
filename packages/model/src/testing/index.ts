/**
 * `@reprise/model/testing`: fixture builders for every package's tests. Not part of the runtime
 * API; the one subpath the lint boundaries allow.
 */
export { ScoreBuildError, ScoreBuilder, midi, note, parseDuration, score } from './score-builder';
export type { BeatSpec, DurationSpec, Instrument, NoteSpec, TrackSpec } from './score-builder';
export { fullScore } from './full-score';
export { largeScore } from './large-score';
export type { LargeScoreOptions } from './large-score';
export { beatOf, noteOf } from './lookup';
