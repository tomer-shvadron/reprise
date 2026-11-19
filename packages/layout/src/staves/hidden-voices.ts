import { beatTicks, type Bar } from '@reprise/model';

/**
 * Gould and Guitar Pro: a secondary voice that is one rest filling the whole bar, beside a voice
 * with notes, is not drawn and does not make the bar two-voice. Any other voice holding only rests
 * (a short rest, several rests) is a voice like any other. Shared by the standard and tab staves
 * so tab-only and standard agree.
 */
export function hiddenVoices(bar: Bar, ticksPerBar: number): Set<number> {
  const hasNotes = (beats: Bar['voices'][number]['beats']): boolean =>
    beats.some((beat) => !beat.rest && beat.notes.length > 0);
  const anyNotes = bar.voices.some((voice) => hasNotes(voice.beats));
  const hidden = new Set<number>();
  if (!anyNotes) return hidden;
  for (const [i, { beats }] of bar.voices.entries()) {
    const [only] = beats;
    if (i > 0 && beats.length === 1 && only?.rest && beatTicks(only) >= ticksPerBar - 1e-6) {
      hidden.add(i);
    }
  }
  return hidden;
}
