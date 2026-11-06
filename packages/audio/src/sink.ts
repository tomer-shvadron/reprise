import type { Beat, MixerChange, Note, Track } from '@reprise/model';

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
 * - `allNotesOff(when)` cancels every note sounding at `when` and every note already scheduled
 *   to start at or after it, by stopping their source nodes (`stop(when)` is valid before a
 *   node's start time), not only by muting them. Called on pause, stop and seek, with `when` =
 *   `currentTime`.
 */
export interface InstrumentSink {
  noteOn(event: NoteEvent): void;
  mix?(event: MixEvent): void;
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
