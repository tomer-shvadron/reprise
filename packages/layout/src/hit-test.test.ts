import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, anchorBox, hitTest, layout, type Anchor, type LayoutOptions } from './index';

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

  it('finds each anchor at the centre of its layout-space box', () => {
    expect(laid.systems.length).toBeGreaterThan(5);
    for (const anchor of laid.anchors) {
      if (anchor.kind !== 'beat' && anchor.kind !== 'note') continue;
      const box = anchorBox(laid, anchor);
      const found = hitTest(laid, box.x + box.width / 2, box.y + box.height / 2);
      // A beat's centre can lie under its own note, the more specific hit.
      if (anchor.kind === 'note') expect(found).toBe(anchor);
      else expect(found?.system).toBe(anchor.system);
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
