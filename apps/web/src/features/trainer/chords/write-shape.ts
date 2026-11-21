import {
  chain,
  setBeatEffect,
  type ChordDiagram,
  type Command,
  type Id,
  type Track,
} from '@reprise/model';

/** The history label of both writes. */
export const SHAPE_LABEL = 'Chord diagram';

/** One undo step that puts a name and diagram on a beat, replacing any chord it had. */
export function shapeOnBeat(beatId: Id, name: string, diagram: ChordDiagram): Command {
  return chain(SHAPE_LABEL, [setBeatEffect({ beatId }, { chord: { name, diagram } })]);
}

/** The beats of a track whose chord has `name`, in score order. */
export function beatsNamed(track: Pick<Track, 'bars'>, name: string): Id[] {
  const ids: Id[] = [];
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) if (beat.chord?.name === name) ids.push(beat.id);
    }
  }
  return ids;
}

/** One undo step that writes the diagram to every beat of the track named `name`; undefined when none is. */
export function shapeOnEveryBeat(
  track: Pick<Track, 'bars'>,
  name: string,
  diagram: ChordDiagram,
): Command | undefined {
  const ids = beatsNamed(track, name);
  if (ids.length === 0) return undefined;
  return chain(
    SHAPE_LABEL,
    ids.map((beatId) => setBeatEffect({ beatId }, { chord: { name, diagram } })),
  );
}
