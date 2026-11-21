import { canShowTab, type ChordDiagram, type Id, type Track } from '@reprise/model';

import { voicingsForName } from './voicings';

export interface ChordListEntry {
  /** Name plus the diagram the beats carry, so two shapes of one name are two entries. */
  key: string;
  name: string;
  /** What the strip draws: the file's own diagram, else the engine's first shape (`suggested`). */
  diagram?: ChordDiagram;
  suggested: boolean;
  /** The beats of the track that carry this chord, in score order. */
  beats: Id[];
}

/**
 * The distinct chords of a track in first-use order, keyed like the gpif writer keys a chord
 * (name plus diagram). A name with no diagram gets the engine's first shape for the track's
 * tuning and capo, flagged `suggested`; a name the engine does not know, or a track with no
 * frets, has none and the entry is just the name.
 */
export function chordList(
  track: Pick<Track, 'bars' | 'tuning' | 'capo' | 'fretCount' | 'kind'> | undefined,
): ChordListEntry[] {
  if (!track) return [];
  const byKey = new Map<string, ChordListEntry>();
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        const chord = beat.chord;
        if (chord === undefined || chord.name === '') continue;
        const key = `${chord.name}\u0000${chord.diagram ? JSON.stringify(chord.diagram) : ''}`;
        const known = byKey.get(key);
        if (known) {
          known.beats.push(beat.id);
          continue;
        }
        byKey.set(key, {
          key,
          name: chord.name,
          ...(chord.diagram && { diagram: chord.diagram }),
          suggested: false,
          beats: [beat.id],
        });
      }
    }
  }
  const entries = [...byKey.values()];
  if (!canShowTab(track)) return entries;
  const suggestions = new Map<string, ChordDiagram | undefined>();
  for (const entry of entries) {
    if (entry.diagram) continue;
    if (!suggestions.has(entry.name)) {
      suggestions.set(entry.name, voicingsForName(entry.name, track, { limit: 1 })[0]?.diagram);
    }
    const diagram = suggestions.get(entry.name);
    if (diagram) {
      entry.diagram = diagram;
      entry.suggested = true;
    }
  }
  return entries;
}
