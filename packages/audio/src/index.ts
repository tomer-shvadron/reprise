export { createAudioEngine, debugAudioEngine } from './engine';
export type {
  AudioEngine,
  AudioEngineDebug,
  AudioEngineEvents,
  AudioEngineOptions,
  InstrumentId,
  InstrumentLoad,
  InstrumentLoads,
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
export { outputLatencyOf } from './output-latency';

export type { InstrumentSink, MetronomeSink, NoteEvent } from './sink';
export { ClickSynth } from './click-synth';
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
export type { MixEvent } from './sink';
export type { RecordedMix } from './recording-sink';
export type { ScheduledContinuation, ScheduledMix } from './scheduler';
export { mixesInRange } from './timeline';
export type { MixOnset, TiedContinuation } from './timeline';
