export { CommandError } from './command-error';
export type { CommandErrorCode } from './command-error';
export type { Changes } from './changes';
export {
  removeNote,
  setNote,
  setNoteEffect,
  setNoteEffects,
  shiftStrings,
  transposeSelection,
} from './note-commands';
export type { NoteEffectEdit, NoteEffects, NoteInput, Selection } from './note-commands';
export {
  insertBeat,
  removeBeat,
  replaceBeats,
  setBeatDuration,
  setBeatEffect,
  setBeatEffects,
  setBeatRest,
} from './beat-commands';
export type {
  BeatChanges,
  BeatEffectEdit,
  BeatInput,
  BeatRhythm,
  BeatSpliceEdit,
} from './beat-commands';
export { insertBar, removeBar, setMasterBar, setMasterBars } from './bar-commands';
export type { MasterBarChanges, MasterBarEdit, MasterBarInput } from './bar-commands';
export { addTrack, moveTrack, removeTrack, setTrackProperties } from './track-commands';
export type { TrackChanges, TrackProperties } from './track-commands';
export { chain } from './chain';
export type { ChainStep } from './chain';
