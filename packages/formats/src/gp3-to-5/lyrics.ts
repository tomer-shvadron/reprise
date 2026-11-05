import type { Track } from '@reprise/model';

import type { WarningLog } from '../warnings';
import type { LyricsBlock } from './header';

/**
 * Splits a Guitar Pro lyric line into the syllables it puts on successive beats. A space or a
 * line break ends a syllable and a hyphen ends one too, staying attached to it; each extra space
 * leaves one beat without a syllable; `+` joins two words onto one beat; `[...]` is a comment;
 * trailing underscores (an extender line) are dropped.
 */
export function syllables(text: string): string[] {
  const result: string[] = [];
  for (const line of text.replaceAll(/\[[^\]]*\]?/g, '').split(/\r\n|\r|\n/)) {
    const words = line.split(/[ \t]/);
    // Spaces around a line are layout, not skipped beats.
    while (words[0] === '') words.shift();
    while (words.at(-1) === '') words.pop();
    for (const word of words) {
      const pieces = word.match(/[^-]+-*|-+/g) ?? [''];
      for (const piece of pieces) result.push(piece.replaceAll('+', ' ').replace(/_+$/, ''));
    }
  }
  return result;
}

/**
 * Fills `Beat.lyrics` on the lyric track from the raw block: each line's syllables go onto the
 * played beats of the first voice from its start bar on, skipping rests and empty beats, as
 * Guitar Pro places them.
 */
export function applyLyrics(track: Track, block: LyricsBlock, log: WarningLog): void {
  const lineCount = block.lines.length;
  block.lines.forEach((line, index) => {
    const queue = syllables(line.text);
    let placed = 0;
    for (let bar = line.startBar; bar < track.bars.length && placed < queue.length; bar++) {
      for (const beat of track.bars[bar]?.voices[0].beats ?? []) {
        if (placed >= queue.length) break;
        if (beat.rest || beat.notes.length === 0) continue;
        beat.lyrics ??= Array.from({ length: lineCount }, () => '');
        beat.lyrics[index] = queue[placed] ?? '';
        placed++;
      }
    }
    if (placed < queue.length) {
      log.warn(
        'lyrics-unplaced',
        `lyric line ${String(index + 1)} has ${String(queue.length - placed)} syllables past the last played beat`,
        { offset: block.offset, track: block.track },
      );
    }
  });
}
