/** Scheduled source nodes a sink can still cut, forgotten once they end. */
export class VoiceSet {
  private readonly voices = new Set<{ source: AudioScheduledSourceNode; gain: GainNode }>();

  add(source: AudioScheduledSourceNode, gain: GainNode): void {
    const voice = { source, gain };
    this.voices.add(voice);
    source.addEventListener('ended', () => {
      this.voices.delete(voice);
      gain.disconnect();
    });
  }

  /** Fades every voice out from `when`; one that starts later never becomes audible. */
  cut(when: number, fade = 0.005): void {
    for (const { gain } of this.voices) {
      gain.gain.cancelAndHoldAtTime(when);
      gain.gain.linearRampToValueAtTime(0, when + fade);
    }
  }

  get size(): number {
    return this.voices.size;
  }
}
