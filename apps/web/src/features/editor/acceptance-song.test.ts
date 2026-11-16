import { expandPlaybackSequence, tempoMap } from '@reprise/model';
import { score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { acceptanceSong, EXPECTED_BARS } from './test/acceptance-song';

describe('the acceptance song, built the way the dialogs build it', () => {
  const song = acceptanceSong();

  it('plays bars 1, 2, 3, 2, 4, 5, 6, 1, 2, 4, 7 with no warning', () => {
    const { sequence, warnings } = expandPlaybackSequence(song);
    expect(sequence.map(({ masterBarIndex }) => masterBarIndex + 1)).toEqual(EXPECTED_BARS);
    expect(warnings).toEqual([]);
  });

  it('lasts 10.5 s at 240 BPM: nine 1 s bars and two 0.75 s bars', () => {
    const map = tempoMap(song, expandPlaybackSequence(song).sequence);
    expect(map.durationSeconds).toBeCloseTo(10.5, 9);
    expect(
      map.passes.map(({ masterBarIndex, durationSeconds }) => [
        masterBarIndex + 1,
        durationSeconds,
      ]),
    ).toEqual(EXPECTED_BARS.map((bar) => [bar, bar === 5 || bar === 6 ? 0.75 : 1]));
  });

  it('matches the same master bars made with the model builders, field by field', () => {
    const built = scoreBuilder().track('guitar');
    built
      .bar()
      .masterBar({ tempo: { bpm: 240 } })
      .target('segno');
    built.bar().repeatStart();
    built.bar().repeatEnd(2).volta([1]);
    built.bar().volta([2]).jump('toCoda');
    built.bar().masterBar({ timeSignature: { numerator: 3, denominator: 4 } });
    built.bar().jump('dsAlCoda');
    built
      .bar()
      .masterBar({ timeSignature: { numerator: 4, denominator: 4 } })
      .target('coda');
    const withoutId = (bars: typeof song.masterBars) => bars.map((bar) => ({ ...bar, id: '' }));
    expect(withoutId(song.masterBars)).toEqual(withoutId(built.build().masterBars));
  });
});
