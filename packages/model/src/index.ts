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

export { BarreSchema, ChordDiagramSchema } from './chord-diagram';
export type { Barre, ChordDiagram } from './chord-diagram';

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
  TempoMarkSchema,
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
  TempoMark,
  TimeSignature,
  TripletFeel,
} from './master-bar';

export {
  ChannelSettingsSchema,
  DisplaySettingsSchema,
  MAX_STRINGS,
  NotationSchema,
  SoundOverrideSchema,
  TrackKindSchema,
  TrackSchema,
} from './track';
export type {
  ChannelSettings,
  DisplaySettings,
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
