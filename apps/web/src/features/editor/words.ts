import { chain, LYRIC_LINES, setBeatEffect, setTrackProperties } from '@reprise/model';
import type { Beat, Command, Id, Score, Track } from '@reprise/model';

import { scoreIndex } from '@/features/score';

export type WordKind = 'chord' | 'text' | 'lyric';

export interface WordEdit {
  kind: WordKind;
  beatId: Id;
  /** The lyric line, 0 to 4; ignored for a chord name and beat text. */
  line?: number;
  value: string;
}

export type WordPlan =
  { command: Command; notice?: string } | { nothing: true } | { refused: string };

/** The beat with `id` and the track that holds it. */
export function beatWithTrack(score: Score, id: Id): { beat: Beat; track: Track } | undefined {
  const info = scoreIndex(score).beats.get(id);
  const track = info && score.tracks[info.trackIndex];
  const beat = info && track?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  return track && beat ? { beat, track } : undefined;
}

/** The word a beat already carries in a field: what the field shows when it opens. */
export function wordValue(beat: Beat, kind: WordKind, line = 0): string {
  if (kind === 'chord') return beat.chord?.name ?? '';
  if (kind === 'text') return beat.text ?? '';
  return beat.lyrics?.[line] ?? '';
}

/** `line` of a beat's lyrics set to `value`: shorter lines padded with `''`, trailing `''` dropped, none left is null. */
function lyricLines(beat: Beat, line: number, value: string): string[] | null {
  const lines = Array.from(
    { length: Math.max(beat.lyrics?.length ?? 0, line + 1) },
    (_, index) => beat.lyrics?.[index] ?? '',
  );
  lines[line] = value;
  while (lines.at(-1) === '') lines.pop();
  return lines.length === 0 ? null : lines;
}

/** The command that sets one word on a beat, labelled for the undo menu. */
export function planWord(score: Score, edit: WordEdit): WordPlan {
  const found = beatWithTrack(score, edit.beatId);
  if (!found) return { refused: 'That beat is gone' };
  const { beat, track } = found;
  const { beatId, kind } = edit;
  // A trailing space is never part of a word: the field commits on it.
  const value = edit.value.trim();

  if (kind === 'chord') {
    if (value === wordValue(beat, 'chord')) return { nothing: true };
    if (value === '') {
      const command = chain('Chord name', [setBeatEffect({ beatId }, { chord: null })]);
      return beat.chord?.diagram ? { command, notice: 'Chord diagram removed' } : { command };
    }
    return {
      command: chain('Chord name', [
        setBeatEffect({ beatId }, { chord: { ...beat.chord, name: value } }),
      ]),
    };
  }

  if (kind === 'text') {
    if (value === wordValue(beat, 'text')) return { nothing: true };
    return {
      command: chain('Text', [setBeatEffect({ beatId }, { text: value === '' ? null : value })]),
    };
  }

  const line = edit.line ?? 0;
  if (!Number.isInteger(line) || line < 0 || line >= LYRIC_LINES) {
    return { refused: `Lyrics have ${String(LYRIC_LINES)} lines` };
  }
  if (value === wordValue(beat, 'lyric', line)) return { nothing: true };
  const steps: Command[] = [setBeatEffect({ beatId }, { lyrics: lyricLines(beat, line, value) })];
  // The raw block would otherwise be written next to the beat lyrics, and laid out again by
  // readers once every beat lyric is gone (decision D4).
  if (track.lyrics.length > 0)
    steps.push(setTrackProperties({ trackId: track.id }, { lyrics: [] }));
  return { command: chain('Lyrics', steps) };
}
