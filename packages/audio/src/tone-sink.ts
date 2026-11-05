import { midiNote } from '@reprise/model';

import type { InstrumentSink, NoteEvent } from './sink';
import { VoiceSet } from './voices';

export interface ToneSinkOptions {
  destination?: AudioNode;
  /** Peak gain of one note; keep chords below clipping. */
  level?: number;
  type?: OscillatorType;
}

const ATTACK = 0.004;
const RELEASE = 0.02;

/** One oscillator per note, for listening to the scheduler before the sampler exists. */
export class ToneSink implements InstrumentSink {
  private readonly voices = new VoiceSet();
  private readonly destination: AudioNode;
  private readonly level: number;
  private readonly type: OscillatorType;

  constructor(
    private readonly context: BaseAudioContext,
    options: ToneSinkOptions = {},
  ) {
    this.destination = options.destination ?? context.destination;
    this.level = options.level ?? 0.15;
    this.type = options.type ?? 'triangle';
  }

  noteOn(event: NoteEvent): void {
    const { context } = this;
    const pitch = midiNote(event.track, event.note);
    const oscillator = context.createOscillator();
    oscillator.type = this.type;
    oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    const gain = context.createGain();
    gain.gain.value = 0;
    const end = event.when + Math.max(event.duration, ATTACK + RELEASE);
    gain.gain.setValueAtTime(0, event.when);
    gain.gain.linearRampToValueAtTime(this.level, event.when + ATTACK);
    gain.gain.setValueAtTime(this.level, end - RELEASE);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain).connect(this.destination);
    this.voices.add(oscillator, gain);
    oscillator.start(event.when);
    oscillator.stop(end);
  }

  allNotesOff(when: number): void {
    this.voices.cut(when);
  }
}
