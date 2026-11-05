import type { Score } from '@reprise/model';
import { fullScore, largeScore, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZES,
  STAFF_SPACE,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from '../../index';
import type { LayoutSink } from '../../primitives';
import { expectValid, overlappingAnchors } from '../../test/check-result';
import { describeAnchor, describePrimitive } from '../../test/describe';
import type { StaffBar } from '../staff-module';
import { tabModule } from './index';
import { feelWidth } from './spacing';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function laid(built: Score, options: Partial<LayoutOptions> = {}): LayoutResult {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  return result;
}

/** What the tab module drew: primitives of beats and notes, and their anchors. */
function content(result: LayoutResult): { primitives: string[]; anchors: string[] } {
  const ours = (node: string | undefined): boolean =>
    node !== undefined && (node.startsWith('beat') || node.startsWith('note'));
  return {
    primitives: result.primitives.filter((p) => ours(p.node)).map(describePrimitive),
    anchors: result.anchors
      .filter((anchor) => anchor.kind === 'note' || anchor.kind === 'beat')
      .map(describeAnchor),
  };
}

function guitar(): ScoreBuilder {
  return score().track('guitar');
}

function snapshot(builder: ScoreBuilder, options: Partial<LayoutOptions> = {}) {
  return content(laid(builder.build({ ids: 'sequential' }), options));
}

function texts(result: LayoutResult): string[] {
  return result.primitives.flatMap((p) =>
    p.kind === 'text' && p.node?.startsWith('note') ? [p.text] : [],
  );
}

describe('tab staff: strings and fret numbers', () => {
  it('draws one line per string for any string count', () => {
    for (const tuning of [
      [28, 33, 38, 43],
      [40, 45, 50, 55, 59, 64],
      [35, 40, 45, 50, 55, 59, 64],
    ]) {
      const built = score().track('guitar', { id: 'guitar000001', tuning }).bar().build();
      const result = laid(built);
      const lines = result.primitives.filter(
        (p) => p.kind === 'line' && p.node === 'guitar000001' && p.y === p.y2,
      );
      expect(lines).toHaveLength(tuning.length);
    }
  });

  it('centres fret numbers on their strings over a paper knockout, two digits included', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4', [note(1, 0), note(2, 1), note(3, 12), note(6, 24)])
          .beat('4', [note(4, 7)]),
      ),
    ).toMatchSnapshot();
  });

  it('writes dead notes as x, ghost notes and tied notes in parentheses', () => {
    const result = laid(
      guitar()
        .bar()
        .beat('4', [note(1, 5, { dead: true }), note(2, 3, { ghost: true }), note(3, 7)])
        .beat('4', [note(3, 7, { tie: true })])
        .beat('4', [note(4, 0, { dead: true, ghost: true })])
        .build({ ids: 'sequential' }),
    );
    expect(texts(result)).toEqual(['x', '(3)', '7', '(7)', '(x)']);
  });

  it('can hide tied notes and keep their tie and anchor', () => {
    const built = guitar()
      .bar()
      .beat('2', [note(3, 7)])
      .beat('2', [note(3, 7, { tie: true })])
      .build({ ids: 'sequential' });
    const track = built.tracks[0];
    const bar = track?.bars[0];
    const masterBar = built.masterBars[0];
    if (!track || !bar || !masterBar) throw new Error('fixture');
    const module = tabModule({ tiedNotes: 'hidden' });
    const space = STAFF_SPACE;
    const input: StaffBar = {
      score: built,
      track,
      trackIndex: 0,
      staves: ['tab'],
      bar,
      masterBar,
      barIndex: 0,
      clef: 'treble',
      keySignature: masterBar.keySignature,
      space,
    };
    const geometry = module.geometry(track, space);
    const sink: LayoutSink = { primitives: [], anchors: [] };
    module.render(
      input,
      {
        x: 0,
        width: 200,
        top: 0,
        bottom: geometry.lineSpacing * (geometry.lines - 1),
        geometry,
        system: 0,
        onsetX: (tick) => 10 + tick / 20,
      },
      sink,
    );
    expect(sink.primitives.flatMap((p) => (p.kind === 'text' ? [p.text] : []))).toEqual(['7']);
    expect(
      sink.primitives.filter((p) => p.kind === 'path' && p.fill && p.role === 'ink'),
    ).toHaveLength(1);
    expect(sink.anchors.filter((a) => a.kind === 'note').map((a) => a.id)).toEqual([
      'note00000001',
      'note00000002',
    ]);
  });

  it('reserves room for the fret numbers it draws', () => {
    const width = (fret: number): number => {
      const builder = guitar().bar();
      for (let i = 0; i < 8; i++) builder.beat('16', [note(1, fret)]);
      const result = laid(builder.build({ ids: 'sequential' }), { mode: 'continuous' });
      return (
        result.anchors.find((anchor) => anchor.kind === 'bar' && anchor.track === undefined)?.bbox
          .width ?? 0
      );
    };
    expect(width(12)).toBeGreaterThan(width(1));
  });
});

describe('tab staff: rests', () => {
  it('draws every rest glyph in the middle of the staff, with its dots', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .rest('1')
          .bar()
          .rest('2.')
          .rest('4')
          .bar()
          .rest('8')
          .rest('16')
          .rest('32')
          .rest('64')
          .rest('128')
          .rest('256')
          .bar()
          .rest('2..'),
      ),
    ).toMatchSnapshot();
  });
});

describe('tab staff: rhythm notation', () => {
  it('draws stems below the tab, a short one for a half and none for a whole', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('1', [note(1, 0)])
          .bar()
          .beat('2', [note(1, 0)])
          .beat('4', [note(1, 0)])
          .beat('4', [note(1, 0)]),
      ),
    ).toMatchSnapshot();
  });

  it('gives every duration from the eighth down its flag', () => {
    const builder = guitar().bar();
    for (const spec of ['8', '16', '32', '64', '128', '256'] as const)
      builder.beat(spec, [note(1, 3)]).rest('8');
    expect(snapshot(builder)).toMatchSnapshot();
  });

  it('beams by duration: one beam per halving, partial beams where a neighbour has fewer', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('8', [note(1, 1)])
          .beat('8', [note(1, 2)])
          .beat('16', [note(1, 3)])
          .beat('16', [note(1, 4)])
          .beat('16', [note(1, 5)])
          .beat('16', [note(1, 6)])
          .beat('8.', [note(1, 7)])
          .beat('16', [note(1, 8)])
          .beat('16', [note(1, 9)])
          .beat('8.', [note(1, 10)]),
      ),
    ).toMatchSnapshot();
  });

  it('lengthens stems for three beams and more', () => {
    const builder = guitar().bar();
    for (let i = 0; i < 4; i++) builder.beat('32', [note(1, i)]);
    for (let i = 0; i < 8; i++) builder.beat('64', [note(2, i)]);
    expect(snapshot(builder)).toMatchSnapshot();
  });

  it.each([
    [4, 4, 8],
    [3, 4, 6],
    [6, 8, 6],
  ] as const)('groups beams by the beat in %i/%i', (numerator, denominator, eighths) => {
    const builder = score().timeSignature(numerator, denominator).track('guitar').bar();
    for (let i = 0; i < eighths; i++) builder.beat('8', [note(2, i)]);
    const result = laid(builder.build({ ids: 'sequential' }));
    const beams = result.primitives.filter((p) => p.kind === 'path' && p.fill && p.role === 'ink');
    expect(beams.length).toBe(numerator === 4 ? 2 : numerator === 3 ? 3 : 2);
    expect(content(result)).toMatchSnapshot();
  });

  it('puts dots after the stem base, and after a rest', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4.', [note(1, 0)])
          .beat('8', [note(1, 0)])
          .bar()
          .beat('2..', [note(2, 0)])
          .rest('8')
          .bar()
          .rest('4.'),
      ),
    ).toMatchSnapshot();
  });

  it('numbers tuplets, with a bracket where no single beam holds the tuplet', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('8t', [note(1, 0)])
          .beat('8t', [note(1, 1)])
          .beat('8t', [note(1, 2)])
          .beat('4t', [note(2, 0)])
          .beat('8t', [note(2, 1)])
          .beat('16', [note(3, 0)], { tuplet: { n: 5, of: 4 } })
          .beat('16', [note(3, 1)], { tuplet: { n: 5, of: 4 } })
          .rest('16', { tuplet: { n: 5, of: 4 } })
          .beat('16', [note(3, 3)], { tuplet: { n: 5, of: 4 } })
          .beat('16', [note(3, 4)], { tuplet: { n: 5, of: 4 } })
          .beat('4', [note(4, 0)]),
      ),
    ).toMatchSnapshot();
  });

  it('draws small stemmed numbers for grace notes before the beat', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4', [note(3, 7)], {
            grace: [
              { duration: 16, before: true, notes: [note(3, 5)] },
              { duration: 32, before: false, notes: [note(3, 12)] },
            ],
          }),
      ),
    ).toMatchSnapshot();
  });
});

describe('tab staff: ties', () => {
  it('ties consecutive beats with an arc under the numbers', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('2', [note(2, 5)])
          .beat('2', [note(2, 5, { tie: true })]),
      ),
    ).toMatchSnapshot();
  });

  it('draws a tie across a bar line in one piece, and as two halves across a system break', () => {
    const builder = guitar();
    for (let b = 0; b < 12; b++) {
      builder
        .bar()
        .beat('2', [note(2, 5, { tie: b > 0 })])
        .beat('2', [note(2, 5, { tie: true })]);
    }
    const result = laid(builder.build({ ids: 'sequential' }));
    expect(result.systems.length).toBeGreaterThan(1);
    const ties = result.primitives.filter((p) => p.kind === 'path' && p.fill && p.role === 'ink');
    // 23 tied notes; each system break splits one tie into two halves.
    expect(ties).toHaveLength(23 + result.systems.length - 1);
    for (const system of result.systems.slice(1)) {
      const first = result.primitives
        .slice(system.primitives.start, system.primitives.end)
        .find((p) => p.kind === 'path' && p.fill && p.role === 'ink');
      expect(first?.node).toBeDefined();
    }
    expect(
      content(result).primitives.filter((line) => line.startsWith('path filled')),
    ).toMatchSnapshot();
  });
});

describe('tab staff: two voices', () => {
  it('stems voice 1 down below the tab and voice 2 up above it', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('8', [note(1, 0)])
          .beat('8', [note(1, 2)])
          .beat('4', [note(1, 3)])
          .rest('2')
          .voice(1)
          .beat('2', [note(5, 3)])
          .beat('4', [note(6, 0)])
          .rest('4'),
      ),
    ).toMatchSnapshot();
  });
});

describe('tab staff: words', () => {
  it('writes chord names and beat text above the staff', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4', [note(2, 1), note(3, 0)], { chord: { name: 'Am7' }, text: 'Intro riff' })
          .beat('4', [note(2, 1)], { chord: { name: 'C' } }),
      ),
    ).toMatchSnapshot();
  });

  it('writes one lyric line per line, aligned to the beat', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4', [note(1, 0)], { lyrics: ['Hel-', 'Bon-'] })
          .beat('4', [note(1, 0)], { lyrics: ['lo', ''] })
          .beat('4', [note(1, 0)], { lyrics: ['world', 'jour'] }),
      ),
    ).toMatchSnapshot();
  });

  it('stacks fingering above the staff', () => {
    expect(
      snapshot(
        guitar()
          .bar()
          .beat('4', [
            note(2, 1, { leftHandFinger: 'index' }),
            note(4, 2, { leftHandFinger: 'middle', rightHandFinger: 'thumb' }),
          ]),
      ),
    ).toMatchSnapshot();
  });

  it('writes a dynamic below where it changes, across bar lines too', () => {
    const result = laid(
      guitar()
        .bar()
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0, { dynamics: 'pp' })])
        .beat('4', [note(1, 0, { dynamics: 'pp' })])
        .bar()
        .beat('4', [note(1, 0, { dynamics: 'pp' })])
        .beat('4', [note(1, 0, { dynamics: 'mf' })])
        .bar()
        .beat('4', [note(1, 0)])
        .build({ ids: 'sequential' }),
    );
    const dynamics = result.primitives.flatMap((p) =>
      p.kind === 'glyph' && p.glyph.startsWith('dynamic') ? [`${p.glyph} <${p.node ?? ''}>`] : [],
    );
    expect(dynamics).toEqual([
      'dynamicPP <beat00000002>',
      'dynamicMF <beat00000005>',
      'dynamicForte <beat00000006>',
    ]);
  });
});

describe('tab staff: spacing', () => {
  it('widens long notes towards Guitar Pro: a 4/4 bar of a whole note is about 14 spaces', async ({
    annotate,
  }) => {
    const widths = Object.fromEntries(
      (['1', '2', '4', '8'] as const).map((spec) => {
        const builder = guitar().bar();
        for (let i = 0; i < Number(spec); i++) builder.beat(spec, [note(1, 0)]);
        const result = laid(builder.bar().build({ ids: 'sequential' }), { mode: 'continuous' });
        const bar = result.anchors.find(
          (anchor) => anchor.kind === 'bar' && anchor.id === 'mbar00000001',
        );
        return [spec, Math.round(((bar?.bbox.width ?? 0) / STAFF_SPACE) * 10) / 10];
      }),
    );
    await annotate(
      `bar widths in staff spaces (time signature included): ${JSON.stringify(widths)}`,
    );
    expect(feelWidth(3840)).toBeCloseTo(12.35, 1);
    expect(feelWidth(960)).toBe(0);
    expect(widths['1']).toBeGreaterThan(14);
  });
});

describe('tab staff: anchors', () => {
  it('gives every note an anchor that overlaps no other in its voice, on the long score', () => {
    const result = layout(largeScore(8, 300, { structure: true }), paged);
    const notes = result.anchors.filter((anchor) => anchor.kind === 'note');
    expect(notes.length).toBeGreaterThan(30000);
    expect(overlappingAnchors(result)).toEqual([]);
  });

  it('lays out the full score with every feature validly', () => {
    laid(fullScore());
  });
});
