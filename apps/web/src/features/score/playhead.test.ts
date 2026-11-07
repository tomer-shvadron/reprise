import { layout, PAGE_SIZES, type Anchor, type LayoutOptions } from '@reprise/layout';
import { positionAtSeconds } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { timelineOf } from '@/state/timeline';
import { repeatSong } from '@/test/position';

import { columnAnchor } from './anchors';
import {
  barColumns,
  followedSystem,
  nearestColumn,
  playheadAt,
  pointerTarget,
  staffBand,
} from './playhead';
import { longLayout, sharedLongScore } from './test/long-score';
import { uniformNotation } from './view-options';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const centre = (anchor: Anchor) => anchor.bbox.x + anchor.bbox.width / 2;

function beatAnchors(result: ReturnType<typeof layout>, masterBar: string): Anchor[] {
  return result.anchors
    .filter((anchor) => anchor.kind === 'beat' && anchor.masterBar === masterBar)
    .sort((a, b) => a.bbox.x - b.bbox.x);
}

describe('playheadAt', () => {
  const song = repeatSong();
  const result = layout(song, paged);
  const { map } = timelineOf(song);
  const at = (seconds: number) => {
    const position = positionAtSeconds(map, seconds);
    const masterBar = position && song.masterBars[position.masterBarIndex];
    if (!position || !masterBar) throw new Error('no position');
    return { cursor: playheadAt(result, song, masterBar.id, position.tick), masterBar };
  };

  it('moves between onsets, and back to the same place on a repeat’s second pass', () => {
    const first = at(0.25);
    const bar1 = song.masterBars[0]?.id ?? '';
    const [b1, b2] = beatAnchors(result, bar1);
    if (!b1 || !b2) throw new Error('no beats');
    expect(first.masterBar.id).toBe(bar1);
    expect(first.cursor?.x).toBeCloseTo((centre(b1) + centre(b2)) / 2);
    expect(first.cursor?.bar).toBe(columnAnchor(result, bar1, b1.system));

    const second = at(4.25);
    expect(second.masterBar.id).toBe(bar1);
    expect(second.cursor?.x).toBeCloseTo(first.cursor?.x ?? Number.NaN);
    expect(second.cursor?.bar).toBe(first.cursor?.bar);
  });

  it('follows the tempo change, and runs to the column’s edge after the last onset', () => {
    const bar3 = song.masterBars[2]?.id ?? '';
    const beats = beatAnchors(result, bar3);
    const [b1, b2] = beats;
    const b4 = beats[3];
    if (!b1 || !b2 || !b4) throw new Error('no beats');
    // A quarter at 160 lasts 0.375 s; bar 3 starts at 8 s.
    expect(at(8.1875).cursor?.x).toBeCloseTo((centre(b1) + centre(b2)) / 2);
    const column = columnAnchor(result, bar3, b1.system);
    if (!column) throw new Error('no column');
    const end = column.bbox.x + column.bbox.width;
    // 9.4 s is 3584 ticks into the bar; beat 4 starts at 2880, the bar ends at 3840.
    expect(at(9.4).cursor?.x).toBeCloseTo(centre(b4) + ((end - centre(b4)) * (3584 - 2880)) / 960);
  });

  it('merges the staves’ anchors at one onset, skips lone rests and spans an empty bar', () => {
    const two = repeatSong();
    const twoLayout = layout(two, { ...paged, notation: uniformNotation(two, 'both') });
    const bar1 = two.masterBars[0]?.id ?? '';
    const cursor = playheadAt(twoLayout, two, bar1, 0);
    const [top] = beatAnchors(twoLayout, bar1).filter((anchor) => anchor.staff === 'standard');
    expect(cursor?.x).toBeCloseTo(top ? centre(top) : Number.NaN, 0);

    const large = largeScore(1, 2, { structure: true });
    const largeLayout = layout(large, paged);
    const id = large.masterBars[0]?.id ?? '';
    const rests = large.tracks[0]?.bars[0]?.voices.filter(
      (voice) => voice.beats.length === 1 && voice.beats[0]?.rest,
    );
    expect(rests?.length ?? 0).toBeGreaterThan(0);
    // The lone rest sits mid-bar on the tab staff; at tick 0 the playhead is on the first beat.
    const firstBeat = largeLayout.anchors.find(
      (anchor) =>
        anchor.kind === 'beat' &&
        anchor.masterBar === id &&
        anchor.id === large.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id,
    );
    expect(playheadAt(largeLayout, large, id, 0)?.x).toBeCloseTo(
      firstBeat ? centre(firstBeat) : Number.NaN,
    );

    const empty = score()
      .track('guitar')
      .bar()
      .bar()
      .beat('4', [note(1, 0)])
      .build();
    const emptyLayout = layout(empty, paged);
    const emptyBar = empty.masterBars[0]?.id ?? '';
    const column = columnAnchor(emptyLayout, emptyBar, 0);
    if (!column) throw new Error('no column');
    expect(playheadAt(emptyLayout, empty, emptyBar, 1920)?.x).toBeCloseTo(
      column.bbox.x + column.bbox.width / 2,
    );
    expect(playheadAt(emptyLayout, empty, 'nope', 0)).toBeUndefined();
  });
});

describe('pointer targets', () => {
  const song = largeScore(2, 20);
  const result = layout(song, paged);

  it('seeks to a note’s or a beat’s own onset, with its track', () => {
    const noteAnchor = result.anchors.find(
      (anchor) => anchor.kind === 'note' && anchor.masterBar === song.masterBars[1]?.id,
    );
    if (!noteAnchor) throw new Error('no note anchor');
    const beatIndex = song.tracks
      .flatMap((track) => track.bars[1]?.voices[0]?.beats ?? [])
      .findIndex((beat) => beat.notes.some((n) => n.id === noteAnchor.id));
    expect(beatIndex).toBeGreaterThanOrEqual(0);
    const target = pointerTarget(result, song, {
      point: { x: centre(noteAnchor), y: noteAnchor.bbox.y },
      anchor: noteAnchor,
      column: undefined,
    });
    expect(target).toMatchObject({ masterBarIndex: 1, track: noteAnchor.track });
    expect(target?.tick).toBe((beatIndex % 8) * 480);
  });

  it('takes a bar or staff click to the nearest onset, and the bar start near its barline', () => {
    const staff = result.anchors.find((anchor) => anchor.kind === 'staff' && anchor.system === 0);
    const column = columnAnchor(result, song.masterBars[2]?.id ?? '', 0);
    if (!staff || !column) throw new Error('no anchors');
    const nearStart = pointerTarget(result, song, {
      point: { x: column.bbox.x + 1, y: staff.bbox.y },
      anchor: staff,
      column,
    });
    expect(nearStart).toMatchObject({ masterBarIndex: 2, tick: 0, track: staff.track });
    const nearEnd = pointerTarget(result, song, {
      point: { x: column.bbox.x + column.bbox.width - 1, y: staff.bbox.y },
      anchor: undefined,
      column,
    });
    expect(nearEnd?.tick).toBe(7 * 480);
  });

  it('finds the nearest system’s nearest column between systems and in the margins', () => {
    const [s0, s1] = result.systems;
    if (!s0 || !s1) throw new Error('two systems expected');
    const gap = s0.bbox.y + s0.bbox.height;
    const nearer1 = { x: s1.bbox.x + 2, y: s1.bbox.y - (s1.bbox.y - gap) / 4 };
    expect(nearestColumn(result, result.systems, nearer1)?.system).toBe(1);
    expect(nearestColumn(result, result.systems, nearer1)?.id).toBe(
      song.masterBars[s1.bars.start]?.id,
    );
    const margin = { x: 0, y: s0.bbox.y + 10 };
    expect(nearestColumn(result, result.systems, margin)?.id).toBe(song.masterBars[0]?.id);
    expect(nearestColumn(result, [], margin)).toBeUndefined();
  });

  it('lists a range’s columns in order, and a track’s staff band', () => {
    const first = song.masterBars[0]?.id ?? '';
    const third = song.masterBars[2]?.id ?? '';
    expect(barColumns(result, song, { startBar: third, endBar: first }).map((a) => a.id)).toEqual(
      song.masterBars.slice(0, 3).map((bar) => bar.id),
    );
    const track = song.tracks[1]?.id ?? '';
    const band = staffBand(result, track, 0);
    const system = result.systems[0];
    if (!band || !system) throw new Error('no band');
    expect(band.y).toBeGreaterThan(system.bbox.y);
    expect(band.height).toBeLessThan(system.bbox.height);
  });
});

describe('split systems', () => {
  const song = sharedLongScore();
  const result = longLayout({ mode: 'paged', paper: 'a4' });
  const [first, second] = song.masterBars;
  const track = (index: number) => song.tracks[index]?.id ?? '';
  const holds = (system: number, index: number) =>
    result.systems[system]?.staves.some((staff) => staff.track === track(index));
  if (!first || !second) throw new Error('no bars');

  it('puts the playhead in the part that holds the followed track, at the same x', () => {
    const top = playheadAt(result, song, first.id, 0, track(0));
    const bottom = playheadAt(result, song, first.id, 0, track(7));
    const none = playheadAt(result, song, first.id, 0);
    expect(top && holds(top.bar.system, 0)).toBe(true);
    expect(bottom && holds(bottom.bar.system, 7)).toBe(true);
    expect(bottom?.bar.system).not.toBe(top?.bar.system);
    expect(bottom?.x).toBe(top?.x);
    expect(none?.bar).toBe(top?.bar);
  });

  it('tints every part of a bar range', () => {
    const columns = barColumns(result, song, { startBar: first.id, endBar: first.id });
    expect(columns.map((column) => result.systems[column.system]?.part)).toEqual([0, 1]);
  });

  it('moves on to the next system’s part that holds the track, not the continuation', () => {
    const next = result.systems.findIndex((system) => system.bars.start > 0);
    expect(followedSystem(result, 0, track(0))).toBe(next);
    expect(followedSystem(result, 1, track(7))).toBe(next + 1);
    expect(followedSystem(result, 0, undefined)).toBe(next);
    expect(followedSystem(result, result.systems.length - 1, track(7))).toBeUndefined();
  });
});
