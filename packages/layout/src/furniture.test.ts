import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, STAFF_SPACE, layout, type LayoutOptions, type LayoutResult } from './index';
import { expectValid } from './test/check-result';
import { describe as summarise, describePrimitive } from './test/describe';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function laid(
  built: ReturnType<ReturnType<typeof score>['build']>,
  options: Partial<LayoutOptions> = {},
): LayoutResult {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  return result;
}

function glyphs(result: LayoutResult): string[] {
  return result.primitives.flatMap((primitive) =>
    primitive.kind === 'glyph' ? [primitive.glyph] : [],
  );
}

function texts(result: LayoutResult): string[] {
  return result.primitives.flatMap((primitive) =>
    primitive.kind === 'text' ? [primitive.text] : [],
  );
}

describe('staff furniture', () => {
  it('draws the clef of each staff type, with the octave mark a fretted track is written at', () => {
    const built = score()
      .track('guitar', { id: 'guitar000001', display: { notation: 'standard', octaveShift: 1 } })
      .bar()
      .track('bass', {
        id: 'bass00000001',
        display: { notation: 'standard', clef: 'bass', octaveShift: 1 },
      })
      .bar()
      .track('piano', {
        id: 'alto00000001',
        display: { notation: 'standard', clef: 'alto', octaveShift: 0 },
      })
      .bar()
      .track('piano', {
        id: 'tenor0000001',
        display: { notation: 'standard', clef: 'tenor', octaveShift: 0 },
      })
      .bar()
      .track('piano', { id: 'piano0000001', display: { notation: 'standard', octaveShift: 0 } })
      .bar()
      .track('drums', { id: 'drums0000001' })
      .bar()
      .track('guitar', { id: 'tab000000001' })
      .bar()
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphs(result).filter((name) => /Clef/.test(name))).toEqual([
      'gClef8vb',
      'fClef8vb',
      'cClef',
      'cClef',
      'gClef',
      'unpitchedPercussionClef1',
      '6stringTabClef',
    ]);
    expect(summarise(result)).toMatchSnapshot();
  });

  it('draws key signatures on standard staves only, by the clef', () => {
    const built = score()
      .key(3)
      .track('guitar', { display: { notation: 'both', octaveShift: 1 } })
      .bar()
      .beat('1', [note(1, 0)])
      .bar()
      .key(-4)
      .beat('1', [note(1, 0)])
      .track('piano', { display: { notation: 'standard', clef: 'bass', octaveShift: 0 } })
      .bar()
      .build({ ids: 'sequential' });
    const result = laid(built);
    const accidentals = result.primitives.flatMap((primitive) =>
      primitive.kind === 'glyph' &&
      primitive.glyph.startsWith('accidental') &&
      primitive.node?.startsWith('mbar')
        ? [primitive.glyph]
        : [],
    );
    const change = [
      ...Array.from({ length: 3 }, () => 'accidentalNatural'),
      ...Array.from({ length: 4 }, () => 'accidentalFlat'),
    ];
    expect(accidentals).toEqual([
      ...Array.from({ length: 6 }, () => 'accidentalSharp'),
      ...change,
      ...change,
    ]);
    expect(summarise(result)).toMatchSnapshot();
  });

  it('draws time signatures at the start and where they change, on every staff', () => {
    const built = score()
      .track('guitar', { display: { notation: 'both', octaveShift: 1 } })
      .bar()
      .bar()
      .timeSignature(7, 8)
      .bar()
      .timeSignature(12, 8)
      .bar()
      .timeSignature(12, 8)
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphs(result).filter((name) => name.startsWith('timeSig'))).toEqual(
      ['4', '4', '4', '4', '7', '8', '7', '8', '1', '2', '8', '1', '2', '8'].map(
        (digit) => `timeSig${digit}`,
      ),
    );
    expect(summarise(result)).toMatchSnapshot();
  });

  it('draws single, double, repeat and final bar lines, with a play count past two', () => {
    const built = score()
      .track('guitar')
      .bar()
      .bar()
      .masterBar({ doubleBar: true })
      .bar()
      .repeatStart()
      .bar()
      .repeatEnd(3)
      .bar()
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphs(result).filter((name) => name === 'repeatDot')).toHaveLength(4);
    expect(texts(result)).toContain('x3');
    expect(summarise(result)).toMatchSnapshot();
  });

  it('draws clef changes inside a system smaller, on standard staves', () => {
    const built = score()
      .track('piano')
      .bar()
      .bar({ clef: 'bass' })
      .bar()
      .bar({ clef: 'treble' })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const clefs = result.primitives.flatMap((primitive) =>
      primitive.kind === 'glyph' && /Clef/.test(primitive.glyph)
        ? [`${primitive.glyph} ${String(primitive.size)}`]
        : [],
    );
    expect(clefs).toEqual(['gClef 28', 'fClef 21', 'gClef 21']);
    expect(summarise(result).primitives.filter((line) => /Clef/.test(line))).toMatchSnapshot();
  });

  it('stacks the standard staff above the tab for a track shown in both', () => {
    const built = score()
      .track('guitar', { id: 'guitar000001' })
      .bar()
      .build({ ids: 'sequential' });
    const result = laid(built, { notation: { guitar000001: 'both' } });
    const [standard, tab] = result.systems[0]?.staves ?? [];
    expect(standard?.type).toBe('standard');
    expect(tab?.type).toBe('tab');
    expect((tab?.top ?? 0) - (standard?.bottom ?? 0)).toBeGreaterThan(0);
    expect(summarise(result).systems).toMatchSnapshot();
  });
});

describe('master-bar markings', () => {
  it('draws tempo marks as a note value and the number against it', () => {
    const built = score()
      .tempo(96)
      .track('guitar')
      .bar()
      .bar()
      .masterBar({ tempo: { bpm: 120, unit: 'dottedQuarter', label: 'Faster' } })
      .bar()
      .masterBar({ tempo: { bpm: 60, unit: 'eighth' } })
      .bar()
      .masterBar({ tempo: { bpm: 140, unit: 'half' } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(
      texts(result).filter((content) => content.startsWith('=') || content === 'Faster'),
    ).toEqual(['= 96', 'Faster', '= 80', '= 120', '= 70']);
    expect(glyphs(result).filter((name) => name.startsWith('met'))).toEqual([
      'metNoteQuarterUp',
      'metNoteQuarterUp',
      'metAugmentationDot',
      'metNote8thUp',
      'metNoteHalfUp',
    ]);
    expect(summarise(result)).toMatchSnapshot();
  });

  it('draws section markers as a boxed letter and name', () => {
    const built = score()
      .track('guitar')
      .bar()
      .section('Intro', { letter: 'A' })
      .bar()
      .section('Verse')
      .build({ ids: 'sequential' });
    const result = laid(built);
    const lines = summarise(result).primitives.filter(
      (line) => line.startsWith('path') || /"(A|Intro|Verse)"/.test(line),
    );
    expect(lines).toMatchSnapshot();
    expect(texts(result)).toEqual(expect.arrayContaining(['A', 'Intro', 'Verse']));
  });

  it('draws alternate-ending brackets over each run of bars, closed where they repeat', () => {
    const built = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .bar()
      .volta([1, 2])
      .bar()
      .volta([1, 2])
      .repeatEnd(3)
      .bar()
      .volta([3])
      .bar()
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result)).toEqual(expect.arrayContaining(['1., 2.', '3.']));
    const brackets = summarise(result).primitives.filter((line) =>
      line.startsWith('path stroked M'),
    );
    expect(brackets).toHaveLength(2);
    expect(brackets).toMatchSnapshot();
  });

  it('continues a bracket across a system break without a second label', () => {
    const builder = score().track('guitar').bar().repeatStart();
    for (let b = 0; b < 8; b++) {
      builder.bar().volta([1]);
      for (let i = 0; i < 8; i++) builder.beat('8', [note(1, i)]);
    }
    builder.repeatEnd();
    const result = laid(builder.build({ ids: 'sequential' }));
    expect(result.systems.length).toBeGreaterThan(1);
    expect(texts(result).filter((content) => content === '1.')).toHaveLength(1);
    const brackets = result.primitives.filter(
      (primitive) => primitive.kind === 'path' && !primitive.fill,
    );
    expect(brackets.length).toBe(result.systems.length);
    expect({
      brackets: brackets.map(describePrimitive),
      labels: summarise(result).primitives.filter((line) => line.includes('"1."')),
    }).toMatchSnapshot();
  });

  it('draws jumps as words at the bar end and targets as symbols at its start', () => {
    const built = score()
      .track('guitar')
      .bar()
      .target('segno')
      .bar()
      .target('segnoSegno')
      .jump('toCoda')
      .bar()
      .target('fine')
      .jump('dsAlCoda')
      .bar()
      .target('coda')
      .bar()
      .target('doubleCoda')
      .jump('dssAlDoubleCoda')
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphs(result).filter((name) => name === 'segno' || name === 'coda')).toEqual([
      'segno',
      'segno',
      'segno',
      'coda',
      'coda',
      'coda',
    ]);
    expect(texts(result)).toEqual(
      expect.arrayContaining(['To Coda', 'Fine   D.S. al Coda', 'D.S.S. al Double Coda']),
    );
    expect(
      summarise(result).primitives.filter((line) => /segno|coda|Coda|Fine/.test(line)),
    ).toMatchSnapshot();
  });

  it('writes full track names on the first system and short names after', () => {
    const builder = score()
      .track('guitar', { name: 'Lead Guitar', shortName: 'L.Gt.' })
      .bar()
      .bar()
      .bar()
      .bar()
      .track('bass', { name: 'Bass', shortName: 'Bs.' })
      .bar()
      .bar()
      .bar()
      .bar();
    const result = laid(builder.build({ ids: 'sequential' }), { width: 300 });
    expect(result.systems.length).toBeGreaterThan(1);
    const names = (index: number) => {
      const system = result.systems[index];
      if (!system) return [];
      return texts({
        ...result,
        primitives: result.primitives.slice(system.primitives.start, system.primitives.end),
      });
    };
    expect(names(0).slice(0, 2)).toEqual(['Lead Guitar', 'Bass']);
    expect(names(1).slice(0, 2)).toEqual(['L.Gt.', 'Bs.']);
    expect(
      summarise(result).primitives.filter((line) => /Lead Guitar|L\.Gt\.|Bass|Bs\./.test(line)),
    ).toMatchSnapshot();
  });

  it('cuts a track name longer than its share of the line with an ellipsis', () => {
    const long = 'A track name far too long for any narrow page at all';
    const result = laid(score().track('guitar', { name: long }).bar().build(), { width: 300 });
    const name = result.primitives.find(
      (primitive) => primitive.kind === 'text' && long.startsWith(primitive.text.slice(0, -1)),
    );
    const clef = result.primitives.find(
      (primitive) => primitive.kind === 'glyph' && primitive.glyph.includes('Clef'),
    );
    expect(name?.kind === 'text' && name.text.endsWith('…')).toBe(true);
    expect((name?.bbox.x ?? 0) + (name?.bbox.width ?? Infinity)).toBeLessThanOrEqual(
      (clef?.bbox.x ?? 0) - STAFF_SPACE * 1.5 + 0.02,
    );
  });
});

describe('spacing', () => {
  it('spaces an anacrusis by what it holds rather than its time signature', () => {
    const built = score()
      .track('guitar')
      .bar()
      .anacrusis()
      .beat('4', [note(1, 0)])
      .bar()
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const [pickup, full] = result.anchors.filter(
      (anchor) => anchor.kind === 'bar' && anchor.track === undefined,
    );
    const first = result.anchors.find((anchor) => anchor.kind === 'beat');
    expect(pickup && first && pickup.bbox.x + pickup.bbox.width - first.bbox.x).toBeLessThan(
      (full?.bbox.width ?? 0) / 2,
    );
  });

  it('aligns onsets across tracks and voices', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 0)])
      .voice(1)
      .beat('4', [note(2, 0)])
      .beat('4', [note(2, 0)])
      .beat('2', [note(2, 0)])
      .track('drums')
      .bar()
      .beat('8', [midi(36)])
      .beat('8', [midi(36)])
      .beat('4', [midi(38)])
      .beat('2', [midi(36)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const xs = (voice: number, staff: string) =>
      result.anchors
        .filter(
          (anchor) => anchor.kind === 'beat' && anchor.voice === voice && anchor.staff === staff,
        )
        .map((anchor) => anchor.bbox.x + anchor.bbox.width / 2);
    const [half1, half2] = xs(0, 'tab');
    const [q1, q2, q3] = xs(1, 'tab');
    const drums = xs(0, 'percussion');
    expect(q1).toBeCloseTo(half1 ?? 0, 1);
    expect(q3).toBeCloseTo(half2 ?? 0, 1);
    expect(drums[0]).toBeCloseTo(half1 ?? 0, 1);
    expect(drums[2]).toBeCloseTo(q2 ?? 0, 1);
    expect(drums[3]).toBeCloseTo(half2 ?? 0, 1);
  });

  it('describes every primitive kind in one line', () => {
    const built = score().track('guitar').bar().section('A').build({ ids: 'sequential' });
    const kinds = new Set(
      layout(built, paged).primitives.map(
        (primitive) => describePrimitive(primitive).split(' ')[0],
      ),
    );
    expect([...kinds].sort()).toEqual(['glyph', 'line', 'path', 'text']);
  });
});

describe('header markings in a squeezed bar', () => {
  it('cut a tempo label and a section name to their bar, keeping the metronome mark', () => {
    const long = 'A tempo label and section name far too long for the line';
    const builder = score().track('guitar').bar().section(long).tempo(96, { label: long });
    for (let i = 0; i < 64; i++) builder.beat('64', [note((i % 6) + 1, 12)]);
    const result = laid(builder.build(), { width: 416 });
    const bar = result.anchors.find((anchor) => anchor.kind === 'bar');
    const cut = result.primitives.filter(
      (primitive) => primitive.kind === 'text' && primitive.text.endsWith('…'),
    );
    expect(cut).toHaveLength(2);
    for (const primitive of cut) {
      expect(primitive.bbox.x + primitive.bbox.width).toBeLessThanOrEqual(
        (bar?.bbox.x ?? 0) + (bar?.bbox.width ?? 0),
      );
    }
    expect(glyphs(result)).toContain('metNoteQuarterUp');
    expect(texts(result)).toContain('= 96');
  });
});
