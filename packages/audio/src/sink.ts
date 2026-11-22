import type { Beat, Golpe, MixerChange, Note, Track } from '@reprise/model';

import type { WahState } from './wah-lane';

/** One note the scheduler wants sounded, with everything a sampler needs to voice it. */
export interface NoteEvent {
  track: Track;
  trackIndex: number;
  voiceIndex: number;
  beat: Beat;
  beatIndex: number;
  note: Note;
  /** `AudioContext` time of the onset; never earlier than `currentTime` when `noteOn` is called. */
  when: number;
  /** Seconds until the release starts, ties included, at the tempo in effect when scheduled. */
  duration: number;
  /** Ticks since playback began, counting every pass (`PlaybackPosition.playbackTick`). */
  playbackTick: number;
  /** Ticks the note lasts, ties included; `duration` is this converted through the tempo map. */
  durationTicks: number;
  /** Index into the playback sequence of the pass the onset belongs to. */
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
  /** `AudioContext` time the onset's bar ends: the latest a let-ring note sounds. */
  barEnd: number;
  /**
   * The note on the same string in the beat after this note ends, in playback order, and when
   * it starts: the target of a slide. Undefined off fretted tracks, where a rest follows, and
   * where the loop or the song ends first.
   */
  nextOnString: { note: Note; beat: Beat; when: number } | undefined;
  /**
   * The tied notes folded into this one, in order (`tieChainOf`), each with its own onset and
   * length: where a hold bend, a slide out or vibrato written on a later link starts. Empty
   * for an untied note. Their lengths, and the beats of other strings between them, are
   * already in `duration`.
   */
  continuations: { note: Note; beat: Beat; when: number; durationTicks: number }[];
}

/**
 * A beat's mixer change (`Beat.mix`), sent once per beat that carries one: on rests and tied
 * continuations too, which send no `NoteEvent`.
 */
export interface MixEvent {
  track: Track;
  trackIndex: number;
  voiceIndex: number;
  beat: Beat;
  beatIndex: number;
  mix: MixerChange;
  /**
   * `AudioContext` time of the beat; `currentTime` when it was handed out late; the run's start
   * for a change replayed from before it.
   */
  when: number;
  playbackTick: number;
  /** Context seconds per tick at the beat, to time the change's `duration`. */
  secondsPerTick: number;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
}

/**
 * A beat's golpe (`BeatEffects.golpe`): a percussive hit on the guitar body, sent once per beat
 * that carries one, rests and tied continuations included, which send no `NoteEvent`.
 */
export interface HitEvent {
  track: Track;
  trackIndex: number;
  voiceIndex: number;
  beat: Beat;
  beatIndex: number;
  golpe: Golpe;
  /** `AudioContext` time of the beat; never earlier than `currentTime` when handed out. */
  when: number;
  playbackTick: number;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
}

/**
 * A change of a track's wah pedal: engaged closed or open from `when`, or off. Wah is state, like
 * a mixer change, so a run start sends the state in effect there (`restore`).
 */
export interface WahEvent {
  track: Track;
  trackIndex: number;
  state: WahState;
  /** `AudioContext` time of the change; `currentTime` when handed out late; the run's start for a restore. */
  when: number;
  playbackTick: number;
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
  /** The state at a run's start, set at once with no glide or fade. */
  restore: boolean;
}

/**
 * What the scheduler drives. The sampler (WP-031) implements it with real samples; `ToneSink`
 * and `RecordingSink` are the stand-ins until then.
 *
 * - `noteOn` is called once per sounding note, up to the scheduler's lookahead before `when`,
 *   and for a beat with grace notes before it, earlier by their length too (up to a quarter
 *   note), so the sink can place them ahead of `when`.
 *   A tied continuation held from its origin in this run is never sent: its length is folded
 *   into the origin's `duration` and the link rides along in `continuations`; one whose origin
 *   did not play just before it (playback started or a loop wrapped after the origin, a repeat
 *   jumped back) arrives as an onset. The sink schedules both the start and the release
 *   itself; there is no per-note off call.
 * - `mix` is called for every beat carrying a mixer change, in the same window as the notes
 *   at its tick; the sink applies it from `when`. It is the one place mixer changes arrive.
 *   When a run starts (play, seek, a loop wrap) the changes before its start point are sent
 *   first, in order, at the run's start and with their transitions stripped, so the mixer
 *   state in effect there is restored; `track.channel` is the baseline they build on.
 * - `hit` is called for every beat carrying a golpe, in the same window as the notes at its tick.
 *   A hit is an event, not state: it is not replayed when a run starts partway through the beat.
 *   `allNotesOff` cancels a hit like a note.
 * - `wah` is called for every change of a fretted track's wah pedal, in the same window as the
 *   notes at its tick. A wah is on from a marked beat (`BeatEffects.wah`) until the first played
 *   note without a mark; rests and tied notes hold it. When a run starts (play, seek, a loop wrap)
 *   each wah track's state there is sent first, `off` included, with `restore` set, so a seek
 *   into a passage sounds as it does when played through. `allNotesOff` cancels the changes
 *   scheduled after it, like a mixer change.
 * - `allNotesOff(when)` cancels every note sounding at `when` and every note already scheduled
 *   to start at or after it, by stopping their source nodes (`stop(when)` is valid before a
 *   node's start time), not only by muting them, and every mixer change scheduled after it (a
 *   strip's volume and pan, a program change): the scheduler sends each again when playback
 *   reaches its beat. Called on pause, stop and seek, with `when` = `currentTime`.
 */
export interface InstrumentSink {
  noteOn(event: NoteEvent): void;
  mix?(event: MixEvent): void;
  hit?(event: HitEvent): void;
  wah?(event: WahEvent): void;
  allNotesOff(when: number): void;
  dispose?(): void;
}

/** The metronome and the count-in. `ClickSynth` is the built-in implementation. */
export interface MetronomeSink {
  /**
   * A click at `when`; `accent` marks a stressed beat. `subdivision` marks a click between beats
   * (the standalone click's eighths, triplets and sixteenths): softer than a beat.
   */
  click(when: number, accent: boolean, subdivision?: boolean): void;
  /** Cancels clicks sounding at `when` or scheduled after it. */
  silence(when: number): void;
  /** 0 to 1. */
  setVolume(volume: number): void;
  dispose?(): void;
}
