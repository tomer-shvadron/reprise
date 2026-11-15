import {
  anchorBox,
  hitTest,
  layout,
  PAGE_SIZES,
  type LayoutOptions,
  type LayoutResult,
} from '@reprise/layout';
import type { Notation, Score } from '@reprise/model';
import { largeScore, note, score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { nearestColumn } from '@/features/score';

import { firstStop } from './cursor';
import { cursorFromHit, locate, stringAt } from './locate';
import { editTarget } from './range';
import { editScore } from './test/scores';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function lay(built: Score, notation: Notation | undefined, base = paged): LayoutResult {
  return layout(built, {
    ...base,
    notation: notation ? Object.fromEntries(built.tracks.map(({ id }) => [id, notation])) : {},
  });
}

function pointer(result: LayoutResult, x: number, y: number) {
  const point = { x, y };
  return {
    point,
    anchor: hitTest(result, x, y),
    column: nearestColumn(result, result.systems, point),
  };
}

describe('locate: acceptance on the long score', () => {
  const long = largeScore(8, 300, { structure: true });
  it.each(['paged', 'continuous'] as const)(
    'the centre of every note anchor locates its own note, %s',
    (mode) => {
      const result = layout(long, {
        ...paged,
        ...(mode === 'continuous' && { mode, width: 640 }),
        notation: Object.fromEntries(
          long.tracks.map(({ id }, i) => [
            id,
            (['tab', 'standard', 'both'] as const)[i % 3] ?? 'tab',
          ]),
        ),
      });
      let checked = 0;
      for (const anchor of result.anchors) {
        if (anchor.kind !== 'note') continue;
        const box = anchorBox(result, anchor);
        const found = locate(
          result,
          long,
          pointer(result, box.x + box.width / 2, box.y + box.height / 2),
        );
        expect(found?.note).toBe(anchor.id);
        // Sampled: the cursor and target for each tenth note.
        if (checked++ % 10 === 0 && found) {
          const cursor = cursorFromHit(long, found);
          expect(cursor?.beat).toBe(found.beat);
          expect(
            editTarget(long, { cursor, range: undefined, selection: { noteIds: [anchor.id] } }),
          ).toEqual({
            noteIds: [anchor.id],
          });
        }
      }
      expect(checked).toBeGreaterThan(30_000);
    },
    60_000,
  );
});

describe('locate', () => {
  const built = editScore();
  const tab = lay(built, 'tab');
  const guitar = built.tracks[0]?.id ?? '';

  function beatAnchor(result: LayoutResult, index: number) {
    const id = built.tracks[0]?.bars[0]?.voices[0]?.beats[index]?.id;
    const anchor = result.anchors.find(
      (a) => a.kind === 'beat' && a.id === id && a.track === guitar,
    );
    if (!anchor) throw new Error('no beat anchor');
    return anchor;
  }

  function tabStaff(result: LayoutResult) {
    const staff = result.systems[0]?.staves.find((s) => s.track === guitar && s.type === 'tab');
    if (!staff) throw new Error('no tab staff');
    return staff;
  }

  it('reads the string from the line nearest the click, clamped', () => {
    const staff = tabStaff(tab);
    const spacing = (staff.bottom - staff.top) / 5;
    const box = anchorBox(tab, beatAnchor(tab, 1));
    const x = box.x + box.width / 2;
    const at = (y: number) => locate(tab, built, pointer(tab, x, y));
    // The beat's box may be narrower than the staff, so the hit is the beat, not a note, off a note's line.
    expect(at(staff.top + spacing * 2)?.string).toBe(3);
    expect(at(staff.top + spacing * 2 + spacing * 0.4)?.string).toBe(3);
    expect(at(staff.top + spacing * 2 + spacing * 0.6)?.string).toBe(4);
    expect(at(staff.top - 0.2)?.string).toBe(1);
    expect(at(staff.bottom + 0.2)?.string).toBe(6);
    expect(stringAt(tab.systems[0], guitar, 6, staff.top - 100)).toBe(1);
    expect(stringAt(tab.systems[0], guitar, 6, staff.bottom + 100)).toBe(6);
    expect(stringAt(tab.systems[0], 'nobody', 6, 0)).toBeUndefined();
  });

  it('gives a note its own string and says it is a note', () => {
    const note = built.tracks[0]?.bars[0]?.voices[0]?.beats[3]?.notes[0];
    const anchor = tab.anchors.find((a) => a.kind === 'note' && a.id === note?.id);
    if (!anchor || !note) throw new Error('no note');
    const box = anchorBox(tab, anchor);
    const hit = locate(tab, built, pointer(tab, box.x + box.width / 2, box.y + box.height / 2));
    expect(hit).toMatchObject({
      note: note.id,
      string: 6,
      staff: 'tab',
      grace: false,
      track: guitar,
    });
  });

  it('keeps the cursor string on a standard staff and defaults to 1', () => {
    const standard = lay(built, 'standard');
    const anchor = standard.anchors.find((a) => a.kind === 'beat' && a.track === guitar);
    if (!anchor) throw new Error('no beat');
    const box = anchorBox(standard, anchor);
    const at = pointer(standard, box.x + 0.5, box.y + 0.5);
    const current = firstStop(built, 0, 0, 0, { string: 4, staff: 'standard' });
    expect(locate(standard, built, at, current)).toMatchObject({ staff: 'standard', string: 4 });
    expect(locate(standard, built, at)?.string).toBe(1);
  });

  it('gives a drum track string 0 and the percussion staff', () => {
    const anchor = tab.anchors.find((a) => a.kind === 'note' && a.track === built.tracks[1]?.id);
    if (!anchor) throw new Error('no drum note');
    const box = anchorBox(tab, anchor);
    expect(
      locate(tab, built, pointer(tab, box.x + box.width / 2, box.y + box.height / 2)),
    ).toMatchObject({
      string: 0,
      staff: 'percussion',
    });
  });

  it('returns the same beat for each staff in both notation, and says which was clicked', () => {
    const both = lay(built, 'both');
    const id = built.tracks[0]?.bars[0]?.voices[0]?.beats[1]?.id;
    const anchors = both.anchors.filter((a) => a.kind === 'beat' && a.id === id);
    expect(anchors.map((a) => a.staff).sort()).toEqual(['standard', 'tab']);
    for (const anchor of anchors) {
      const box = anchorBox(both, anchor);
      const hit = locate(both, built, pointer(both, box.x + 0.5, box.y + box.height - 0.5));
      expect(hit).toMatchObject({ beat: id, staff: anchor.staff });
    }
  });

  it('finds the nearest beat, or the end slot, in a gap of a track bar', () => {
    const bar = tab.anchors.find(
      (a) => a.kind === 'bar' && a.track === guitar && a.masterBar === built.masterBars[1]?.id,
    );
    if (!bar) throw new Error('no bar');
    const box = anchorBox(tab, bar);
    const staff = tabStaff(tab);
    const y = staff.top + (staff.bottom - staff.top) / 2;
    const beats = built.tracks[0]?.bars[1]?.voices[0]?.beats ?? [];
    const last = tab.anchors.find((a) => a.kind === 'beat' && a.id === beats[1]?.id);
    if (!last) throw new Error('no last beat');
    const lastBox = anchorBox(tab, last);
    // Past the last beat by construction: halfway between its right edge and the bar's.
    const gapFrom = lastBox.x + lastBox.width;
    const gapTo = box.x + box.width;
    expect(gapTo - gapFrom, 'the bar has room after its last beat').toBeGreaterThan(1);
    const end = locate(tab, built, pointer(tab, (gapFrom + gapTo) / 2, staff.top - 0.1));
    expect(end).toMatchObject({ masterBar: built.masterBars[1]?.id, beat: undefined });
    // Just inside its left edge, before the first beat.
    const start = locate(tab, built, pointer(tab, box.x + 0.1, y));
    expect(start?.beat).toBe(beats[0]?.id);
  });

  it.each(['tab', 'both'] as const)(
    'reads each string of a 7-string and a 4-string track in one system, in %s notation',
    (notation) => {
      const mixed = scoreBuilder()
        .track('guitar', { tuning: [35, 40, 45, 50, 55, 59, 64] })
        .bar()
        .beat('4', [note(1, 0)])
        .track('bass')
        .bar()
        .beat('4', [note(1, 0)])
        .build({ ids: 'sequential' });
      const laid = lay(mixed, notation);
      expect(mixed.tracks.map((t) => t.tuning.length)).toEqual([7, 4]);
      mixed.tracks.forEach((track, t) => {
        const staff = laid.systems[0]?.staves.find(
          (st) => st.track === track.id && st.type === 'tab',
        );
        const beat = track.bars[0]?.voices[0]?.beats[0];
        const anchor = laid.anchors.find(
          (a) => a.kind === 'beat' && a.id === beat?.id && a.staff === 'tab',
        );
        if (!staff || !anchor) throw new Error(`no tab staff for track ${String(t)}`);
        const strings = track.tuning.length;
        const box = anchorBox(laid, anchor);
        for (let string = 1; string <= strings; string++) {
          const y = staff.top + ((staff.bottom - staff.top) * (string - 1)) / (strings - 1);
          // A point on the beat box, off the note's own anchor, so the string comes from the line.
          const hit = locate(laid, mixed, pointer(laid, box.x + 0.2, y));
          expect(hit?.string, `track ${String(t)} line ${String(string)}`).toBe(string);
        }
      });
    },
  );

  it('puts the cursor at the start of a staff for a click in the clef', () => {
    const system = tab.systems[0];
    const staff = tab.anchors.find((a) => a.kind === 'staff' && a.track === guitar);
    if (!system || !staff) throw new Error('missing');
    const box = anchorBox(tab, staff);
    const hit = locate(tab, built, pointer(tab, box.x + 1, box.y + box.height / 2));
    expect(hit).toMatchObject({
      track: guitar,
      masterBar: built.masterBars[system.bars.start]?.id,
    });
    expect(hit?.beat).toBe(built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id);
  });

  it('takes the nearest column in a margin', () => {
    const hit = locate(tab, built, pointer(tab, 2, 2), undefined, [guitar]);
    expect(hit?.track).toBe(guitar);
    expect(hit?.masterBar).toBeDefined();
    expect(
      locate(tab, built, { point: { x: 0, y: 0 }, anchor: undefined, column: undefined }),
    ).toBeUndefined();
  });

  it('works in a continuous segment past the first and a split system', () => {
    const many = largeScore(8, 12);
    const split = layout(many, {
      ...paged,
      notation: Object.fromEntries(many.tracks.map(({ id }) => [id, 'both'])),
    });
    const part = split.systems.find((s) => s.part === 1);
    if (!part) throw new Error('no continuation');
    const note = split.anchors
      .slice(part.anchors.start, part.anchors.end)
      .find((a) => a.kind === 'note');
    if (!note) throw new Error('no note');
    const box = anchorBox(split, note);
    expect(
      locate(split, many, pointer(split, box.x + box.width / 2, box.y + box.height / 2))?.note,
    ).toBe(note.id);
    const flat = largeScore(1, 40);
    const flowing = layout(flat, { ...paged, mode: 'continuous', width: 640 });
    const later = flowing.anchors.find((a) => a.kind === 'note' && a.system > 3);
    if (!later) throw new Error('no later note');
    const b = anchorBox(flowing, later);
    expect(locate(flowing, flat, pointer(flowing, b.x + 1, b.y + 1))).toBeDefined();
  });
});
