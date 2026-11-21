import { midiNote, type ChordDiagram, type Id, type Track } from '@reprise/model';

/** Gap between strings of a strummed shape. */
export const STRUM_STAGGER_MS = 25;

export interface StrumAudio {
  previewNote(trackId: Id, note: { string: number; fret: number }): void;
}

/** The sounding strings of a shape, lowest pitch first: the order a strum plays them. */
export function strumOrder(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  diagram: ChordDiagram,
): { string: number; fret: number }[] {
  const notes: { string: number; fret: number; pitch: number }[] = [];
  diagram.frets.forEach((fret, index) => {
    if (fret === null) return;
    const string = index + 1;
    notes.push({ string, fret, pitch: midiNote(track, { string, fret }) });
  });
  return notes.sort((a, b) => a.pitch - b.pitch).map(({ string, fret }) => ({ string, fret }));
}

/**
 * Strums a shape with one `previewNote` per sounding string, `STRUM_STAGGER_MS` apart, from the
 * lowest pitch up. Returns a canceller for the strings not yet struck. A library shape is not in
 * the score, so `previewBeat` (which plays a beat that is) cannot play it.
 */
export function strum(
  audio: StrumAudio,
  track: Pick<Track, 'id' | 'kind' | 'tuning' | 'capo'>,
  diagram: ChordDiagram,
): () => void {
  const timers = strumOrder(track, diagram).map((note, index) =>
    setTimeout(() => {
      audio.previewNote(track.id, { string: note.string, fret: note.fret });
    }, index * STRUM_STAGGER_MS),
  );
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
