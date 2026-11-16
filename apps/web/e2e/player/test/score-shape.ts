import type { Score } from '@reprise/model';

export interface ShapedBeat {
  duration: number;
  dots: number;
  tuplet: string | undefined;
  rest: boolean;
  /** The note as stored, without its id. */
  notes: Record<string, unknown>[];
}

export interface ShapedScore {
  masterBars: string[];
  /** Per track, per bar, the non-empty voices by index. */
  tracks: { voices: { voice: number; beats: ShapedBeat[] }[] }[][];
}

/**
 * The musical content of a score, with ids and every default that two ways of making a score do
 * not share dropped: the master bars' time signatures, then per track, bar and voice each beat's
 * duration, dots, tuplet and rest and its notes (all but its id) in string order.
 */
export function shapeOf(score: Score): ShapedScore {
  return {
    masterBars: score.masterBars.map(
      ({ timeSignature }) =>
        `${String(timeSignature.numerator)}/${String(timeSignature.denominator)}`,
    ),
    tracks: score.tracks.map((track) =>
      track.bars.map((bar) => ({
        voices: bar.voices.flatMap((voice, index) =>
          voice.beats.length === 0
            ? []
            : [
                {
                  voice: index,
                  beats: voice.beats.map((beat) => ({
                    duration: beat.duration,
                    dots: beat.dots,
                    tuplet: beat.tuplet
                      ? `${String(beat.tuplet.n)}:${String(beat.tuplet.of)}`
                      : undefined,
                    rest: beat.rest,
                    notes: [...beat.notes]
                      .sort((a, b) => a.string - b.string)
                      .map((n) =>
                        Object.fromEntries(Object.entries(n).filter(([key]) => key !== 'id')),
                      ),
                  })),
                },
              ],
        ),
      })),
    ),
  };
}
