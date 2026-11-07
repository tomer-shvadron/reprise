import type { Beat, Note } from '@reprise/model';

import type { GlyphName } from '../../metrics';

const TREMOLO: Readonly<Record<8 | 16 | 32, GlyphName>> = {
  8: 'tremolo1',
  16: 'tremolo2',
  32: 'tremolo3',
};

/** The strokes of a beat's tremolo picking: their number follows the speed, not the note value. */
export function tremoloGlyph(beat: Beat): GlyphName | undefined {
  const speed = beat.effects.tremoloPicking;
  return speed === undefined || beat.notes.length === 0 ? undefined : TREMOLO[speed];
}

export interface ArticulationMarks {
  staccato: boolean;
  /** A heavy accent (marcato) wins over an accent. */
  accent: 'accent' | 'heavy' | undefined;
}

/** The articulations a set of notes sounding together shows: their union. */
export function articulationMarks(notes: readonly Note[]): ArticulationMarks {
  const staccato = notes.some((note) => note.staccato);
  const accent = notes.some((note) => note.accent === 'heavy')
    ? 'heavy'
    : notes.some((note) => note.accent === 'accent')
      ? 'accent'
      : undefined;
  return { staccato, accent };
}
