import { VOICE_COUNT } from '../bar';
import { createBar, createMasterBar } from '../factories';
import type { Command } from '../history';
import { newId } from '../id';
import type { Id } from '../id';
import { MasterBarSchema } from '../master-bar';
import type { MasterBar } from '../master-bar';
import type { Score } from '../score';
import { barTicks, beatTicks } from '../ticks';
import type { Track } from '../track';
import { assignChanges } from './changes';
import type { Changes } from './changes';
import { assertFreshId, assertMasterBarsValid, parseOrThrow, releaseTies } from './checks';
import { CommandError } from './command-error';
import { at, baseOf, findMasterBar } from './locate';

export type MasterBarInput = Partial<Omit<MasterBar, 'id'>>;

/** Time, key, tempo, repeats, alternate endings, jumps, targets, section, anacrusis and the rest. */
export type MasterBarChanges = Changes<Omit<MasterBar, 'id'>>;

const TICK_EPSILON = 1e-6;

function releaseColumnTies(track: Track, bar: number): void {
  if (bar >= track.bars.length) return;
  for (let voice = 0; voice < VOICE_COUNT; voice++) releaseTies(track, bar, voice, 0);
}

/**
 * Inserts an empty bar at `index` in every track. The new master bar copies the time and key
 * signature and triplet feel of the bar before it, and the volta numbers of the bar it is
 * inserted before, so inserting before a volta bar lengthens that ending.
 * At index 0 the tempo mark moves onto the new first bar, which must carry one.
 */
export function insertBar(
  target: { index: number; id?: Id },
  masterBar: MasterBarInput = {},
): Command {
  const name = 'insertBar';
  return {
    name,
    run(draft) {
      const { index } = target;
      const base = baseOf(draft);
      const count = base.masterBars.length;
      if (!Number.isInteger(index) || index < 0 || index > count) {
        throw new CommandError(
          name,
          'invalid-value',
          `index ${String(index)} is outside 0 to ${String(count)}`,
        );
      }
      if (target.id !== undefined) assertFreshId(draft, target.id, name);
      const before = base.masterBars[index - 1];
      const after = base.masterBars[index];
      const model = before ?? after;
      const node: MasterBar = {
        ...createMasterBar({
          ...(model && {
            timeSignature: { ...model.timeSignature },
            keySignature: { ...model.keySignature },
            tripletFeel: model.tripletFeel,
          }),
          alternateEndings: [...(after?.alternateEndings ?? [])],
          ...masterBar,
        }),
        id: target.id ?? newId(),
      };
      const first = draft.masterBars[0];
      if (index === 0 && masterBar.tempo === undefined && first?.tempo) {
        node.tempo = { ...first.tempo };
        delete first.tempo;
      }
      parseOrThrow(MasterBarSchema, node, name);
      draft.masterBars.splice(index, 0, node);
      for (const track of draft.tracks) {
        track.bars.splice(index, 0, createBar());
        releaseColumnTies(track, index + 1);
        for (const line of track.lyrics) if (line.startBar >= index) line.startBar += 1;
      }
      assertMasterBarsValid(draft, name);
    },
  };
}

/**
 * Removes a bar from every track. Its tempo mark moves onto the bar that follows when that has
 * none, so a tempo change outlives the bar it was written on and the first bar keeps one.
 */
export function removeBar(target: { masterBarId: Id }): Command {
  const name = 'removeBar';
  return {
    name,
    run(draft) {
      const index = findMasterBar(draft, target.masterBarId, name);
      const removed = at(baseOf(draft).masterBars, index, name);
      if (draft.masterBars.length === 1) {
        throw new CommandError(name, 'last-bar', 'a score keeps at least one bar');
      }
      draft.masterBars.splice(index, 1);
      const next = draft.masterBars[index];
      if (removed.tempo && next && !next.tempo) next.tempo = { ...removed.tempo };
      const last = draft.masterBars.length - 1;
      for (const track of draft.tracks) {
        track.bars.splice(index, 1);
        releaseColumnTies(track, index);
        for (const line of track.lyrics) {
          if (line.startBar > index) line.startBar -= 1;
          line.startBar = Math.min(line.startBar, last);
        }
      }
      assertMasterBarsValid(draft, name);
    },
  };
}

function assertColumnFits(
  score: Score,
  index: number,
  before: MasterBar,
  after: MasterBar,
  command: string,
): void {
  const oldCapacity = barTicks(before) + TICK_EPSILON;
  const capacity = barTicks(after) + TICK_EPSILON;
  if (capacity >= oldCapacity) return;
  for (const track of score.tracks) {
    for (const voice of track.bars[index]?.voices ?? []) {
      const used = voice.beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
      if (used > capacity && used <= oldCapacity) {
        throw new CommandError(
          command,
          'voice-overfull',
          `track ${track.name} holds ${String(used)} ticks, more than the new time signature allows`,
        );
      }
    }
  }
}

export function setMasterBar(target: { masterBarId: Id }, changes: MasterBarChanges): Command {
  const name = 'setMasterBar';
  return {
    name,
    run(draft) {
      const index = findMasterBar(draft, target.masterBarId, name);
      const base = baseOf(draft);
      const masterBar = at(draft.masterBars, index, name);
      assignChanges(masterBar, changes);
      const parsed = parseOrThrow(MasterBarSchema, masterBar, name);
      assertMasterBarsValid(draft, name);
      assertColumnFits(base, index, at(base.masterBars, index, name), parsed, name);
    },
  };
}
