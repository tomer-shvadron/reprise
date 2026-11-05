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

  /** Fades every voice out from `when` and stops it; one that starts later never sounds. */
  cut(when: number, fade = 0.005): void {
    for (const { source, gain } of this.voices) {
      gain.gain.cancelAndHoldAtTime(when);
      gain.gain.linearRampToValueAtTime(0, when + fade);
      // A stop before a node's start time makes it produce nothing and end at once.
      source.stop(when + fade);
    }
  }

  get size(): number {
    return this.voices.size;
  }
}
