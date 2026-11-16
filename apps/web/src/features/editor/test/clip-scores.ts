import type { Id, Score } from '@reprise/model';
import { note, score, type ScoreBuilder } from '@reprise/model/testing';

import type { EditCursor, EditRange } from '@/state/selection';

import { cursorAtPosition } from '../cursor';

/** One 4/4 bar of four quarters on strings 1 to 4, frets starting at `base`. */
export function quarters(built: ScoreBuilder, base: number): ScoreBuilder {
  return built
    .bar()
    .beat('4', [note(1, base)])
    .beat('4', [note(2, base + 1)])
    .beat('4', [note(3, base + 2)])
    .beat('4', [note(4, base + 3)]);
}

/**
 * Two six-string guitars, a bass and a drum track over five bars. Bar 1: four quarters (frets
 * 1 to 4 on the first guitar, 11 to 14 on the second); bar 2: two quarters; bar 3: three quarters
 * and an eighth (room for an eighth); bar 4: empty; bar 5: 3/4 with three quarters.
 */
export function clipboardScore(): Score {
  const built = score().track('guitar', { name: 'Lead' });
  quarters(built, 1);
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 6)]);
  built
    .bar()
    .beat('4', [note(1, 7)])
    .beat('4', [note(2, 8)])
    .beat('4', [note(3, 9)])
    .beat('8', [note(4, 10)]);
  built.bar();
  built
    .bar()
    .timeSignature(3, 4)
    .beat('4', [note(1, 0)])
    .beat('4', [note(2, 0)])
    .beat('4', [note(3, 0)]);
  built.track('guitar', { name: 'Rhythm' });
  quarters(built, 11);
  built
    .bar()
    .beat('4', [note(1, 15)])
    .beat('4', [note(2, 16)]);
  built.bar();
  built.bar();
  built.bar();
  built.track('bass');
  quarters(built, 3);
  built.bar();
  built.bar();
  built.bar();
  built.bar();
  built.track('drums');
  built
    .bar()
    .beat('4', [note(0, 36)])
    .beat('4', [note(0, 38)])
    .beat('4', [note(0, 36)])
    .beat('4', [note(0, 38)]);
  built.bar();
  built.bar();
  built.bar();
  built.bar();
  return built.build({ ids: 'sequential' });
}

/** The cursor at a stop; throws when the score has none there. */
export function cursorAt(
  built: Score,
  track: number,
  bar: number,
  stop: number,
  voice = 0,
  string = 1,
): EditCursor {
  const cursor = cursorAtPosition(built, { track, bar, voice, stop }, { string, staff: 'tab' });
  if (!cursor)
    throw new Error(`no stop at ${String(track)}/${String(bar)}/${String(voice)}/${String(stop)}`);
  return cursor;
}

/** A beats range from beat `from` to beat `to` of bars `bar` to `lastBar` (voice 0), tracks `first` to `last`. */
export function beatsRange(
  built: Score,
  spec: { first: number; last?: number; bar: number; lastBar?: number; from: number; to: number },
): EditRange {
  const beat = (track: number, bar: number, stop: number): Id | undefined =>
    built.tracks[track]?.bars[bar]?.voices[0]?.beats[stop]?.id;
  const last = spec.last ?? spec.first;
  const lastBar = spec.lastBar ?? spec.bar;
  const masterBar = (bar: number): Id => {
    const found = built.masterBars[bar]?.id;
    if (!found) throw new Error('no bar');
    return found;
  };
  const trackId = (track: number): Id => {
    const found = built.tracks[track]?.id;
    if (!found) throw new Error('no track');
    return found;
  };
  return {
    kind: 'beats',
    anchor: {
      track: trackId(spec.first),
      masterBar: masterBar(spec.bar),
      beat: beat(spec.first, spec.bar, spec.from),
    },
    focus: {
      track: trackId(last),
      masterBar: masterBar(lastBar),
      beat: beat(last, lastBar, spec.to),
    },
  };
}

/** A bars range over bars `from` to `to` on tracks `first` to `last`. */
export function barsRange(
  built: Score,
  spec: { first: number; last?: number; from: number; to: number },
): EditRange {
  const masterBar = (bar: number): Id => {
    const found = built.masterBars[bar]?.id;
    if (!found) throw new Error('no bar');
    return found;
  };
  const trackId = (track: number): Id => {
    const found = built.tracks[track]?.id;
    if (!found) throw new Error('no track');
    return found;
  };
  return {
    kind: 'bars',
    anchor: { track: trackId(spec.first), masterBar: masterBar(spec.from), beat: undefined },
    focus: {
      track: trackId(spec.last ?? spec.first),
      masterBar: masterBar(spec.to),
      beat: undefined,
    },
  };
}
