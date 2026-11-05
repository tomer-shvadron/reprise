import { midiNote } from '@reprise/model';

import type { InstrumentSink, NoteEvent } from '../sink';
import { DEFAULT_VELOCITY } from './sampler';
import type { Sampler } from './sampler';

/**
 * The scheduler's `InstrumentSink` over the sampler. Velocity is flat until articulation
 * playback (WP-033) maps dynamics. A let-ring note rings to the next note on its string or to
 * the end of its bar, whichever comes first; every other note releases at `when + duration`.
 */
export function createSamplerSink(sampler: Sampler): InstrumentSink {
  return {
    noteOn(event: NoteEvent): void {
      const { track, note, when, duration } = event;
      const voice = sampler.noteOn(track.id, {
        key: midiNote(track, note),
        velocity: DEFAULT_VELOCITY,
        when,
        string: note.string,
        letRing: note.letRing && { until: Math.max(event.barEnd, when + duration) },
      });
      if (voice) sampler.noteOff(voice, when + duration);
    },
    allNotesOff(when: number): void {
      sampler.allNotesOff(when);
    },
  };
}
