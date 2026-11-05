import { createTrack } from '../factories';
import type { TrackOptions } from '../factories';
import type { Command } from '../history';
import { newId } from '../id';
import type { Id } from '../id';
import type { Score } from '../score';
import { TrackSchema } from '../track';
import type { ChannelSettings, DisplaySettings, Track, TrackKind } from '../track';
import { assignChanges } from './changes';
import type { Changes } from './changes';
import { assertFreshId, assertTrackValid, maxFret, parseOrThrow } from './checks';
import { CommandError } from './command-error';
import { at, baseOf, findTrack } from './locate';

/** Everything but identity, kind and bars; `channel` and `display` merge field by field. */
export type TrackChanges = Changes<Omit<Track, 'id' | 'kind' | 'bars' | 'channel' | 'display'>> & {
  channel?: Partial<ChannelSettings>;
  display?: Changes<DisplaySettings>;
};

export type TrackProperties = Omit<TrackOptions, 'bars' | 'barCount'>;

const TrackPropertiesSchema = TrackSchema.omit({ bars: true });

// The properties the track's notes are checked against; any other edit cannot break them.
const NOTE_BEARING_KEYS = new Set(['tuning', 'capo', 'fretCount']);

function notesAbove(track: Track, ceiling: number): number {
  let count = 0;
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) if (note.fret > ceiling) count += 1;
        for (const grace of beat.grace ?? []) {
          for (const note of grace.notes) if (note.fret > ceiling) count += 1;
        }
      }
    }
  }
  return count;
}

/** Counts on the base track, so the draft's bars stay unproxied; frets an import left above the ceiling are tolerated. */
function assertFretsReachable(draft: Score, index: number, command: string): void {
  const before = at(baseOf(draft).tracks, index, command);
  const track = at(draft.tracks, index, command);
  if (track.kind !== 'fretted') return;
  const ceiling = maxFret(track);
  const was = maxFret(before);
  if (ceiling >= was) return;
  const stranded = notesAbove(before, ceiling) - notesAbove(before, was);
  if (stranded > 0) {
    throw new CommandError(
      command,
      'off-fretboard',
      `${String(stranded)} notes would sit above fret ${String(ceiling)}`,
    );
  }
}

function assertIndex(index: number, count: number, command: string): void {
  if (!Number.isInteger(index) || index < 0 || index > count) {
    throw new CommandError(
      command,
      'invalid-value',
      `index ${String(index)} is outside 0 to ${String(count)}`,
    );
  }
}

export function setTrackProperties(target: { trackId: Id }, changes: TrackChanges): Command {
  const name = 'setTrackProperties';
  return {
    name,
    run(draft) {
      const index = findTrack(draft, target.trackId, name);
      const track = at(draft.tracks, index, name);
      const { channel, display, ...properties } = changes;
      assignChanges(track, properties);
      if (channel) Object.assign(track.channel, channel);
      if (display) assignChanges(track.display, display);
      parseOrThrow(TrackPropertiesSchema, track, name);
      if (Object.keys(properties).some((key) => NOTE_BEARING_KEYS.has(key))) {
        assertFretsReachable(draft, index, name);
        assertTrackValid(draft, index, name);
      }
    },
  };
}

/** Adds a track of empty bars, one per master bar, at `index` (default: last). */
export function addTrack(
  target: { kind: TrackKind; index?: number; id?: Id },
  properties: TrackProperties = {},
): Command {
  const name = 'addTrack';
  return {
    name,
    run(draft) {
      const index = target.index ?? draft.tracks.length;
      assertIndex(index, draft.tracks.length, name);
      if (target.id !== undefined) assertFreshId(draft, target.id, name);
      const track: Track = {
        ...createTrack(target.kind, { ...properties, barCount: draft.masterBars.length }),
        id: target.id ?? newId(),
      };
      parseOrThrow(TrackPropertiesSchema, track, name);
      draft.tracks.splice(index, 0, track);
      assertTrackValid(draft, index, name, true);
    },
  };
}

export function removeTrack(target: { trackId: Id }): Command {
  const name = 'removeTrack';
  return {
    name,
    run(draft) {
      const index = findTrack(draft, target.trackId, name);
      if (draft.tracks.length === 1) {
        throw new CommandError(name, 'last-track', 'a score keeps at least one track');
      }
      draft.tracks.splice(index, 1);
    },
  };
}

/** Moves a track to `index` in the final order. */
export function moveTrack(target: { trackId: Id }, index: number): Command {
  const name = 'moveTrack';
  return {
    name,
    run(draft) {
      const from = findTrack(draft, target.trackId, name);
      assertIndex(index, draft.tracks.length - 1, name);
      const [track] = draft.tracks.splice(from, 1);
      if (track) draft.tracks.splice(index, 0, track);
    },
  };
}
