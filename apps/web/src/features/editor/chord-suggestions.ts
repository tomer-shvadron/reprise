import type { Score } from '@reprise/model';

const cache = new WeakMap<Score, string[]>();

/** The chord names the song already uses, most frequent first (ties in first-seen order). Memoised per score. */
export function chordNamesIn(score: Score): readonly string[] {
  const cached = cache.get(score);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const track of score.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const name = beat.chord?.name;
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
  }
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  cache.set(score, names);
  return names;
}

/** The names that start with `typed`, ignoring case, leaving out the exact match; all of them when nothing is typed. */
export function suggestChords(score: Score, typed: string): string[] {
  const prefix = typed.trim().toLowerCase();
  return chordNamesIn(score).filter(
    (name) => name.toLowerCase() !== prefix && name.toLowerCase().startsWith(prefix),
  );
}
