import type { Voice } from './voice';

/**
 * Bounds the voices sounding at once, as a hard cap. A new note over the limit steals one voice:
 * released voices first, then ones already started (the quietest at that moment, then the
 * oldest), and only then one starting with or after the new note, the quietest of those.
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

  /**
   * A voice starting with the new note reads silent there, yet is a layer or chord partner of it,
   * and one starting later is the newest there is: both rank after every started voice, by the
   * level they will start at. The rest rank by what they play: envelope, velocity and
   * articulation gain together.
   */
  #victim(voices: readonly Voice[], time: number): Voice | undefined {
    let victim: Voice | undefined;
    let victimRank: number[] = [];
    for (const voice of voices) {
      const rank = [
        voice.released && voice.releaseAt <= time ? 0 : 1,
        voice.startTime < time ? 0 : 1,
        voice.stealLevelAt(time),
        voice.startTime,
      ];
      if (!victim || isBefore(rank, victimRank)) {
        victim = voice;
        victimRank = rank;
      }
    }
    return victim;
  }
}

function isBefore(rank: readonly number[], other: readonly number[]): boolean {
  for (const [index, value] of rank.entries()) {
    const against = other[index] ?? Infinity;
    if (value !== against) return value < against;
  }
  return false;
}
