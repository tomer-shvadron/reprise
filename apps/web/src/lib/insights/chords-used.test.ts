import { describe, expect, it } from 'vitest';

import { chordsUsed, loopOf, progressionOf } from './chords-used';
import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { chord, repeat, song, type SongBar } from './test/songs';

const A = 9;
const NEUTRAL = { fifths: 0, minor: false };

/** Am F C G, the chord names written above the bars. */
const loop = (section?: string): SongBar[] =>
  [
    { chord: chord(A, true), name: 'Am' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
    { chord: chord(7), name: 'G' },
  ].map((bar, index) => (index === 0 && section ? { ...bar, section } : bar));

function used(bars: SongBar[], options = {}) {
  const built = song(bars, options);
  return chordsUsed(noteTableOf(built), songOutline(built), NEUTRAL);
}

describe('written chords', () => {
  it('lists the names the file writes with their counts and shares, as standard names', () => {
    const result = used([...repeat(loop(), 3), { chord: chord(A, true), name: 'Am' }]);
    expect(result.source).toBe('written');
    expect(result.chords.map(({ name, count }) => [name, count])).toEqual([
      ['Am', 4],
      ['C', 3],
      ['F', 3],
      ['G', 3],
    ]);
    expect(result.chords.reduce((sum, chord) => sum + chord.share, 0)).toBeCloseTo(1);
    expect(result.chords[0]?.share).toBeCloseTo(4 / 13);
  });

  it('finds the loop and writes it as chord names, never numerals', () => {
    const [progression] = used(repeat(loop(), 4)).progressions;
    expect(progression?.label).toBe('Am–F–C–G ×4');
    expect(progression?.loop).toEqual({
      chords: ['Am', 'F', 'C', 'G'],
      times: 4,
      partial: false,
      fills: 0,
    });
  });

  it('reads a progression per section', () => {
    const verse = [...loop('Verse'), ...loop()];
    const chorus = Array.from({ length: 6 }, (_, i): SongBar => {
      const bar = i % 2 === 0 ? { chord: chord(5), name: 'F' } : { chord: chord(7), name: 'G' };
      return i === 0 ? { ...bar, section: 'Chorus' } : bar;
    });
    const result = used([...verse, ...chorus]);
    expect(result.progressions.map(({ section, label }) => [section, label])).toEqual([
      ['Verse', 'Am–F–C–G ×2'],
      ['Chorus', 'F–G ×3'],
    ]);
  });

  it('counts a chord held over several bars once and weighs it by time', () => {
    const result = used([
      { chord: chord(0), name: 'C' },
      { chord: chord(0), name: 'C' },
      { chord: chord(7), name: 'G' },
      { chord: chord(5), name: 'F' },
      { chord: chord(0), name: 'C' },
    ]);
    expect(result.source).toBe('written');
    expect(result.chords.find((c) => c.name === 'C')).toMatchObject({ count: 2 });
    expect(result.chords[0]?.name).toBe('C');
  });
});

describe('inferred chords', () => {
  it('reads chords from the notes when the file names fewer than four', () => {
    const bars = repeat(loop(), 2).map(({ chord: voicing }) => ({ chord: voicing }));
    const result = used(bars);
    expect(result.source).toBe('inferred');
    expect(result.chords.map(({ name }) => name).sort()).toEqual(['Am', 'C', 'F', 'G']);
    expect(result.progressions[0]?.label).toBe('Am–F–C–G ×2');
  });

  it('never infers from an arpeggio', () => {
    const bars = repeat(loop(), 2).map(({ chord: voicing }) => ({ chord: voicing }));
    const result = used(bars, { arpeggiate: true });
    expect(result).toEqual({ source: 'none', chords: [], progressions: [] });
  });

  it('prefers the written names once there are four', () => {
    expect(used(repeat(loop(), 2)).source).toBe('written');
  });

  it('keeps the few names a file writes when the notes give no chord', () => {
    const bars = [{ chord: chord(0), name: 'C' }];
    const built = song(bars, { arpeggiate: true });
    const result = chordsUsed(noteTableOf(built), songOutline(built), NEUTRAL);
    expect(result.source).toBe('written');
    expect(result.chords).toHaveLength(1);
  });

  it('reads only the track with the most chord beats', () => {
    const built = song(
      repeat(loop(), 2).map(({ chord: voicing }) => ({
        chord: voicing,
        melody: [72, 76, 79, 76, 72, 76, 79, 76],
      })),
    );
    const result = chordsUsed(noteTableOf(built), songOutline(built), NEUTRAL);
    expect(result.chords.map(({ name }) => name).sort()).toEqual(['Am', 'C', 'F', 'G']);
  });

  it('marks nothing for a song with no chords at all', () => {
    expect(used([{ chord: [60] }]).source).toBe('none');
  });
});

describe('loopOf', () => {
  it('takes the shortest period that tiles at least twice, allowing a short tail', () => {
    expect(loopOf(['A', 'B', 'A', 'B', 'A', 'B'])).toEqual({
      chords: ['A', 'B'],
      times: 3,
      partial: false,
      fills: 0,
    });
    expect(loopOf(['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B'])).toEqual({
      chords: ['A', 'B', 'C'],
      times: 2,
      partial: true,
      fills: 0,
    });
  });

  it('finds none in a sequence that does not repeat, or is a single chord', () => {
    expect(loopOf(['A', 'B', 'C', 'D'])).toBeUndefined();
    expect(loopOf(['A'])).toBeUndefined();
    expect(loopOf(['A', 'B', 'A', 'C'])).toBeUndefined();
  });

  it('tolerates one fill, an extra bar or a pickup, and says so', () => {
    const loop = ['Am', 'F', 'C', 'G'];
    const times = (n: number) => Array.from({ length: n }, () => loop).flat();
    // a substituted chord, an inserted bar, a pickup
    const substituted = times(4).map((name, i) => (i === 6 ? 'E' : name));
    const inserted = [...times(3), 'E', ...times(1)];
    const pickup = ['E', ...times(4)];
    for (const names of [substituted, inserted, pickup]) {
      expect(loopOf(names)).toMatchObject({
        chords: loop,
        times: names.length >= 17 ? 4 : 4,
        fills: 1,
      });
    }
    expect(progressionOf(pickup).label).toBe('Am–F–C–G ×4');
  });

  it('does not take a short sequence with a stray chord for a loop', () => {
    expect(loopOf(['A', 'B', 'A', 'C'])).toBeUndefined();
    expect(loopOf(['A', 'B', 'A', 'C', 'A', 'B'])).toBeUndefined();
  });

  it('shows a loop that ends on its own first chord with that chord', () => {
    // Am–F–G–Am repeated, with the repeated Am merged into one.
    expect(progressionOf(['Am', 'F', 'G', 'Am', 'F', 'G', 'Am']).label).toBe('Am–F–G–Am ×2');
  });

  it('does not look for a loop longer than eight chords', () => {
    const nine = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A#', 'B#'];
    expect(loopOf([...nine, ...nine])).toBeUndefined();
  });
});

describe('progressionOf', () => {
  it('shows the first twelve changes and an ellipsis when there is no loop', () => {
    const names = Array.from({ length: 14 }, (_, i) => `C${String(i)}`);
    const progression = progressionOf(names, 'Bridge');
    expect(progression.chords).toHaveLength(12);
    expect(progression.label.endsWith('…')).toBe(true);
    expect(progression.section).toBe('Bridge');
  });

  it('marks a partial last repeat', () => {
    expect(progressionOf(['A', 'B', 'A', 'B', 'A']).label).toBe('A–B ×2+');
  });
});

describe('chords by section', () => {
  const chorusBars = (names: [string, number[]][], section: string): SongBar[] =>
    names.map(([name, voicing], index) => ({
      chord: voicing,
      name,
      ...(index === 0 ? { section } : {}),
    }));
  const F = chord(5);
  const Cc = chord(0);
  const G = chord(7);

  it('keeps a section that opens on the chord the last one ended on', () => {
    // Verse C–G–Am–F twice, then Chorus F–C–G–C twice: the chorus starts on the verse's last chord.
    const verse = [...loop('Verse'), ...loop()].map((bar) => bar);
    const named = (n: string, v: number[]) => [n, v] as [string, number[]];
    const verseBars = [chord(0), chord(7), chord(9, true), F]
      .flatMap((v, i) => [[['C', 'G', 'Am', 'F'][i] ?? '', v] as [string, number[]]])
      .concat([named('C', chord(0)), named('G', G), named('Am', chord(9, true)), named('F', F)]);
    const chorus = chorusBars(
      [
        named('F', F),
        named('C', Cc),
        named('G', G),
        named('C', Cc),
        named('F', F),
        named('C', Cc),
        named('G', G),
        named('C', Cc),
      ],
      'Chorus',
    );
    expect(verse.length).toBeGreaterThan(0);
    const result = used([...chorusBars(verseBars, 'Verse'), ...chorus]);
    expect(result.progressions.map(({ section, label }) => [section, label])).toEqual([
      ['Verse', 'C–G–Am–F ×2'],
      ['Chorus', 'F–C–G–C ×2'],
    ]);
  });

  it('starts a section on the chord held over from the one before it', () => {
    const bars: SongBar[] = [
      { chord: Cc, name: 'C', section: 'A' },
      { chord: G, name: 'G' },
      { chord: Cc, name: 'C' },
      { chord: G, name: 'G' },
      { chord: G, section: 'B' },
      { chord: F, name: 'F' },
      { chord: Cc, name: 'C' },
      { chord: G, name: 'G' },
      { chord: chord(9, true), name: 'Am' },
    ];
    const result = used(bars);
    expect(result.progressions.map(({ section, chords }) => [section, chords.join('')])).toEqual([
      ['A', 'CGCG'],
      ['B', 'GFCGAm'],
    ]);
  });

  it('weighs a chord only to the end of its section, and infers where a section names fewer than four', () => {
    // Four names over an intro, then 8 bars with none: the intro is written, the rest inferred.
    const intro = loop('Intro');
    const rest: SongBar[] = [
      ...[chord(A, true), F, Cc, G].map((voicing, i) => ({
        chord: voicing,
        ...(i === 0 ? { section: 'Verse' } : {}),
      })),
      ...[chord(A, true), F, Cc, G].map((voicing) => ({ chord: voicing })),
    ];
    const result = used([...intro, ...rest]);
    expect(result.source).toBe('mixed');
    expect(result.progressions.map(({ section, source }) => [section, source])).toEqual([
      ['Intro', 'written'],
      ['Verse', 'inferred'],
    ]);
    const shares = Object.fromEntries(result.chords.map((chord) => [chord.name, chord.share]));
    // Each chord holds about a quarter of the time; none of them 90%.
    for (const name of ['Am', 'F', 'C', 'G']) expect(shares[name]).toBeGreaterThan(0.2);
    expect(result.chords.every((chord) => !chord.inferred)).toBe(true);
  });

  it('does not let a chord outlast the track that wrote it', () => {
    // Names only in an intro of a song with no sections; the guitar then plays 36 more bars unnamed.
    const bars = [...loop(), ...Array.from({ length: 36 }, () => ({ chord: chord(A, true) }))];
    const result = used(bars);
    // The four names do not reach the end of the song, so the notes are read instead.
    expect(result.source).toBe('inferred');
    const g = result.chords.find((chord) => chord.name === 'G');
    expect(g?.share ?? 1).toBeLessThan(0.5);
  });
});
