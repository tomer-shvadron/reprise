import { beatTicks, type Bar, type Dynamics, type Id, type Note, type Track } from '@reprise/model';

/** A note's dynamics when nothing earlier says otherwise: the model's default. */
const DEFAULT_DYNAMICS: Dynamics = 'f';

interface Sounding {
  tick: number;
  voice: number;
  beat: Id;
  note: Note;
}

function soundingNotes(bar: Bar): Sounding[] {
  const out: Sounding[] = [];
  for (const [voice, { beats }] of bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      const [note] = beat.notes;
      if (!beat.rest && note) out.push({ tick, voice, beat: beat.id, note });
      tick += beatTicks(beat);
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.voice - b.voice);
}

/**
 * The beats of bar `index` that show a dynamic, by beat id: where the dynamics differ from the
 * note sounding before, in reading order across voices. The bar before is the only history
 * consulted, so a bar is measured from itself and its predecessor alone; with nothing to
 * compare against there, the default `f` is assumed.
 */
export function shownDynamics(
  track: Track,
  index: number,
): Map<Id, { value: Dynamics; note: Note }> {
  const shown = new Map<Id, { value: Dynamics; note: Note }>();
  const bar = track.bars[index];
  if (!bar) return shown;
  const before = index > 0 ? track.bars[index - 1] : undefined;
  let current = (before && soundingNotes(before).at(-1)?.note.dynamics) ?? DEFAULT_DYNAMICS;
  let lastTick = -1;
  for (const { tick, beat, note } of soundingNotes(bar)) {
    if (note.dynamics === current) continue;
    current = note.dynamics;
    if (tick === lastTick) continue;
    lastTick = tick;
    shown.set(beat, { value: note.dynamics, note });
  }
  return shown;
}
