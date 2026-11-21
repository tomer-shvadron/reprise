import { parseNative, type Beat, type Notation, type Score } from '@reprise/model';
import { score as builder, note } from '@reprise/model/testing';
import { describe, expect, inject, it } from 'vitest';

import { PAGE_SIZES, layout, markAt, type LayoutOptions, type PathPrimitive } from './index';
import { expectValid } from './test/check-result';
import { withChordDiagrams } from './test/effects';

// The package compiles against ES2022 alone, which declares no TextEncoder.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

interface ScoreFixture {
  path: string;
  native: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const grids = (result: ReturnType<typeof layout>): PathPrimitive[] =>
  result.primitives.flatMap((p) => (p.kind === 'path' && p.lane === 'chordDiagram' ? [p] : []));

function withDiagram(built: Score): Beat[] {
  return built.tracks.flatMap((track) =>
    track.bars.flatMap((bar) =>
      bar.voices.flatMap((voice) => voice.beats.filter((beat) => beat.chord?.diagram)),
    ),
  );
}

describe('chord diagrams of the fixtures', () => {
  const fixtures = inject('scoreFixtures');
  it.each(['gp5/chords.gp5', 'gpx/chords.gpx'])('%s lays out one grid per diagram', (path) => {
    const found = fixtures.find((fixture) => fixture.path.endsWith(path));
    if (!found) throw new Error(`no fixture ${path}`);
    const built = parseNative(new TextEncoder().encode(found.native)).score;
    const beats = withDiagram(built);
    expect(beats.length).toBeGreaterThan(0);
    for (const notation of ['tab', 'standard', 'both'] as const satisfies readonly Notation[]) {
      const options: LayoutOptions = {
        ...paged,
        notation: Object.fromEntries(built.tracks.map((track) => [track.id, notation])),
      };
      const result = layout(built, options);
      const off = layout(built, { ...options, chordDiagrams: false });
      expectValid(result);
      const drawn = grids(result).map((grid) => grid.node);
      expect([...drawn].sort()).toEqual(beats.map((beat) => beat.id).sort());
      expect(grids(off)).toHaveLength(0);
    }
  });
});

describe('chord diagrams in a layout', () => {
  const built = () => {
    const b = builder().track('guitar', { display: { notation: 'both', octaveShift: 1 } });
    b.bar();
    return withChordDiagrams(
      b
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .build({ ids: 'sequential' }),
    );
  };

  it('draws the grid on the tab staff, below the name and above the staff', () => {
    const result = layout(built(), paged);
    const [grid] = grids(result);
    const name = result.primitives.find((p) => p.kind === 'text' && p.lane === 'chord');
    const tab = result.systems[0]?.staves.find((staff) => staff.type === 'tab');
    const standard = result.systems[0]?.staves.find((staff) => staff.type === 'standard');
    if (!grid || !name || !tab || !standard) throw new Error('no diagram');
    // In both mode the grid belongs to the tab: between the two staves, not above the top one.
    expect(grid.bbox.y).toBeGreaterThanOrEqual(standard.bottom);
    expect(name.bbox.y + name.bbox.height).toBeLessThanOrEqual(grid.bbox.y + 0.5);
    expect(grid.bbox.y + grid.bbox.height).toBeLessThanOrEqual(tab.top);
    expect(grid.x).toBeGreaterThanOrEqual(0);
  });

  it('asks for the lane only in a system that has a diagram, and not when switched off', () => {
    const on = layout(built(), paged);
    const off = layout(built(), { ...paged, chordDiagrams: false });
    const tabOn = on.systems[0]?.staves.find((staff) => staff.type === 'tab');
    const tabOff = off.systems[0]?.staves.find((staff) => staff.type === 'tab');
    expect(on.systems[0] && grids(on).length).toBeGreaterThan(0);
    expect(grids(off)).toHaveLength(0);
    expect((tabOn?.top ?? 0) - (on.systems[0]?.bbox.y ?? 0)).toBeGreaterThan(
      (tabOff?.top ?? 0) - (off.systems[0]?.bbox.y ?? 0),
    );
  });

  it('leaves a name without a diagram bare, and a bar without chords alone', () => {
    const plain = builder()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
      .build({ ids: 'sequential' });
    expect(grids(layout(plain, paged))).toHaveLength(0);
  });

  it('pushes the next beat right of a diagram', () => {
    const wide = layout(built(), paged);
    const narrow = layout(built(), { ...paged, chordDiagrams: false });
    const xs = (result: ReturnType<typeof layout>) =>
      result.anchors.filter((a) => a.kind === 'beat').map((a) => a.bbox.x);
    // The first beat's grid is wider than its name: the second beat moves right.
    expect(xs(wide)[1] ?? 0).toBeGreaterThan(xs(narrow)[1] ?? 0);
  });

  it('answers markAt on the grid with the beat', () => {
    const result = layout(built(), paged);
    const [grid] = grids(result);
    if (!grid?.node) throw new Error('no grid');
    const inside = markAt(
      result,
      grid.bbox.x + grid.bbox.width / 2,
      grid.bbox.y + grid.bbox.height / 2,
    );
    expect(inside).toEqual({ kind: 'chord', beat: grid.node });
    expect(markAt(result, grid.bbox.x - 3, grid.bbox.y + grid.bbox.height / 2)).toBeUndefined();
  });

  it('keeps every diagram inside the page at the end of a system', () => {
    const long = builder().track('guitar');
    for (let i = 0; i < 40; i += 1) {
      long
        .bar()
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)]);
    }
    const result = layout(withChordDiagrams(long.build({ ids: 'sequential' })), paged);
    expectValid(result);
    const right = PAGE_SIZES.a4.width;
    for (const grid of grids(result)) {
      expect(grid.bbox.x + grid.bbox.width).toBeLessThanOrEqual(right);
    }
  });
});
