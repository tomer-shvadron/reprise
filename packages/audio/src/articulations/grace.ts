import { PPQ, beatTicks } from '@reprise/model';
import type { GraceBeat, Note } from '@reprise/model';

import type { NoteEvent } from '../sink';
import type { PlanInput } from './plan';

interface Slot {
  notes: readonly Note[];
  when: number;
  length: number;
}

/**
 * Which event plays a grace note: the one for the main note on its string, or, for a grace on a
 * string the beat leaves empty (and every grace on a drum or pitched track), the beat's first
 * note that is not tied, since a tied note's event is folded into its origin and never arrives.
 */
function playsGrace(event: NoteEvent, grace: Note): boolean {
  const { beat, note } = event;
  if (grace.string > 0 && grace.string === note.string) return true;
  const first = beat.notes.find((other) => !other.tie) ?? beat.notes[0];
  if (note !== first) return false;
  return grace.string === 0 || !beat.notes.some((other) => other.string === grace.string);
}

/**
 * The grace notes `event` voices, and how far its main note moves for the ones played on the
 * beat. Grace notes before the beat end at `when`, squeezed into a quarter note at most, the
 * lead the scheduler gives; grace notes on the beat start at `when` and take at most half of it.
 */
export function placeGraces(
  event: NoteEvent,
  secondsPerTick: number,
  now: number,
): { graces: PlanInput[]; delay: number } {
  const graces = event.beat.grace ?? [];
  if (graces.length === 0 || secondsPerTick <= 0) return { graces: [], delay: 0 };
  const ticks = (duration: GraceBeat['duration']): number => beatTicks({ duration, dots: 0 });
  const before = graces.filter((grace) => grace.before);
  const onBeat = graces.filter((grace) => !grace.before);
  const beforeTicks = before.reduce((sum, grace) => sum + ticks(grace.duration), 0);
  const onBeatTicks = onBeat.reduce((sum, grace) => sum + ticks(grace.duration), 0);
  const beforeScale = beforeTicks > PPQ ? PPQ / beforeTicks : 1;
  const halfBeat = beatTicks(event.beat) / 2;
  const onBeatScale = onBeatTicks > halfBeat ? halfBeat / onBeatTicks : 1;

  const slots: Slot[] = [];
  let cursor = event.when - beforeTicks * beforeScale * secondsPerTick;
  for (const grace of before) {
    const length = ticks(grace.duration) * beforeScale * secondsPerTick;
    slots.push({ notes: grace.notes, when: cursor, length });
    cursor += length;
  }
  cursor = event.when;
  for (const grace of onBeat) {
    const length = ticks(grace.duration) * onBeatScale * secondsPerTick;
    slots.push({ notes: grace.notes, when: cursor, length });
    cursor += length;
  }
  const delay = onBeatTicks * onBeatScale * secondsPerTick;
  const mainWhen = event.when + delay;

  const inputs: PlanInput[] = [];
  for (const [index, slot] of slots.entries()) {
    // Clipped by the start of playback: the scheduler could not hand these out in time.
    if (slot.when < now - 1e-3) continue;
    for (const grace of slot.notes) {
      if (!playsGrace(event, grace)) continue;
      inputs.push({
        track: event.track,
        note: grace,
        effects: {},
        when: slot.when,
        length: slot.length,
        beatLength: slot.length,
        secondsPerTick,
        barEnd: event.barEnd,
        next: nextOnString(grace, slots, index, event.note, mainWhen),
      });
    }
  }
  return { graces: inputs, delay };
}

function nextOnString(
  grace: Note,
  slots: readonly Slot[],
  index: number,
  main: Note,
  mainWhen: number,
): { note: Note; when: number } | undefined {
  if (grace.string === 0) return undefined;
  for (const slot of slots.slice(index + 1)) {
    const note = slot.notes.find((other) => other.string === grace.string);
    if (note) return { note, when: slot.when };
  }
  return main.string === grace.string ? { note: main, when: mainWhen } : undefined;
}
