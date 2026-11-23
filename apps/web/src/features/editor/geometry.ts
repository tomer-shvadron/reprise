import {
  anchorBox,
  type LayoutResult,
  type Rect,
  type StaffPlacement,
  type WordLane,
} from '@reprise/layout';
import { beatTicks, type Id, type Score } from '@reprise/model';

import {
  columnAnchor,
  findAnchors,
  playheadAt,
  scoreIndex,
  staffBand,
  type OverlayBox,
} from '@/features/score';
import type { EditCursor, EditRange, RangeEnd } from '@/state/selection';

import { stringCount } from './cursor';
import { cursorLane, lanePosition } from './drum-lanes';
import { endSpan, rangeSpan, type TimePoint } from './range';

/** A tab or standard staff has five or six lines to a staff `height`; this is one gap of the standard five. */
const staffSpace = (staff: StaffPlacement): number => (staff.bottom - staff.top) / 4;

/** Wider than a bare digit, so a one-digit fret still has a target around it. */
const MIN_CARET_SPACES = 1.6;

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/** The smallest rectangle holding every box: what to scroll into view after a move. */
export function caretRect(boxes: readonly OverlayBox[]): Rect | undefined {
  let rect: Rect | undefined;
  for (const { box } of boxes) rect = rect ? union(rect, box) : box;
  return rect;
}

/** Whether the system draws the staff the cursor holds, for its track. */
const drawsStaff = (layout: LayoutResult, system: number, track: Id, cursor: EditCursor): boolean =>
  layout.systems[system]?.staves.some((s) => s.track === track && s.type === cursor.staff) ?? false;

/** The box a cursor draws on `staff` at x (centre) `x`, `width` wide. */
function caretOn(
  staff: StaffPlacement,
  strings: number,
  cursor: EditCursor,
  x: number,
  width: number,
  system: number,
  drawsOwn: boolean,
): OverlayBox {
  // Muted only beside the staff the cursor holds; where that is not drawn, this one is the cursor.
  const muted = staff.type !== cursor.staff && drawsOwn;
  if (staff.type === 'tab' && strings > 0) {
    const gap = strings > 1 ? (staff.bottom - staff.top) / (strings - 1) : staffSpace(staff);
    const wide = Math.max(width, gap * MIN_CARET_SPACES);
    const y = staff.top + (Math.min(Math.max(cursor.string, 1), strings) - 1) * gap;
    return {
      system,
      box: { x: x - wide / 2, y: y - gap / 2, width: wide, height: gap },
      muted,
    };
  }
  const wide = Math.max(width, staffSpace(staff) * MIN_CARET_SPACES);
  if (staff.type === 'percussion') {
    // One space tall on the lane's line or space; position 0 is the bottom line, two to a space.
    const space = staffSpace(staff);
    const y = staff.bottom - (lanePosition(cursorLane(cursor)) * space) / 2;
    return {
      system,
      box: { x: x - wide / 2, y: y - space / 2, width: wide, height: space },
      muted,
    };
  }
  return {
    system,
    box: { x: x - wide / 2, y: staff.top, width: wide, height: staff.bottom - staff.top },
    muted,
  };
}

/**
 * The boxes of the edit cursor: on a tab staff one line-spacing tall on the string's line, on a
 * percussion staff one space tall on the lane's line, on a standard staff a column over the staff. In `both` the staff the cursor holds
 * gets the strong one and the other a muted column. The end slot sits where `playheadAt` puts
 * the end of the voice, and in an empty bar one staff space in from the column's left edge.
 */
export function caretBoxes(layout: LayoutResult, score: Score, cursor: EditCursor): OverlayBox[] {
  const { track: trackId } = cursor;
  const trackIndex = score.tracks.findIndex(({ id }) => id === trackId);
  const track = score.tracks[trackIndex];
  if (!track) return [];
  const strings = stringCount(score, trackIndex);
  const boxes: OverlayBox[] = [];

  if (cursor.beat !== undefined) {
    const anchors = findAnchors(layout, cursor.beat, 'beat').filter((a) => a.track === trackId);
    for (const anchor of anchors) {
      const staff = layout.systems[anchor.system]?.staves.find(
        (s) => s.track === trackId && s.type === anchor.staff,
      );
      if (!staff) continue;
      const rect = anchorBox(layout, anchor);
      boxes.push(
        caretOn(
          staff,
          strings,
          cursor,
          rect.x + rect.width / 2,
          rect.width,
          anchor.system,
          drawsStaff(layout, anchor.system, trackId, cursor),
        ),
      );
    }
    return boxes;
  }

  const barIndex = scoreIndex(score).barIndex.get(cursor.masterBar);
  const beats =
    (barIndex === undefined ? undefined : track.bars[barIndex]?.voices[cursor.voice]?.beats) ?? [];
  const ticks = beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
  const head = playheadAt(layout, score, cursor.masterBar, ticks, trackId);
  if (!head) return [];
  const system = layout.systems[head.bar.system];
  for (const staff of system?.staves ?? []) {
    if (staff.track !== trackId) continue;
    const x = ticks === 0 ? head.box.x + staffSpace(staff) : head.x;
    boxes.push(
      caretOn(
        staff,
        strings,
        cursor,
        x,
        0,
        head.bar.system,
        drawsStaff(layout, head.bar.system, trackId, cursor),
      ),
    );
  }
  return boxes;
}

/** Where on `system` the range end lies, as the left or right edge of its beat or column. */
function endEdge(
  layout: LayoutResult,
  score: Score,
  system: number,
  end: RangeEnd,
  side: 'left' | 'right',
): number | undefined {
  if (end.beat === undefined) {
    const column = columnAnchor(layout, end.masterBar, system);
    if (!column) return undefined;
    const box = anchorBox(layout, column);
    return side === 'left' ? box.x : box.x + box.width;
  }
  const drawn = findAnchors(layout, end.beat, 'beat').find((a) => a.system === system);
  if (drawn) {
    const box = anchorBox(layout, drawn);
    return side === 'left' ? box.x : box.x + box.width;
  }
  // The beat is drawn in another part of a split system: its onset's x serves, the parts share it.
  const info = scoreIndex(score).beats.get(end.beat);
  const head = info && playheadAt(layout, score, end.masterBar, info.tick, end.track);
  return head?.x;
}

const before = (a: TimePoint, b: TimePoint): boolean =>
  a.bar !== b.bar ? a.bar < b.bar : a.tick < b.tick;

/**
 * The boxes of a range: per system part, one box from the earlier end's left edge to the later
 * end's right edge (the part's first or last column where the range runs on), over the staves of
 * the range's tracks that part holds.
 */
export function rangeBoxes(
  layout: LayoutResult,
  score: Score,
  range: EditRange,
  visible?: readonly Id[],
): OverlayBox[] {
  const span = rangeSpan(score, range, visible);
  const a = endSpan(score, range.anchor);
  const f = endSpan(score, range.focus);
  if (!span || !a || !f) return [];
  const first = before(f.start, a.start) ? range.focus : range.anchor;
  const last = before(a.end, f.end) ? range.focus : range.anchor;
  const boxes: OverlayBox[] = [];
  for (const system of layout.systems) {
    const { start, end } = system.bars;
    if (end <= span.start.bar || start > span.end.bar) continue;
    let band: Rect | undefined;
    for (const track of span.tracks) {
      const staves = staffBand(layout, track, system.index);
      if (staves) band = band ? union(band, staves) : staves;
    }
    if (!band) continue;
    const startId = score.masterBars[start]?.id;
    const endId = score.masterBars[end - 1]?.id;
    const startsHere = span.start.bar >= start;
    const endsHere = span.end.bar < end;
    const leftBox = startId === undefined ? undefined : columnAnchor(layout, startId, system.index);
    const rightBox = endId === undefined ? undefined : columnAnchor(layout, endId, system.index);
    const left = startsHere
      ? endEdge(layout, score, system.index, first, 'left')
      : leftBox && anchorBox(layout, leftBox).x;
    const right = endsHere
      ? endEdge(layout, score, system.index, last, 'right')
      : rightBox && (({ x, width }) => x + width)(anchorBox(layout, rightBox));
    if (left === undefined || right === undefined || right <= left) continue;
    boxes.push({
      system: system.index,
      box: { x: left, y: band.y, width: right - left, height: band.height },
    });
  }
  return boxes;
}

/** The word field's box in layout space, and how its text sits in it. */
export interface WordRect {
  /** The left edge, or the centre when `align` is `middle`. */
  x: number;
  y: number;
  height: number;
  /** The word's font size in layout px. */
  size: number;
  align: 'start' | 'middle';
}

export interface WordTarget {
  kind: 'chord' | 'text' | 'lyric';
  trackId: Id;
  beatId: Id;
  /** The lyric line, 0 to 4. */
  line: number;
}

/** The row a word of `target` is drawn in, as the layout tags it. */
function laneOf(target: WordTarget): WordLane {
  if (target.kind === 'chord') return 'chord';
  if (target.kind === 'text') return 'text';
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the lane type is a template over number
  return `lyric:${target.line}`;
}

/**
 * Where the word field sits for `target` on the current layout: on the baseline of the word the
 * beat already has in that row (found by the lane the layout tags it with), else on the row's
 * baseline the layout reports for the staff that draws words, which holds for an empty row too.
 * That staff is the tab, or the only staff of a track shown in standard; in `both` the words stay
 * on the tab. No lane is reserved for the field: the layout only grows once a word is committed.
 * Undefined when the beat is not drawn.
 */
export function wordFieldRect(layout: LayoutResult, target: WordTarget): WordRect | undefined {
  const anchors = findAnchors(layout, target.beatId, 'beat').filter(
    (a) => a.track === target.trackId,
  );
  for (const anchor of anchors) {
    const system = layout.systems[anchor.system];
    const words = system?.staves.find(
      (s) => s.track === target.trackId && s.type === anchor.staff && s.words,
    )?.words;
    if (!system || !words) continue;
    const lane = laneOf(target);
    const found = layout.primitives
      .slice(system.primitives.start, system.primitives.end)
      .find((p) => p.kind === 'text' && p.node === target.beatId && p.lane === lane);
    const box = anchorBox(layout, anchor);
    const lyric = target.kind === 'lyric';
    const baseline =
      found?.y ??
      (target.kind === 'chord'
        ? words.chord
        : target.kind === 'text'
          ? words.text
          : words.lyrics + target.line * words.lyricRow);
    const size = words.size;
    return {
      x: found ? found.x + (system.offsetX ?? 0) : lyric ? box.x + box.width / 2 : box.x,
      y: baseline - size * 1.1,
      height: size * 1.5,
      size,
      align: lyric ? 'middle' : 'start',
    };
  }
  return undefined;
}
