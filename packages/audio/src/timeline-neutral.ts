import type { Score } from '@reprise/model';

/**
 * True when `next` differs from `previous` only in track properties the timeline never reads
 * (name, colour, display, channel, program, lyrics), so the edit can reach the sampler without
 * rebuilding the sequence. Identity is exact: Immer keeps every node an edit did not touch, and
 * undo and redo keep them too. `bank` is not neutral because the sink resolves a beat's program
 * change against the timeline's copy of the track; `sound` is the HQ tier switch.
 */
export function timelineNeutral(previous: Score, next: Score): boolean {
  if (previous.masterBars !== next.masterBars || previous.tracks.length !== next.tracks.length) {
    return false;
  }
  return next.tracks.every((track, index) => {
    const old = previous.tracks[index];
    return (
      old !== undefined &&
      (old === track ||
        (old.id === track.id &&
          old.bars === track.bars &&
          old.kind === track.kind &&
          old.tuning === track.tuning &&
          old.capo === track.capo &&
          old.bank === track.bank &&
          old.sound === track.sound))
    );
  });
}
