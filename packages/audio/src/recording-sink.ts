import type {
  HitEvent,
  InstrumentSink,
  MetronomeSink,
  MixEvent,
  NoteEvent,
  WahEvent,
} from './sink';

export interface RecordedNote extends NoteEvent {
  /** The clock's `currentTime` when `noteOn` was called. */
  calledAt: number;
}

export interface RecordedMix extends MixEvent {
  calledAt: number;
}

export interface RecordedHit extends HitEvent {
  calledAt: number;
}

export interface RecordedWah extends WahEvent {
  calledAt: number;
}

export interface RecordedClick {
  when: number;
  accent: boolean;
  subdivision: boolean;
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
  readonly mixes: RecordedMix[] = [];
  readonly hits: RecordedHit[] = [];
  readonly wahs: RecordedWah[] = [];
  readonly clicks: RecordedClick[] = [];
  readonly cuts: RecordedCut[] = [];
  volume = 1;

  constructor(private readonly clock: { readonly currentTime: number } = { currentTime: 0 }) {}

  noteOn(event: NoteEvent): void {
    this.notes.push({ ...event, calledAt: this.clock.currentTime });
  }

  mix(event: MixEvent): void {
    this.mixes.push({ ...event, calledAt: this.clock.currentTime });
  }

  hit(event: HitEvent): void {
    this.hits.push({ ...event, calledAt: this.clock.currentTime });
  }

  wah(event: WahEvent): void {
    this.wahs.push({ ...event, calledAt: this.clock.currentTime });
  }

  allNotesOff(when: number): void {
    this.cuts.push({ kind: 'notes', when, calledAt: this.clock.currentTime });
  }

  click(when: number, accent: boolean, subdivision = false): void {
    this.clicks.push({ when, accent, subdivision, calledAt: this.clock.currentTime });
  }

  silence(when: number): void {
    this.cuts.push({ kind: 'clicks', when, calledAt: this.clock.currentTime });
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }
}
