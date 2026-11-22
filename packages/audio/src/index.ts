export { createAudioEngine } from './engine';
export type {
  AudioEngine,
  AudioEngineEvents,
  AudioEngineOptions,
  InstrumentId,
  InstrumentLoad,
  InstrumentLoads,
  LoadFallback,
  LoadOptions,
  LoadResult,
  LoopEvent,
  MemoryReport,
  PackAssignment,
  PlaybackState,
  PositionEvent,
  TempoMode,
  TransportEvents,
  Unsubscribe,
} from './engine';
export { createTransport } from './transport';
export type { Transport, TransportOptions } from './transport';
export { GmBank } from './gm-bank';
export { timelineNeutral } from './timeline-neutral';
export { tierOf } from './tier';
export { outputLatencyOf } from './output-latency';

export type { InstrumentSink, MetronomeSink, NoteEvent } from './sink';
export { ClickSynth } from './click-synth';
export {
  CLICK_BPM_RANGE,
  CLICK_MAX_BEATS,
  DEFAULT_CLICK_SETTINGS,
  checkClickSettings,
  createStandaloneClick,
} from './standalone-click';
export type { ClickSettings, StandaloneClick, StandaloneClickOptions } from './standalone-click';
export { RecordingSink } from './recording-sink';
export type { RecordedClick, RecordedCut, RecordedNote } from './recording-sink';
export { ToneSink } from './tone-sink';
export type { ToneSinkOptions } from './tone-sink';

export { frameTicker, intervalTicker, workerTicker } from './ticker';
export type { Ticker } from './ticker';

export { advance, retime, startRun, tickAtTime, timeAtTick, withLoop } from './scheduler';
export type {
  Advanced,
  Anchor,
  LoopCrossing,
  Run,
  RunStart,
  ScheduledClick,
  ScheduledNote,
  Window,
} from './scheduler';
export {
  bpmAtTick,
  clicksInRange,
  countInTicks,
  createTimeline,
  loopRange,
  notesInRange,
} from './timeline';
export type { ClickOnset, NextOnString, NoteOnset, TickRange, Timeline } from './timeline';

// Sampler (WP-031)
export * from './sampler/index';

// SF2 loader (WP-032)
export * from './sf2/index';

// Articulations (WP-033)
export * from './articulations/index';

// Memory manager (WP-034)
export * from './samples/index';

// Tied continuations and mixer changes on beats (#65)
export type { HitEvent, MixEvent } from './sink';
export type { RecordedHit, RecordedMix } from './recording-sink';
export type { ScheduledContinuation, ScheduledHit, ScheduledMix } from './scheduler';
export { hitsInRange, mixesInRange } from './timeline';
export type { HitOnset, MixOnset, TiedContinuation } from './timeline';

// SFZ loader and HQ tier packs (WP-090)
export * from './sfz/index';
export { checkPack, checkSfzFile } from './sfz/check-pack';
export type { PackSnapshot, SfzFileCheck, SnapshotFile } from './sfz/check-pack';

// Effects chains: the pure tables and resolution (WP-092)
export * from './effects/index';
