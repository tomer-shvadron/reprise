import type { Whammy } from '@reprise/model';
import { note, midi, score as scoreBuilder, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { FormatError } from '../errors';

import { writeAsciiTab, type AsciiTabOptions } from './write-ascii-tab';

function tab(builder: ScoreBuilder, options: Partial<AsciiTabOptions> = {}) {
  const built = builder.build({ validate: false });
  const tracks = built.tracks.map((track) => track.id);
  return writeAsciiTab(built, { tracks, ...options });
}

/** The lines of the text, header and legend included. */
function linesOf(builder: ScoreBuilder, options: Partial<AsciiTabOptions> = {}): string[] {
  return tab(builder, options).text.trimEnd().split('\n');
}

/** The top string's line, the part between the bar lines (`e|` first, whatever else follows). */
function topLine(builder: ScoreBuilder, options: Partial<AsciiTabOptions> = {}): string {
  const line = linesOf(builder, options).find((candidate) => /^e\|/.test(candidate));
  if (line === undefined) throw new Error('no e line');
  return line;
}

const guitar = (): ScoreBuilder => scoreBuilder().track('guitar');

describe('note tokens', () => {
  it('writes frets, one or two digits', () => {
    expect(
      topLine(
        guitar()
          .bar()
          .beat('4', [note(1, 7)])
          .beat('4', [note(1, 12)]),
      ),
    ).toBe('e|-7--12-|');
  });

  it('writes a tie as dashes', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('4', [note(1, 7)])
        .beat('4', [note(1, 7, { tie: true })]),
    );
    expect(line).toBe('e|-7---|');
  });

  it('writes dead, ghost and rests', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('4', [note(1, 3, { dead: true })])
        .beat('4', [note(1, 7, { ghost: true })])
        .rest('4'),
    );
    expect(line).toBe('e|-x---(7)-----|');
  });

  it('writes a hammer-on up and a pull-off down by the fret direction', () => {
    const up = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 5)])
        .beat('8', [note(1, 7, { hammerPull: true })]),
    );
    const down = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 7)])
        .beat('8', [note(1, 5, { hammerPull: true })]),
    );
    expect(up).toContain('h7');
    expect(down).toContain('p5');
  });

  it('finds a hammer-on origin in the previous bar', () => {
    const builder = guitar()
      .bar()
      .beat('4', [note(1, 9)])
      .bar()
      .beat('4', [note(1, 7, { hammerPull: true })]);
    expect(topLine(builder, { bars: { start: 1, end: 2 } })).toContain('p7');
  });

  it('points a slide by the next note on the string', () => {
    const up = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 5, { slide: ['shift'] })])
        .beat('8', [note(1, 9)]),
    );
    const down = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 9, { slide: ['legato'] })])
        .beat('8', [note(1, 5)]),
    );
    expect(up).toContain('5/');
    expect(down).toContain('9\\');
  });

  it('prints a slide with no next note as going up', () => {
    expect(
      topLine(
        guitar()
          .bar()
          .beat('4', [note(1, 7, { slide: ['shift'] })]),
      ),
    ).toContain('7/');
  });

  it('writes slides into and out of a note', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 7, { slide: ['intoFromBelow'] })])
        .beat('8', [note(1, 7, { slide: ['intoFromAbove'] })])
        .beat('8', [note(1, 7, { slide: ['outDown'] })])
        .beat('8', [note(1, 7, { slide: ['outUp'] })]),
    );
    expect(line).toContain('/7');
    expect(line).toContain('\\7');
    expect(line).toContain('7\\');
    expect(line).toContain('7/');
  });

  it.each([
    ['bend', [0, 4], '7b9'],
    ['bendRelease', [0, 4, 0], '7b9r7'],
    ['bendReleaseBend', [0, 4, 0, 4], '7b9r7b9'],
    ['prebend', [4, 4], '7pb9'],
    ['prebendBend', [4, 4, 6], '7pb9b10'],
    ['prebendRelease', [4, 4, 0], '7pb9r7'],
    ['release', [4, 0], '7r7'],
    ['hold', [4, 4], '7b9'],
    ['bend', [0, 1], '7b7.5'],
  ] as const)('writes a %s bend %j as %s', (kind, values, expected) => {
    const bend = { kind, points: values.map((value, i) => ({ position: i * 10, value })) };
    expect(
      topLine(
        guitar()
          .bar()
          .beat('4', [note(1, 7, { bend })]),
      ),
    ).toContain(expected);
  });

  it('writes vibrato on the note or the beat', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('4', [note(1, 7, { vibrato: 'slight' })])
        .beat('4', [note(1, 7)], { effects: { vibrato: 'wide' } }),
    );
    expect(line.match(/7~/g)).toHaveLength(2);
  });

  it('writes natural, other harmonics, tap, slap, pop and a trill', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('8', [note(1, 12, { harmonic: { kind: 'natural' } })])
        .beat('8', [note(1, 2, { harmonic: { kind: 'natural', value: 2.7 } })])
        .beat('8', [note(1, 5, { harmonic: { kind: 'artificial', value: 12 } })])
        .beat('8', [note(1, 7)], { effects: { tapping: true } })
        .beat('8', [note(1, 7)], { effects: { slapping: true } })
        .beat('8', [note(1, 7)], { effects: { popping: true } })
        .beat('8', [note(1, 7, { trill: { fret: 9, speed: 16 } })]),
    );
    for (const token of ['<12>', '<2.7>', '[17]', 't7', 's7', 'P7', '7tr9']) {
      expect(line).toContain(token);
    }
  });
});

describe('columns', () => {
  it('lines two-digit frets up in a chord', () => {
    const lines = linesOf(
      guitar()
        .bar()
        .beat('4', [note(1, 12), note(2, 5), note(3, 7)])
        .beat('4', [note(2, 3)]),
    );
    expect(lines.slice(3, 6)).toEqual(['e|-12----|', 'B|-5--3--|', 'G|-7-----|']);
  });

  it('spaces beats by length: a quarter is four times a sixteenth', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('4', [note(1, 1)])
        .beat('16', [note(1, 2)])
        .beat('16', [note(1, 3)])
        .beat('16', [note(1, 4)])
        .beat('16', [note(1, 5)]),
    );
    expect(line).toBe('e|-1-------2-3-4-5-|');
  });

  it('spaces a triplet by its real length', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('8t', [note(1, 1)])
        .beat('8t', [note(1, 2)])
        .beat('8t', [note(1, 3)])
        .beat('4', [note(1, 4)]),
    );
    expect(line).toBe('e|-1-2-3-4-----|');
  });

  it('draws an empty bar as two dashes a beat', () => {
    const line = topLine(
      guitar()
        .bar()
        .beat('4', [note(1, 1)])
        .bar()
        .timeSignature(3, 4),
    );
    expect(line).toBe('e|-1-|------|');
  });
});

describe('rows around the strings', () => {
  it('writes palm mute and let ring runs below, palm mute winning a clash', () => {
    const builder = guitar()
      .bar()
      .beat('4', [note(1, 1, { palmMute: true })])
      .beat('4', [note(1, 2, { palmMute: true })])
      .beat('4', [note(1, 3, { letRing: true })])
      .beat('4', [note(1, 4, { palmMute: true, letRing: true })]);
    const { text, dropped } = tab(builder);
    expect(text).toContain('\n   PM--- LR PM\n');
    expect(dropped).toEqual([expect.objectContaining({ code: 'effect-clash', severity: 'info' })]);
  });

  it('puts the bar number, section, a time and tempo change and a volta on the annotation row', () => {
    const builder = guitar()
      .bar()
      .section('Intro')
      .beat('4', [note(1, 1)])
      .bar()
      .timeSignature(3, 4)
      .tempo(90)
      .volta([1, 2])
      .beat('4', [note(1, 2)]);
    expect(linesOf(builder)[2]).toBe('  1 [Intro] 3/4 90bpm 1,2.');
  });

  it('writes jumps and targets as words', () => {
    const builder = guitar()
      .bar()
      .target('segno')
      .beat('4', [note(1, 1)])
      .bar()
      .jump('dsAlCoda')
      .beat('4', [note(1, 2)]);
    expect(linesOf(builder)[2]).toContain('Segno');
    expect(linesOf(builder)[2]).toContain('D.S. al Coda');
  });

  it('writes a chord name, beat text and lyric line 1, widening the beat for them', () => {
    const lines = linesOf(
      guitar()
        .bar()
        .beat('4', [note(1, 1)], {
          chord: { name: 'Cmaj7' },
          text: 'riff',
          lyrics: ['long-word', 'two'],
        })
        .beat('4', [note(1, 2)]),
    );
    expect(lines[2]).toBe('   Cmaj7');
    expect(lines[3]).toBe('   riff');
    expect(lines[5]).toBe('e|-1---------2-|');
    expect(lines.at(-1)).toBe('   long-word');
  });
});

describe('bar lines and repeats', () => {
  const repeat = (strings: 4 | 6 | 7) =>
    scoreBuilder()
      .track(
        strings === 4 ? 'bass' : 'guitar',
        strings === 7 ? { tuning: [35, 40, 45, 50, 55, 59, 64] } : {},
      )
      .bar()
      .repeatStart()
      .beat('4', [note(1, 1)])
      .bar()
      .repeatEnd(3)
      .beat('4', [note(1, 2)]);

  it.each([
    [6, [1, 4]],
    [7, [1, 5]],
    [4, [1, 2]],
  ] as const)(
    'puts the repeat stars on the second and second-to-last of %d strings',
    (strings, starred) => {
      const lines = linesOf(repeat(strings));
      const stringLines = lines.filter((line) => /^[A-Ga-g][#b ]?\|/.test(line));
      expect(stringLines).toHaveLength(strings);
      stringLines.forEach((line, index) => {
        expect(line.includes('*')).toBe(new Set<number>(starred).has(index));
        expect(line).toContain('||');
      });
      expect(lines).toContain('Legend: * repeat');
    },
  );

  it('puts x3 above the repeat end and a double bar as ||', () => {
    const lines = linesOf(repeat(6));
    expect(lines[2]).toMatch(/x3$/);
    const doubled = linesOf(
      guitar()
        .bar()
        .beat('4', [note(1, 1)])
        .bar()
        .beat('4', [note(1, 2)])
        .masterBar({ doubleBar: true }),
    );
    expect(doubled.find((line) => line.startsWith('e|'))).toBe('e|-1-|-2-||');
  });
});

describe('line breaking and ranges', () => {
  const long = (bars: number, bpm = 120): ScoreBuilder => {
    const builder = scoreBuilder().tempo(bpm).track('guitar');
    for (let i = 0; i < bars; i++) {
      builder
        .bar()
        .beat('4', [note(1, 1)])
        .beat('4', [note(2, 2)])
        .beat('4', [note(3, 3)])
        .beat('4', [note(4, 4)]);
    }
    return builder;
  };

  it.each([40, 80])('wraps whole bars at width %d', (width) => {
    const lines = linesOf(long(9), { width });
    const strings = lines.filter((line) => /^e\|/.test(line));
    expect(strings.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(width);
    for (const line of strings) expect(line.endsWith('|')).toBe(true);
    expect(lines.join('\n')).not.toMatch(/ $/m);
  });

  it('puts a bar wider than the width alone on its line', () => {
    const builder = guitar().bar();
    for (let i = 0; i < 16; i++) builder.beat('16', [note(1, 10 + (i % 10))]);
    builder.bar().beat('4', [note(1, 1)]);
    const lines = linesOf(builder, { width: 40 });
    const strings = lines.filter((line) => /^e\|/.test(line));
    expect(strings).toHaveLength(2);
    expect(strings[0]?.length).toBeGreaterThan(40);
  });

  it('writes only the bars asked for, numbered as in the song, with time and tempo stated', () => {
    const lines = linesOf(long(4, 100), { bars: { start: 2, end: 4 } });
    expect(lines[0]).toContain('100 bpm');
    expect(lines[2]).toBe('  3 4/4 100bpm');
    expect(lines.filter((line) => /^e\|/.test(line))).toHaveLength(1);
  });

  it('rejects a bad width, bar range or track', () => {
    const builder = long(2);
    expect(() => tab(builder, { width: 39 })).toThrow(RangeError);
    expect(() => tab(builder, { width: 401 })).toThrow(RangeError);
    expect(() => tab(builder, { bars: { start: 1, end: 1 } })).toThrow(RangeError);
    expect(() => tab(builder, { bars: { start: 0, end: 3 } })).toThrow(RangeError);
    const built = builder.build({ validate: false });
    expect(() => writeAsciiTab(built, { tracks: [] })).toThrow(RangeError);
    expect(() => writeAsciiTab(built, { tracks: ['nope'] })).toThrow(RangeError);
  });
});

describe('string labels and the header', () => {
  const labels = (tuning: number[], instrument: 'guitar' | 'bass' = 'guitar'): string[] =>
    linesOf(
      scoreBuilder()
        .track(instrument, { tuning })
        .bar()
        .beat('4', [note(1, 1)]),
    )
      .filter((line) => line.includes('|') && !line.includes(' | '))
      .map((line) => line.slice(0, line.indexOf('|')));

  it('names standard tuning with a lowercase e on top', () => {
    expect(labels([40, 45, 50, 55, 59, 64])).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
  });

  it('names drop D, E flat standard, a 7-string and a bass', () => {
    expect(labels([38, 45, 50, 55, 59, 64])).toEqual(['E', 'B', 'G', 'D', 'A', 'D']);
    expect(labels([39, 44, 49, 54, 58, 63])).toEqual(['eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb']);
    expect(labels([35, 40, 45, 50, 55, 59, 64])).toEqual(['e', 'B', 'G', 'D', 'A', 'E', 'B']);
    expect(labels([28, 33, 38, 43], 'bass')).toEqual(['G', 'D', 'A', 'E']);
  });

  it('writes the title, artist, track name, tuning, capo and tempo', () => {
    const lines = linesOf(
      scoreBuilder()
        .title('Song')
        .artist('Band')
        .tempo(132)
        .track('guitar', { name: 'Lead', capo: 2 })
        .bar()
        .beat('4', [note(1, 1)]),
    );
    expect(lines.slice(0, 2)).toEqual([
      'Song - Band',
      'Lead | Tuning: E A D G B E | Capo 2 | 132 bpm',
    ]);
  });

  it('writes one block per track, each with its own header', () => {
    const lines = linesOf(
      scoreBuilder()
        .track('guitar', { name: 'One' })
        .bar()
        .beat('4', [note(1, 1)])
        .track('bass')
        .bar()
        .beat('4', [note(1, 1)]),
    );
    expect(lines.filter((line) => line.includes(' | Tuning: '))).toEqual([
      'One | Tuning: E A D G B E | 120 bpm',
      'Bass | Tuning: E A D G | 120 bpm',
    ]);
  });
});

describe('tracks without strings', () => {
  const drumsAndGuitar = (): ScoreBuilder =>
    scoreBuilder()
      .track('drums')
      .bar()
      .beat('4', [midi(38)])
      .track('guitar')
      .bar()
      .beat('4', [note(1, 1)]);

  it('refuses a drum track on its own', () => {
    const built = scoreBuilder()
      .track('drums', { name: 'Kit' })
      .bar()
      .beat('4', [midi(38)])
      .build({ validate: false });
    const call = () => writeAsciiTab(built, { tracks: built.tracks.map((track) => track.id) });
    expect(call).toThrow(FormatError);
    expect(call).toThrow(/Kit/);
    expect(call).toThrow(expect.objectContaining({ code: 'unsupported-track' }));
  });

  it('refuses a pitched track on its own', () => {
    const built = scoreBuilder()
      .track('piano')
      .bar()
      .beat('4', [midi(60)])
      .build({ validate: false });
    expect(() => writeAsciiTab(built, { tracks: built.tracks.map((track) => track.id) })).toThrow(
      expect.objectContaining({ code: 'unsupported-track' }),
    );
  });

  it('skips a drum track among others and reports it', () => {
    const { text, dropped } = tab(drumsAndGuitar());
    expect(text.match(/Tuning:/g)).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ code: 'track-skipped', location: { track: 0 } });
  });
});

describe('what the text leaves out', () => {
  it('reports every loss once by code, with its count and first location', () => {
    const whammy: Whammy = {
      kind: 'dive',
      points: [
        { position: 0, value: 0 },
        { position: 60, value: -4 },
      ],
    };
    const builder = guitar()
      .bar()
      .beat('4', [note(1, 1)], { grace: [{ duration: 16, before: true, notes: [note(1, 3)] }] })
      .beat('4', [note(1, 1)], {
        grace: [{ duration: 16, before: true, notes: [note(1, 3)] }],
        effects: { whammy },
      })
      .beat('4', [note(1, 1)], { effects: { tremoloPicking: 16 } })
      .beat('4', [note(1, 1)], { effects: { brush: { direction: 'down' } } })
      .beat('4', [note(1, 1)], { lyrics: ['a', 'b', 'c'] })
      .voice(1)
      .beat('4', [note(2, 2)]);
    const { dropped } = tab(builder);
    expect(dropped.map((warning) => [warning.code, warning.count ?? 1])).toEqual([
      ['other-voices', 1],
      ['grace-notes', 2],
      ['whammy', 1],
      ['tremolo-picking', 1],
      ['stroke', 1],
      ['lyrics-lines', 1],
    ]);
    const grace = dropped.find((warning) => warning.code === 'grace-notes');
    expect(grace).toMatchObject({
      severity: 'info',
      count: 2,
      location: {
        track: 0,
        bar: 0,
        voice: 0,
        beat: 0,
        path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0],
      },
    });
  });

  it('prints a legend of only the symbols used, and none when there are none', () => {
    const plain = linesOf(
      guitar()
        .bar()
        .beat('4', [note(1, 1)]),
    );
    expect(plain.some((line) => line.startsWith('Legend'))).toBe(false);
    const lines = linesOf(
      guitar()
        .bar()
        .beat('4', [note(1, 1, { dead: true })])
        .beat('4', [note(1, 2, { vibrato: 'slight' })]),
    );
    expect(lines.at(-1)).toBe('Legend: ~ vibrato, x dead note');
  });
});
