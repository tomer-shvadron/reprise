import type { Voice } from './voice';

/**
 * Bounds the voices sounding at once. A new note over the limit steals one voice: released
 * voices first, then the quietest at that moment, then the oldest.
 */
export class VoicePool {
  readonly polyphony: number;
  #voices: Voice[] = [];
  #stolen = 0;

  constructor(polyphony: number) {
    if (!Number.isInteger(polyphony) || polyphony < 1) {
      throw new RangeError(`Polyphony must be a positive integer, got ${String(polyphony)}`);
    }
    this.polyphony = polyphony;
  }

  get stolen(): number {
    return this.#stolen;
  }

  /** The voices still holding a slot at `time`. */
  active(time: number): readonly Voice[] {
    this.#voices = this.#voices.filter((voice) => voice.endTime > time);
    return this.#voices;
  }

  /** Frees a slot for a note starting at `time`, stealing if the pool is full. */
  reserve(time: number): void {
    while (this.active(time).length >= this.polyphony) {
      const victim = this.#victim(this.#voices, time);
      if (!victim) return;
      victim.kill(time);
      this.remove(victim);
      this.#stolen += 1;
    }
  }

  add(voice: Voice): void {
    this.#voices.push(voice);
  }

  remove(voice: Voice): void {
    this.#voices = this.#voices.filter((other) => other !== voice);
  }

  #victim(voices: readonly Voice[], time: number): Voice | undefined {
    let victim: Voice | undefined;
    let victimRank: [number, number, number] = [Infinity, Infinity, Infinity];
    for (const voice of voices) {
      const rank: [number, number, number] = [
        voice.released && voice.releaseAt <= time ? 0 : 1,
        voice.levelAt(time),
        voice.startTime,
      ];
      if (
        rank[0] < victimRank[0] ||
        (rank[0] === victimRank[0] &&
          (rank[1] < victimRank[1] || (rank[1] === victimRank[1] && rank[2] < victimRank[2])))
      ) {
        victim = voice;
        victimRank = rank;
      }
    }
    return victim;
  }
}
