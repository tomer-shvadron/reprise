import { midiNote } from '@reprise/model';
import type { Beat, Id, Note, Track } from '@reprise/model';

import { DEFAULT_VELOCITY } from './sampler';
import type { Sampler, VoiceHandle } from './sampler';

/**
 * The scheduler-facing sink shape as WP-030 describes it. Reconcile with WP-030's
 * `InstrumentSink` at merge: this file then implements that interface instead of its own copy.
 */
export interface SamplerSink {
  /** `letRingUntil` is where the scheduler puts the end of the bar for a let-ring note. */
  noteOn(
    track: Pick<Track, 'id' | 'kind' | 'tuning' | 'capo'>,
    note: Note,
    beat: Beat,
    when: number,
    duration: number,
    letRingUntil?: number,
  ): void;
  noteOff(track: Pick<Track, 'id'>, note: Note, when: number): void;
  allNotesOff(when: number): void;
  /** Handles still held for a note-off; bounded by the voices that can sound at once. */
  readonly held: number;
}

/**
 * Plays scheduler events on the sampler. Velocity is flat until articulation playback maps
 * dynamics; let-ring notes ring until the next note on their string, `letRingUntil`, or
 * `allNotesOff`.
 */
export function createSamplerSink(sampler: Sampler): SamplerSink {
  const sounding = new Map<Id, VoiceHandle>();
  return {
    noteOn(track, note, _beat, when, duration, letRingUntil) {
      for (const [id, held] of sounding) if (held.endTime <= when) sounding.delete(id);
      const voice = sampler.noteOn(track.id, {
        key: midiNote(track, note),
        velocity: DEFAULT_VELOCITY,
        when,
        string: note.string,
        letRing:
          note.letRing && letRingUntil !== undefined ? { until: letRingUntil } : note.letRing,
      });
      if (!voice) return;
      sounding.set(note.id, voice);
      sampler.noteOff(voice, when + duration);
    },
    noteOff(_track, note, when) {
      const voice = sounding.get(note.id);
      if (!voice) return;
      sampler.noteOff(voice, when);
      sounding.delete(note.id);
    },
    allNotesOff(when) {
      sampler.allNotesOff(when);
      sounding.clear();
    },
    get held() {
      return sounding.size;
    },
  };
}
