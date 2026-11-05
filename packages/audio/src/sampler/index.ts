export { ChannelStrip, MasterBus, applySolo } from './channel-strip';
export type { StripSettings } from './channel-strip';
export { RegionMap } from './region-map';
export type { Envelope, Region, SampleRef } from './region-map';
export { SynthSampleSource, midiToFrequency } from './sample-source';
export type { SampleSource, SynthSample } from './sample-source';
export {
  DEFAULT_POLYPHONY,
  DEFAULT_VELOCITY,
  Sampler,
  channelPanToStereo,
  channelVolumeToGain,
} from './sampler';
export type {
  Instrument,
  NoteOnRequest,
  SamplerOptions,
  SamplerTrack,
  TrackParams,
  TrackParamsTiming,
  VoiceHandle,
} from './sampler';
export { createSamplerSink } from './sampler-sink';
export type { SamplerSinkOptions } from './sampler-sink';
export { CHOKE_FADE, dbToGain, velocityGain } from './voice';
export type { FilterSettings } from './voice';
export { VoicePool } from './voice-pool';
