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
 * lowest pitch up; the first string sounds inside the call, so the click that asked for it is the
 * gesture that unlocks audio. Returns a canceller for the strings not yet struck. `alive` is asked
 * before each later string: a song or track that went away mid-strum must not reach the engine,
 * which throws for a track it does not have. A library shape is not in the score, so
 * `previewBeat` (which plays a beat that is) cannot play it.
 */
export function strum(
  audio: StrumAudio,
  track: Pick<Track, 'id' | 'kind' | 'tuning' | 'capo'>,
  diagram: ChordDiagram,
  alive: () => boolean = () => true,
): () => void {
  const order = strumOrder(track, diagram);
  const first = order[0];
  if (first) audio.previewNote(track.id, { string: first.string, fret: first.fret });
  const timers = order.slice(1).map((note, index) =>
    setTimeout(
      () => {
        if (alive()) audio.previewNote(track.id, { string: note.string, fret: note.fret });
      },
      (index + 1) * STRUM_STAGGER_MS,
    ),
  );
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
