import type { InstrumentSink, MetronomeSink, NoteEvent } from './sink';

export interface RecordedNote extends NoteEvent {
  /** The clock's `currentTime` when `noteOn` was called. */
  calledAt: number;
}

export interface RecordedClick {
  when: number;
  accent: boolean;
  calledAt: number;
}

export interface RecordedCut {
  kind: 'notes' | 'clicks';
  when: number;
  calledAt: number;
}

/** Collects what the scheduler hands out, with the time it did, for tests. Makes no sound. */
export class RecordingSink implements InstrumentSink, MetronomeSink {
  readonly notes: RecordedNote[] = [];
  readonly clicks: RecordedClick[] = [];
  readonly cuts: RecordedCut[] = [];
  volume = 1;

  constructor(private readonly clock: { readonly currentTime: number } = { currentTime: 0 }) {}

  noteOn(event: NoteEvent): void {
    this.notes.push({ ...event, calledAt: this.clock.currentTime });
  }

  allNotesOff(when: number): void {
    this.cuts.push({ kind: 'notes', when, calledAt: this.clock.currentTime });
  }

  click(when: number, accent: boolean): void {
    this.clicks.push({ when, accent, calledAt: this.clock.currentTime });
  }

  silence(when: number): void {
    this.cuts.push({ kind: 'clicks', when, calledAt: this.clock.currentTime });
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }
}
