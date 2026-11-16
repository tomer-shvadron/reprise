import type { Notation, Score } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZES,
  anchorBox,
  hitTest,
  layout,
  type Anchor,
  type LayoutOptions,
  type Rect,
} from './index';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const built = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 0)])
  .beat('4', [note(1, 2)])
  .rest('2')
  .bar()
  .beat('1', [note(2, 3)])
  .build({ ids: 'sequential' });
const result = layout(built, paged);

function centre(anchor: Anchor | undefined): [number, number] {
  if (!anchor) throw new Error('no anchor');
  return [anchor.bbox.x + anchor.bbox.width / 2, anchor.bbox.y + anchor.bbox.height / 2];
}

describe('hitTest', () => {
  it('finds the beat under a point', () => {
    for (const beat of result.anchors.filter((anchor) => anchor.kind === 'beat')) {
      expect(hitTest(result, ...centre(beat))?.id).toBe(beat.id);
    }
  });

  it('falls back from the beat to the track bar, the staff and the system', () => {
    const bar = result.anchors.find(
      (anchor) => anchor.kind === 'bar' && anchor.track !== undefined,
    );
    const firstBeat = result.anchors.find((anchor) => anchor.kind === 'beat');
    if (!bar || !firstBeat) throw new Error('missing anchors');
    expect(hitTest(result, bar.bbox.x + 1, firstBeat.bbox.y + 1)).toMatchObject({
      kind: 'bar',
      id: bar.id,
      track: bar.track,
    });
    const staff = result.anchors.find((anchor) => anchor.kind === 'staff');
    if (!staff) throw new Error('no staff anchor');
    expect(hitTest(result, staff.bbox.x + 2, staff.bbox.y + 2)?.kind).toBe('staff');
    const system = result.systems[0];
    if (!system) throw new Error('no system');
    expect(hitTest(result, system.bbox.x + 1, system.bbox.y + 1)).toMatchObject({
      kind: 'system',
      id: system.id,
    });
  });

  it('finds nothing outside every system', () => {
    expect(hitTest(result, 1, 1)).toBeUndefined();
    expect(hitTest(result, -100, 500)).toBeUndefined();
  });

  it('finds notes and the system in a continuation', () => {
    const tall = largeScore(8, 6);
    const split = layout(tall, {
      ...paged,
      notation: Object.fromEntries(tall.tracks.map(({ id }) => [id, 'both'])),
    });
    const part = split.systems[1];
    if (part?.part !== 1) throw new Error('no continuation');
    const notes = split.anchors
      .slice(part.anchors.start, part.anchors.end)
      .filter((anchor) => anchor.kind === 'note');
    expect(notes.length).toBeGreaterThan(0);
    for (const found of notes) {
      expect(hitTest(split, ...centre(found))).toMatchObject({
        kind: 'note',
        id: found.id,
        system: part.index,
      });
    }
    expect(hitTest(split, part.bbox.x + part.bbox.width / 2, part.bbox.y + 1)).toMatchObject({
      kind: 'system',
      id: `${split.systems[0]?.id ?? ''}/1`,
    });
  });
  it('finds each note of a unison in one voice', () => {
    const built = score()
      .track('guitar', { display: { notation: 'standard', octaveShift: 1 } })
      .bar()
      .beat('4', [note(1, 0), note(2, 5), note(3, 9)])
      .build({ ids: 'sequential' });
    const laid = layout(built, paged);
    const notes = laid.anchors.filter((anchor) => anchor.kind === 'note');
    expect(notes).toHaveLength(3);
    for (const found of notes) expect(hitTest(laid, ...centre(found))?.id).toBe(found.id);
  });

  it('finds each voice on its half of a head two voices share', () => {
    const built = score()
      .track('guitar', { display: { notation: 'standard', octaveShift: 1 } })
      .bar()
      .beat('4', [note(1, 0)])
      .voice(1)
      .beat('4', [note(2, 5)])
      .build({ ids: 'sequential' });
    const laid = layout(built, paged);
    const notes = laid.anchors.filter((anchor) => anchor.kind === 'note');
    expect(notes).toHaveLength(2);
    for (const found of notes) expect(hitTest(laid, ...centre(found))?.id).toBe(found.id);
    const [left, right] = [...notes].sort((a, b) => a.bbox.x - b.bbox.x);
    if (!left || !right) throw new Error('no halves');
    const y = left.bbox.y + left.bbox.height / 2;
    expect(hitTest(laid, left.bbox.x + 1, y)?.id).toBe(left.id);
    expect(hitTest(laid, right.bbox.x + right.bbox.width - 1, y)?.id).toBe(right.id);
    // The up-stem voice, the first, keeps the right half.
    expect(right.voice).toBe(0);
  });
});

describe('continuous', () => {
  const options: LayoutOptions = { ...paged, mode: 'continuous', width: 640 };
  const long = largeScore(1, 40);
  const laid = layout(long, options);

  it.each(['tab', 'standard', 'both'] as const)(
    'finds each %s beat or note at the centre of its layout-space box',
    (notation) => {
      const many = largeScore(3, 40);
      const result = layout(many, {
        ...options,
        notation: Object.fromEntries(many.tracks.map(({ id }) => [id, notation])),
      });
      expect(result.systems.length).toBeGreaterThan(5);
      for (const anchor of result.anchors) {
        if (anchor.kind !== 'beat' && anchor.kind !== 'note') continue;
        const box = anchorBox(result, anchor);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const found = hitTest(result, x, y);
        // Only a note drawn over a beat's centre may take the hit from it.
        const under = found && anchorBox(result, found);
        const covered =
          anchor.kind === 'beat' &&
          found?.kind === 'note' &&
          under !== undefined &&
          x >= under.x &&
          x <= under.x + under.width;
        expect(found === anchor || covered, `${anchor.kind} ${anchor.id}`).toBe(true);
      }
    },
  );

  it('returns the very anchor the shifted-box implementation returned, offset systems included', () => {
    // The implementation before the allocation fix, kept as the reference.
    const rank = { note: 4, beat: 3, bar: 2, staff: 1, system: 0 } as const;
    const specific = (a: Anchor, b: Anchor): boolean => {
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] > rank[b.kind];
      if ((a.track === undefined) !== (b.track === undefined)) return a.track !== undefined;
      return a.bbox.width * a.bbox.height < b.bbox.width * b.bbox.height;
    };
    const inBox = (box: Rect, x: number, y: number) =>
      x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    const reference = (x: number, y: number): Anchor | undefined => {
      let best: Anchor | undefined;
      for (const system of laid.systems) {
        if (!inBox(system.bbox, x, y)) continue;
        for (let i = system.anchors.start; i < system.anchors.end; i++) {
          const anchor = laid.anchors[i];
          if (!anchor) continue;
          const box = anchorBox(laid, anchor);
          if (inBox(box, x, y) && (!best || specific(anchor, best))) best = anchor;
        }
      }
      return best;
    };
    const right = Math.max(...laid.systems.map((s) => s.bbox.x + s.bbox.width));
    const bottom = Math.max(...laid.systems.map((s) => s.bbox.y + s.bbox.height));
    expect(laid.systems.some((s) => (s.offsetX ?? 0) > 0)).toBe(true);
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 3000; i++) {
      const x = random() * right;
      const y = random() * bottom;
      expect(hitTest(laid, x, y)).toBe(reference(x, y));
    }
    // On and just outside the edges of anchors in later systems.
    for (const anchor of laid.anchors
      .filter((a) => a.system > 3 && a.kind !== 'system')
      .slice(0, 300)) {
      const box = anchorBox(laid, anchor);
      for (const [dx, dy] of [
        [0, 0],
        [box.width, box.height],
        [-0.01, 0],
        [box.width + 0.01, 0],
      ] as const) {
        const x = box.x + dx;
        const y = box.y + dy;
        expect(hitTest(laid, x, y)).toBe(reference(x, y));
      }
    }
  });

  it("never returns another system's anchor inside a system", () => {
    const system = laid.systems[5];
    if (!system) throw new Error('no system 5');
    const { x, y, width, height } = system.bbox;
    for (let i = 1; i < 20; i++) {
      const found = hitTest(laid, x + (width * i) / 20, y + height / 2);
      if (found) expect(found.system).toBe(5);
    }
  });

  it('returns the stored box for segment 0 and for paged mode, and shifts the rest by offsetX', () => {
    const flat = layout(long, paged);
    for (const anchor of flat.anchors) expect(anchorBox(flat, anchor)).toBe(anchor.bbox);
    const first = laid.anchors.find((anchor) => anchor.system === 0);
    if (!first) throw new Error('no anchor in system 0');
    expect(anchorBox(laid, first)).toBe(first.bbox);
    for (const anchor of laid.anchors.filter((a) => a.system >= 1)) {
      const offsetX = laid.systems[anchor.system]?.offsetX ?? 0;
      expect(anchorBox(laid, anchor).x - anchor.bbox.x).toBeCloseTo(offsetX, 9);
    }
  });
});

describe('every note is clickable', () => {
  const MIXED: readonly Notation[] = ['tab', 'standard', 'both'];
  const modes = { paged, continuous: { ...paged, mode: 'continuous', width: 640 } } as const;

  function noteIds(built: Score): Set<string> {
    const ids = new Set<string>();
    for (const track of built.tracks) {
      for (const bar of track.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const n of beat.notes) ids.add(n.id);
            for (const grace of beat.grace ?? []) for (const n of grace.notes) ids.add(n.id);
          }
        }
      }
    }
    return ids;
  }

  /** Every model note has a note anchor, and a hit at that anchor's centre returns it. */
  function expectAllHit(built: Score, options: LayoutOptions) {
    const laid = layout(built, options);
    const wanted = noteIds(built);
    const hit = new Set<string>();
    for (const anchor of laid.anchors) {
      if (anchor.kind !== 'note') continue;
      const box = anchorBox(laid, anchor);
      const found = hitTest(laid, box.x + box.width / 2, box.y + box.height / 2);
      expect(found, `note ${anchor.id}`).toBe(anchor);
      hit.add(anchor.id);
    }
    expect(hit.size).toBe(wanted.size);
    expect([...wanted].filter((id) => !hit.has(id))).toEqual([]);
  }

  // Worst run: 1.3 s alone, 2.8 s under three parallel `pnpm test` runs, 5.2 s on CI (issue #290,
  // it timed out at the 5 s default). 4x the CI worst, rounded up to the 30 s step.
  it.each(Object.keys(modes) as (keyof typeof modes)[])(
    'the long score in mixed notation, %s',
    (mode) => {
      const long = largeScore(8, 300, { structure: true });
      expectAllHit(long, {
        ...modes[mode],
        notation: Object.fromEntries(long.tracks.map(({ id }, i) => [id, MIXED[i % 3] ?? 'tab'])),
      });
    },
    30_000,
  );

  it.each(
    MIXED.flatMap((notation) =>
      (Object.keys(modes) as (keyof typeof modes)[]).map((mode) => [notation, mode] as const),
    ),
  )('a shorter score in %s notation, %s', (notation, mode) => {
    const many = largeScore(3, 40);
    expectAllHit(many, {
      ...modes[mode],
      notation: Object.fromEntries(many.tracks.map(({ id }) => [id, notation])),
    });
  });
});
