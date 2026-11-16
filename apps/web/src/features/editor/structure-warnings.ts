import { JUMP_LABELS } from '@reprise/layout';
import { JumpKindSchema, expandPlaybackSequence, type Score } from '@reprise/model';

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The model's playback warnings name a jump by its id; the score engraves its label. */
function labelled(message: string): string {
  const kind = JumpKindSchema.options.find((option) => message.startsWith(`${option} `));
  return kind === undefined ? message : `${JUMP_LABELS[kind]}${message.slice(kind.length)}`;
}

/**
 * Endings no pass reaches: a run of endings numbered past the play count of its repeat end, as
 * endings 1, 2 and 3 on a repeat played twice. Neither the model nor playback warns about it.
 */
function endingsBeyondCount(score: Score): string[] {
  const warnings: string[] = [];
  const { masterBars } = score;
  for (let at = 0; at < masterBars.length; at++) {
    if (masterBars[at]?.alternateEndings.length === 0) continue;
    let end = at;
    while ((masterBars[end + 1]?.alternateEndings.length ?? 0) > 0) end++;
    const run = masterBars.slice(at, end + 1);
    const count = Math.max(0, ...run.map(({ repeat }) => repeat.endCount));
    const highest = Math.max(...run.flatMap(({ alternateEndings }) => alternateEndings));
    if (count > 0 && highest > count) {
      warnings.push(
        `Ending ${String(highest)} at bar ${String(at + 1)} is never played: the repeat plays ${String(count)} times`,
      );
    }
    at = end;
  }
  return warnings;
}

/** Everything about the song's structure playback would ignore or work around, as sentences. */
export function structureWarnings(score: Score): string[] {
  return [
    ...expandPlaybackSequence(score).warnings.map(({ message }) => sentence(labelled(message))),
    ...endingsBeyondCount(score),
  ];
}

/** The warnings an edit brought: those `after` that `before` did not have. */
export function newStructureWarnings(before: Score, after: Score): string[] {
  const had = new Set(structureWarnings(before));
  return structureWarnings(after).filter((warning) => !had.has(warning));
}
