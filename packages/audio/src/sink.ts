import type { Beat, Note, Track } from '@reprise/model';

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
}

/**
 * What the scheduler drives. The sampler (WP-031) implements it with real samples; `ToneSink`
 * and `RecordingSink` are the stand-ins until then.
 *
 * - `noteOn` is called once per sounding note, up to the scheduler's lookahead before `when`.
 *   A tied continuation is never sent: its length is folded into the origin's `duration`,
 *   except when playback starts or a loop wraps exactly on it, where it arrives as an onset.
 *   The sink schedules both the start and the release itself; there is no per-note off call.
 * - `allNotesOff(when)` cancels every note sounding at `when` and every note already scheduled
 *   to start at or after it. Called on pause, stop and seek, with `when` = `currentTime`.
 */
export interface InstrumentSink {
  noteOn(event: NoteEvent): void;
  allNotesOff(when: number): void;
  dispose?(): void;
}

/** The metronome and the count-in. `ClickSynth` is the built-in implementation. */
export interface MetronomeSink {
  /** A click at `when`; `accent` marks the first beat of a bar. */
  click(when: number, accent: boolean): void;
  /** Cancels clicks sounding at `when` or scheduled after it. */
  silence(when: number): void;
  /** 0 to 1. */
  setVolume(volume: number): void;
  dispose?(): void;
}
