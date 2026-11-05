import { describe, expect, it } from 'vitest';

import type { Bar } from './bar';
import type { Beat } from './beat';
import {
  STANDARD_TUNING,
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createTrack,
  createVoice,
} from './factories';
import type { MasterBar } from './master-bar';
import type { Score } from './score';
import type { Track } from './track';
import { validateScore } from './validate';
import type { ViolationRule } from './validate';

function barWith(...beats: Beat[]): Bar {
  return {
    ...createBar(),
    voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
  };
}

// The first bar's tempo is a rule of its own; every other test starts from one.
function scoreOf(tracks: Track[], masterBars: MasterBar[] = [createMasterBar()]): Score {
  const [first, ...rest] = masterBars;
  const timed = first && !first.tempo ? [{ ...first, tempo: { bpm: 120 } }, ...rest] : masterBars;
  return { ...createEmptyScore(), masterBars: timed, tracks };
}

function guitar(...bars: Bar[]): Track {
  return createTrack('fretted', { bars });
}

function rules(score: Score): ViolationRule[] {
  return validateScore(score).map((violation) => violation.rule);
}

const quarter = (string = 1, fret = 0, tie = false): Beat =>
  createBeat({ notes: [createNote({ string, fret, tie })] });

describe('validateScore', () => {
  it('accepts the empty score', () => {
    expect(validateScore(createEmptyScore())).toEqual([]);
  });

  describe('first-bar-tempo', () => {
    it('rejects a score whose first master bar has no tempo mark', () => {
      const score = { ...createEmptyScore(), masterBars: [createMasterBar()] };
      expect(validateScore(score)).toEqual([
        {
          rule: 'first-bar-tempo',
          path: ['masterBars', 0, 'tempo'],
          message: 'the first master bar has no tempo mark',
        },
      ]);
    });

    it('needs the mark on the first bar only', () => {
      const score = scoreOf(
        [guitar(createBar(), createBar())],
        [createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual([]);
    });
  });

  describe('bar-count', () => {
    it('accepts a track with one bar per master bar', () => {
      const score = scoreOf(
        [guitar(createBar(), createBar())],
        [createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual([]);
    });

    it('rejects a track with fewer bars than master bars', () => {
      const score = scoreOf([guitar(createBar())], [createMasterBar(), createMasterBar()]);
      expect(validateScore(score)).toEqual([
        {
          rule: 'bar-count',
          path: ['tracks', 0, 'bars'],
          message: 'track has 1 bars but the score has 2 master bars',
        },
      ]);
    });
  });

  describe('voice-overfull', () => {
    it('accepts a full bar and an incomplete one', () => {
      expect(rules(scoreOf([guitar(barWith(quarter(), quarter(), quarter(), quarter()))]))).toEqual(
        [],
      );
      expect(rules(scoreOf([guitar(barWith(quarter()))]))).toEqual([]);
    });

    it('accepts dotted values and tuplets that fill the bar exactly', () => {
      const septuplet = (): Beat =>
        createBeat({ duration: 16, tuplet: { n: 7, of: 4 }, rest: true });
      const bar = barWith(
        createBeat({ duration: 2, dots: 1, rest: true }),
        ...Array.from({ length: 7 }, septuplet),
      );
      expect(rules(scoreOf([guitar(bar)]))).toEqual([]);
    });

    it('rejects a voice longer than the bar', () => {
      const score = scoreOf(
        [guitar(barWith(createBeat({ duration: 2, dots: 1, rest: true }), quarter(), quarter()))],
        [createMasterBar({ timeSignature: { numerator: 3, denominator: 4 } })],
      );
      expect(validateScore(score)).toEqual([
        {
          rule: 'voice-overfull',
          path: ['tracks', 0, 'bars', 0, 'voices', 0],
          message: 'voice holds 4800 ticks but the bar is 2880 ticks long',
        },
      ]);
    });

    it('checks every voice, not just the first', () => {
      const bar = createBar();
      bar.voices[2].beats = [createBeat({ duration: 1, rest: true }), createBeat({ rest: true })];
      expect(validateScore(scoreOf([guitar(bar)]))[0]?.path).toEqual([
        'tracks',
        0,
        'bars',
        0,
        'voices',
        2,
      ]);
    });
  });

  describe('string-range', () => {
    it('accepts strings 1 to the string count', () => {
      expect(rules(scoreOf([guitar(barWith(quarter(1), quarter(6)))]))).toEqual([]);
    });

    it('rejects string 0 and a string past the last one on a fretted track', () => {
      const score = scoreOf([guitar(barWith(quarter(0), quarter(7)))]);
      expect(validateScore(score).map(({ rule, path }) => ({ rule, path }))).toEqual([
        {
          rule: 'string-range',
          path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'notes', 0, 'string'],
        },
        {
          rule: 'string-range',
          path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 1, 'notes', 0, 'string'],
        },
      ]);
    });

    it('requires string 0 on drum and pitched tracks', () => {
      const drums = createTrack('drums', { bars: [barWith(quarter(0, 36))] });
      const piano = createTrack('pitched', { bars: [barWith(quarter(1, 60))] });
      expect(rules(scoreOf([drums]))).toEqual([]);
      expect(rules(scoreOf([piano]))).toEqual(['string-range']);
    });

    it('checks grace notes too', () => {
      const beat = createBeat({
        notes: [createNote({ string: 1, fret: 3 })],
        grace: [{ duration: 32, before: true, notes: [createNote({ string: 9, fret: 2 })] }],
      });
      expect(validateScore(scoreOf([guitar(barWith(beat))]))[0]?.path).toEqual([
        'tracks',
        0,
        'bars',
        0,
        'voices',
        0,
        'beats',
        0,
        'grace',
        0,
        'notes',
        0,
        'string',
      ]);
    });
  });

  describe('fret-range', () => {
    it('accepts the open string and the last fret, whatever the capo', () => {
      const capoed = createTrack('fretted', {
        capo: 7,
        bars: [barWith(quarter(1, 0), quarter(2, 24))],
      });
      expect(rules(scoreOf([capoed]))).toEqual([]);
    });

    it('rejects a fret past the neck on a fretted track, with a path to the fret', () => {
      const short = createTrack('fretted', { fretCount: 20, bars: [barWith(quarter(1, 21))] });
      expect(validateScore(scoreOf([short]))).toEqual([
        {
          rule: 'fret-range',
          path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'notes', 0, 'fret'],
          message: 'fret 21 is outside 0 to 20',
        },
      ]);
    });

    it('leaves drum and pitched notes alone, whose fret is a MIDI note', () => {
      const drums = createTrack('drums', { bars: [barWith(quarter(0, 36))] });
      const piano = createTrack('pitched', { bars: [barWith(quarter(0, 108))] });
      expect(rules(scoreOf([drums, piano]))).toEqual([]);
    });
  });

  describe('duplicate-string', () => {
    it('rejects two notes on one string in a beat', () => {
      const beat = createBeat({
        notes: [createNote({ string: 2, fret: 1 }), createNote({ string: 2, fret: 3 })],
      });
      expect(rules(scoreOf([guitar(barWith(beat))]))).toEqual(['duplicate-string']);
    });
  });

  describe('tie-target', () => {
    it('accepts a tie to the same string in the previous beat', () => {
      expect(rules(scoreOf([guitar(barWith(quarter(3, 5), quarter(3, 5, true)))]))).toEqual([]);
    });

    it('accepts a tie across the bar line', () => {
      const score = scoreOf(
        [guitar(barWith(quarter(3, 5)), barWith(quarter(3, 5, true)))],
        [createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual([]);
    });

    it('matches by MIDI note on drum and pitched tracks', () => {
      const piano = createTrack('pitched', {
        bars: [barWith(quarter(0, 60), quarter(0, 60, true))],
      });
      expect(rules(scoreOf([piano]))).toEqual([]);
      const wrong = createTrack('pitched', {
        bars: [barWith(quarter(0, 60), quarter(0, 62, true))],
      });
      expect(rules(scoreOf([wrong]))).toEqual(['tie-target']);
    });

    it('rejects a tie on the first beat of the score', () => {
      expect(validateScore(scoreOf([guitar(barWith(quarter(1, 0, true)))]))).toEqual([
        {
          rule: 'tie-target',
          path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'notes', 0, 'tie'],
          message: 'tied note has no earlier note on string 1 in its voice within 3 bars',
        },
      ]);
    });

    it('reaches back past several beats of melody on other strings and past rests', () => {
      const held = barWith(
        quarter(2, 5),
        quarter(1, 3),
        createBeat({ rest: true }),
        quarter(2, 5, true),
      );
      expect(rules(scoreOf([guitar(held)]))).toEqual([]);
    });

    it('reaches back up to three bars and no further', () => {
      const bars = (gap: number): Bar[] => [
        barWith(quarter(2, 5)),
        ...Array.from({ length: gap }, () => barWith(quarter(1, 3))),
        barWith(quarter(1, 3), quarter(2, 5, true)),
      ];
      const masterBars = (count: number): MasterBar[] =>
        Array.from({ length: count }, () => createMasterBar());
      expect(rules(scoreOf([guitar(...bars(2))], masterBars(4)))).toEqual([]);
      expect(rules(scoreOf([guitar(...bars(3))], masterBars(5)))).toEqual(['tie-target']);
    });

    it('takes the most recent note on the string, so an intervening note breaks the hold', () => {
      const interrupted = barWith(quarter(2, 5), quarter(2, 7), quarter(1, 3), quarter(2, 5, true));
      expect(rules(scoreOf([guitar(interrupted)]))).toEqual(['tie-pitch']);
      const restruck = barWith(quarter(2, 5), quarter(2, 5), quarter(1, 3), quarter(2, 5, true));
      expect(rules(scoreOf([guitar(restruck)]))).toEqual([]);
    });

    it('accepts a chain of three across bar lines', () => {
      const score = scoreOf(
        [
          guitar(
            barWith(quarter(2, 5), quarter(1, 3)),
            barWith(quarter(1, 7), quarter(2, 5, true)),
            barWith(quarter(2, 5, true)),
          ),
        ],
        [createMasterBar(), createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual([]);
    });

    it('keeps voices apart', () => {
      const bar: Bar = {
        ...createBar(),
        voices: [
          createVoice([quarter(2, 5)]),
          createVoice([quarter(1, 3), quarter(2, 5, true)]),
          createVoice(),
          createVoice(),
        ],
      };
      expect(rules(scoreOf([guitar(bar)]))).toEqual(['tie-target']);
    });

    it('rejects a tie to a different string, to a rest, and across an empty previous bar', () => {
      expect(rules(scoreOf([guitar(barWith(quarter(2), quarter(3, 0, true)))]))).toEqual([
        'tie-target',
      ]);
      const afterRest = barWith(createBeat({ rest: true }), quarter(1, 0, true));
      expect(rules(scoreOf([guitar(afterRest)]))).toEqual(['tie-target']);
      const score = scoreOf(
        [guitar(createBar(), barWith(quarter(1, 0, true)))],
        [createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual(['tie-target']);
    });
  });

  describe('tie-pitch', () => {
    it('rejects a tied note on another fret than the note it continues', () => {
      expect(validateScore(scoreOf([guitar(barWith(quarter(3, 5), quarter(3, 7, true)))]))).toEqual(
        [
          {
            rule: 'tie-pitch',
            path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 1, 'notes', 0, 'fret'],
            message: 'tied note is on fret 7 but the note it continues is on fret 5',
          },
        ],
      );
    });

    it('checks across the bar line and leaves untied notes alone', () => {
      const score = scoreOf(
        [guitar(barWith(quarter(3, 5)), barWith(quarter(3, 6, true), quarter(3, 9)))],
        [createMasterBar(), createMasterBar()],
      );
      expect(rules(score)).toEqual(['tie-pitch']);
    });
  });

  describe('tuplet', () => {
    it.each([
      [3, 2],
      [5, 4],
      [7, 4],
      [13, 8],
      [2, 3],
      [4, 3],
    ])('accepts %i:%i', (n, of) => {
      const beat = createBeat({ duration: 16, rest: true, tuplet: { n, of } });
      expect(rules(scoreOf([guitar(barWith(beat))]))).toEqual([]);
    });

    it.each([
      [1, 1],
      [3, 3],
      [4, 2],
      [2, 4],
      [9, 2],
    ])('rejects %i:%i', (n, of) => {
      const beat = createBeat({ duration: 16, rest: true, tuplet: { n, of } });
      expect(rules(scoreOf([guitar(barWith(beat))]))).toEqual(['tuplet']);
    });
  });

  describe('dots', () => {
    it('accepts zero to two dots', () => {
      const bar = barWith(
        createBeat({ duration: 8, rest: true }),
        createBeat({ duration: 8, dots: 1, rest: true }),
        createBeat({ duration: 8, dots: 2, rest: true }),
      );
      expect(rules(scoreOf([guitar(bar)]))).toEqual([]);
    });

    it('rejects a value the schema would refuse, as from unchecked input', () => {
      const beat = createBeat({ duration: 16, rest: true });
      Reflect.set(beat, 'dots', 3);
      const bar = barWith(beat);
      expect(rules(scoreOf([guitar(bar)]))).toEqual(['dots']);
    });
  });

  describe('alternate endings', () => {
    const repeated = (endCount: number, alternateEndings: number[], start = false): MasterBar =>
      createMasterBar({ repeat: { start, endCount }, alternateEndings });

    function withMasterBars(masterBars: MasterBar[]): Score {
      return scoreOf([guitar(...masterBars.map(() => createBar()))], masterBars);
    }

    it('accepts voltas around a repeat end, including the final volta after it', () => {
      const score = withMasterBars([
        repeated(0, [], true),
        repeated(0, [1]),
        repeated(2, [1]),
        repeated(0, [2]),
        repeated(0, []),
      ]);
      expect(rules(score)).toEqual([]);
    });

    it('accepts a bar shared by several voltas', () => {
      expect(
        rules(withMasterBars([repeated(0, [], true), repeated(3, [1, 2]), repeated(0, [3])])),
      ).toEqual([]);
    });

    it('rejects voltas with no repeat end in their run', () => {
      const score = withMasterBars([repeated(0, []), repeated(0, [1]), repeated(0, [2])]);
      expect(validateScore(score).map(({ rule, path }) => ({ rule, path }))).toEqual([
        { rule: 'alternate-ending-outside-repeat', path: ['masterBars', 1, 'alternateEndings'] },
        { rule: 'alternate-ending-outside-repeat', path: ['masterBars', 2, 'alternateEndings'] },
      ]);
    });

    it('rejects a final volta separated from its repeat', () => {
      const score = withMasterBars([repeated(2, [], true), repeated(0, []), repeated(0, [2])]);
      expect(rules(score)).toEqual(['alternate-ending-outside-repeat']);
    });

    it('rejects unordered or repeated volta numbers', () => {
      expect(rules(withMasterBars([repeated(2, [2, 1], true)]))).toEqual([
        'alternate-ending-order',
      ]);
      expect(rules(withMasterBars([repeated(2, [1, 1], true)]))).toEqual([
        'alternate-ending-order',
      ]);
    });
  });

  describe('track-kind', () => {
    it('rejects a fretted track without strings', () => {
      expect(rules(scoreOf([createTrack('fretted', { tuning: [] })]))).toEqual(['track-kind']);
    });

    it('rejects tuning, capo or frets on a drums track', () => {
      expect(rules(scoreOf([createTrack('drums', { tuning: [40] })]))).toEqual(['track-kind']);
      expect(rules(scoreOf([createTrack('drums', { capo: 2, fretCount: 24 })]))).toEqual([
        'track-kind',
        'track-kind',
      ]);
    });

    it('accepts the tuning a GP5 keyboard track keeps on a pitched track', () => {
      const keys = createTrack('pitched', {
        tuning: [...STANDARD_TUNING],
        fretCount: 24,
        bars: [barWith(quarter(0, 60))],
      });
      expect(rules(scoreOf([keys]))).toEqual([]);
    });
  });

  describe('rest-with-notes', () => {
    it('rejects a rest that carries notes', () => {
      const beat = createBeat({ rest: true, notes: [createNote({ string: 1, fret: 0 })] });
      expect(rules(scoreOf([guitar(barWith(beat))]))).toEqual(['rest-with-notes']);
    });
  });

  describe('chord-diagram', () => {
    const diagram = (frets: (number | null)[]): Beat =>
      createBeat({ rest: true, chord: { name: 'E', diagram: { baseFret: 1, frets } } });

    it('accepts one fret per string, and a name-only chord', () => {
      expect(rules(scoreOf([guitar(barWith(diagram([0, 0, 1, 2, 2, 0])))]))).toEqual([]);
      const nameOnly = createBeat({ rest: true, chord: { name: 'E' } });
      expect(rules(scoreOf([guitar(barWith(nameOnly))]))).toEqual([]);
    });

    it('rejects a diagram with the wrong string count, with a path into the diagram', () => {
      expect(validateScore(scoreOf([guitar(barWith(diagram([0, 0, 1, 2])))]))[0]?.path).toEqual([
        'tracks',
        0,
        'bars',
        0,
        'voices',
        0,
        'beats',
        0,
        'chord',
        'diagram',
        'frets',
      ]);
    });

    it('checks a diagram against the tuning a pitched track keeps, and skips drums', () => {
      const keys = createTrack('pitched', {
        tuning: [...STANDARD_TUNING],
        fretCount: 24,
        bars: [barWith(diagram([0, 0, 1, 2]))],
      });
      expect(rules(scoreOf([keys]))).toEqual(['chord-diagram']);
      const drums = createTrack('drums', { bars: [barWith(diagram([0, 0, 1, 2]))] });
      expect(rules(scoreOf([drums]))).toEqual([]);
    });
  });

  describe('duplicate-id', () => {
    it('rejects an id used twice', () => {
      const beat = quarter();
      const twin = { ...quarter(2), id: beat.id };
      const violations = validateScore(scoreOf([guitar(barWith(beat, twin))]));
      expect(violations.map(({ rule, path }) => ({ rule, path }))).toEqual([
        { rule: 'duplicate-id', path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 1, 'id'] },
      ]);
    });
  });
});
