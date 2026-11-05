import type { Beat, LyricLine, Track } from '@reprise/model';

/**
 * Guitar Pro's raw lyric text, one syllable per played beat: spaces and line breaks separate
 * syllables, a hyphen ends one and stays with it, `[...]` is a comment that is not sung, and `+`
 * joins two words onto one beat (shown as a space).
 */
export function syllables(text: string): string[] {
  const sung = text.replaceAll(/\[[^\]]*\]/g, ' ');
  const result: string[] = [];
  for (const word of sung.split(/\s+/)) {
    if (word === '') continue;
    for (const part of word.split(/(?<=-)(?=[^-])/)) result.push(part.replaceAll('+', ' '));
  }
  return result;
}

/**
 * Lays the raw lyric block onto the beats, as Guitar Pro does when a file has no per-beat
 * lyrics: each line from its start bar, along voice 1, skipping rests and empty beats.
 */
export function dispatchLyrics(track: Track, lines: LyricLine[]): void {
  lines.forEach((line, lineIndex) => {
    const chunks = syllables(line.text);
    let next = 0;
    for (const bar of track.bars.slice(line.startBar)) {
      for (const beat of bar.voices[0].beats) {
        if (next >= chunks.length) return;
        if (beat.rest || beat.notes.length === 0) continue;
        setLyric(beat, lineIndex, lines.length, chunks[next] ?? '');
        next++;
      }
    }
  });
}

function setLyric(beat: Beat, line: number, lineCount: number, syllable: string): void {
  const lyrics = beat.lyrics ?? Array.from({ length: lineCount }, () => '');
  lyrics[line] = syllable;
  beat.lyrics = lyrics;
}
