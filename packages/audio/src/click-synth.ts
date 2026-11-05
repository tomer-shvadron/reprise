import type { MetronomeSink } from './sink';
import { VoiceSet } from './voices';

const BURST = 0.03;

/** The metronome: a short sine burst per beat, higher and louder on the downbeat, on its own gain. */
export class ClickSynth implements MetronomeSink {
  readonly output: GainNode;
  private readonly voices = new VoiceSet();

  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode = context.destination,
  ) {
    this.output = context.createGain();
    this.output.connect(destination);
  }

  click(when: number, accent: boolean): void {
    const { context } = this;
    const oscillator = context.createOscillator();
    oscillator.frequency.value = accent ? 1760 : 1320;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(accent ? 0.9 : 0.45, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, when + BURST);
    oscillator.connect(gain).connect(this.output);
    this.voices.add(oscillator, gain);
    oscillator.start(when);
    oscillator.stop(when + BURST);
  }

  silence(when: number): void {
    this.voices.cut(when);
  }

  setVolume(volume: number): void {
    this.output.gain.value = volume;
  }

  dispose(): void {
    this.output.disconnect();
  }
}
