import { midiNote, type Id, type Score } from '@reprise/model';

import { nameChord } from '@/lib/chords';
import { scoreIndex } from '@/lib/score-index';

import { beatWithTrack } from './words';

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

/**
 * The names the beat's own notes spell, best first, as they sound (capo included) and spelled for
 * the key of the bar. Dead notes do not sound a pitch, and a track that is not fretted has no
 * strings to read, so both leave nothing.
 */
export function chordNamesFromNotes(score: Score, beatId: Id): string[] {
  const found = beatWithTrack(score, beatId);
  const info = scoreIndex(score).beats.get(beatId);
  const masterBar = info && score.masterBars[info.masterBarIndex];
  if (!found || !masterBar || found.track.kind !== 'fretted') return [];
  const pitches: number[] = [];
  for (const note of found.beat.notes) {
    if (note.dead) continue;
    // A string the tuning lacks is a validation finding, not something to name.
    if (note.string > found.track.tuning.length) continue;
    pitches.push(midiNote(found.track, note));
  }
  const names = nameChord(pitches, masterBar.keySignature).map((entry) => entry.name);
  return [...new Set(names)];
}

/**
 * What the chord field offers: the names the beat's notes spell first, then the song's own names,
 * each once, filtered to those that start with `typed` (ignoring case, leaving out the exact
 * match; all of them when nothing is typed). `fromNotes` says how many leading names are the notes'.
 */
export function suggestChordsFor(
  score: Score,
  typed: string,
  beatId?: Id,
): { names: string[]; fromNotes: number } {
  const prefix = typed.trim().toLowerCase();
  const keep = (name: string) =>
    name.toLowerCase() !== prefix && name.toLowerCase().startsWith(prefix);
  const spelled = beatId === undefined ? [] : chordNamesFromNotes(score, beatId).filter(keep);
  const own = chordNamesIn(score).filter((name) => keep(name) && !spelled.includes(name));
  return { names: [...spelled, ...own], fromNotes: spelled.length };
}

/** The names that start with `typed`, ignoring case, leaving out the exact match; all of them when nothing is typed. */
export function suggestChords(score: Score, typed: string, beatId?: Id): string[] {
  return suggestChordsFor(score, typed, beatId).names;
}
