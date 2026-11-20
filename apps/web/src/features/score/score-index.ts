// The index is pure over a `Score`, so it lives in `lib/` where features that must not import the
// score feature (it would pull in its components) can reach it; the score feature re-exports it.
export { masterBarIndexOf, scoreIndex, type BeatInfo, type ScoreIndex } from '@/lib/score-index';
