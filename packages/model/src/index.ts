export { IdSchema, ID_LENGTH, ID_PATTERN, newId } from './id';
export type { Id } from './id';

export { ColorSchema } from './color';
export type { Color } from './color';

export {
  AccentSchema,
  AccidentalSchema,
  BendKindSchema,
  BendPointSchema,
  BendSchema,
  DynamicsSchema,
  FingerSchema,
  HarmonicKindSchema,
  HarmonicSchema,
  NoteSchema,
  SlideKindSchema,
  TrillSchema,
  VibratoSchema,
} from './note';
export type {
  Accent,
  Accidental,
  Bend,
  BendKind,
  BendPoint,
  Dynamics,
  Finger,
  Harmonic,
  HarmonicKind,
  Note,
  SlideKind,
  Trill,
  Vibrato,
} from './note';

export { BarreSchema, ChordDiagramSchema, ChordSchema } from './chord-diagram';
export type { Barre, Chord, ChordDiagram } from './chord-diagram';

export { TempoMarkSchema, TempoUnitSchema } from './tempo';
export type { TempoMark, TempoUnit } from './tempo';

export {
  BeatEffectsSchema,
  BeatSchema,
  ChannelMixChangeSchema,
  DotsSchema,
  DurationSchema,
  GraceBeatSchema,
  LYRIC_LINES,
  MixerChangeSchema,
  StrokeDirectionSchema,
  StrokeSchema,
  TempoMixChangeSchema,
  TupletSchema,
  WhammyKindSchema,
  WhammySchema,
} from './beat';
export type {
  Beat,
  BeatEffects,
  ChannelMixChange,
  Dots,
  Duration,
  GraceBeat,
  MixerChange,
  Stroke,
  StrokeDirection,
  TempoMixChange,
  Tuplet,
  Whammy,
  WhammyKind,
} from './beat';

export { BarSchema, ClefSchema, VOICE_COUNT, VoiceSchema } from './bar';
export type { Bar, Clef, Voice } from './bar';

export {
  ALTERNATE_ENDING_MAX,
  DirectionTargetSchema,
  JumpKindSchema,
  JumpSchema,
  KeySignatureSchema,
  MasterBarSchema,
  RepeatSchema,
  SectionSchema,
  TimeSignatureSchema,
  TripletFeelSchema,
} from './master-bar';
export type {
  DirectionTarget,
  Jump,
  JumpKind,
  KeySignature,
  MasterBar,
  Repeat,
  Section,
  TimeSignature,
  TripletFeel,
} from './master-bar';

export {
  ChannelSettingsSchema,
  DisplaySettingsSchema,
  LyricLineSchema,
  MAX_STRINGS,
  NotationSchema,
  SoundOverrideSchema,
  TrackKindSchema,
  TrackSchema,
} from './track';
export type {
  ChannelSettings,
  DisplaySettings,
  LyricLine,
  Notation,
  SoundOverride,
  Track,
  TrackKind,
} from './track';

export { SCORE_VERSION, ScoreMetaSchema, ScoreSchema } from './score';
export type { Score, ScoreMeta } from './score';

export {
  STANDARD_TUNING,
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
} from './factories';
export type { TrackOptions } from './factories';

export { validateScore } from './validate';
export type { Violation, ViolationPath, ViolationRule } from './validate';

export { PPQ, barTicks, beatStartTicks, beatTicks, playedBarTicks, tickOf } from './ticks';
export type { ScorePosition } from './ticks';

export { PLAYBACK_LENGTH_FACTOR, expandPlaybackSequence } from './playback-sequence';
export type {
  BarPass,
  PlaybackSequence,
  PlaybackWarning,
  PlaybackWarningCode,
} from './playback-sequence';

export { DEFAULT_BPM, positionAtSeconds, secondsAt, tempoMap } from './tempo-map';
export type {
  PlaybackPosition,
  PositionOptions,
  TempoMap,
  TempoMapPass,
  TempoSegment,
} from './tempo-map';

export { MIGRATIONS, migrate } from './migrations';
export type { Migration, MigrationTable } from './migrations';

export {
  AppInfoSchema,
  NATIVE_EXTENSION,
  NATIVE_FORMAT,
  NativeDocumentSchema,
  NativeFormatError,
  formatPath,
  parseNative,
  serializeNative,
} from './native';
export type {
  AppInfo,
  NativeDocument,
  NativePath,
  ParseResult,
  ParseWarning,
  ParseWarningRule,
} from './native';

export { HistoryError, applyCommand, createHistory, touchedBars } from './history';
export type { Applied, Change, Command, History, Patch } from './history';

export {
  CommandError,
  addTrack,
  insertBar,
  insertBeat,
  moveTrack,
  removeBar,
  removeBeat,
  removeNote,
  removeTrack,
  setBeatDuration,
  setBeatEffect,
  setBeatRest,
  setMasterBar,
  setNote,
  setNoteEffect,
  setTrackProperties,
  shiftStrings,
  transposeSelection,
} from './commands';
export type {
  BeatChanges,
  BeatInput,
  BeatRhythm,
  Changes,
  CommandErrorCode,
  MasterBarChanges,
  MasterBarInput,
  NoteEffects,
  NoteInput,
  Selection,
  TrackChanges,
  TrackProperties,
} from './commands';
