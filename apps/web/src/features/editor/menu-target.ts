import { anchorBox, type LayoutResult, type Rect } from '@reprise/layout';
import type { Id, Score } from '@reprise/model';

import type { MenuMode, MenuRequest } from '@/app/context-menu/types';
import type { AppServices } from '@/app/services';
import { barColumns, scoreIndex, type ScoreHit } from '@/features/score';
import { playheadBar } from '@/features/transport';
import type { MenuTarget } from '@/state/menu-target';
import type { BarRange, EditCursor } from '@/state/selection';

import { markCursor } from './edit-here';
import { caretBoxes, caretRect, rangeBoxes } from './geometry';
import { barRangeOf, rangeBars, rangeBeats, rangeSpan } from './range';
import { visibleTracks } from './visible';
import { beatWithTrack } from './words';

type MenuServices = Pick<AppServices, 'document' | 'selection' | 'playback' | 'heard'>;

/**
 * A menu to open and what opening it adopts into the selection: the right-clicked bar becomes the
 * selected bar, as in Guitar Pro, so the user sees what the menu acts on. A click inside the
 * selection or on the paper adopts nothing. It never seeks and leaves the loop alone.
 */
export interface ScoreMenuOpen {
  request: MenuRequest;
  /** Play mode: the bar to select. */
  adopt?: { bars: BarRange; track: Id | undefined };
  /** Edit mode: put the cursor where a plain click on this hit would, without its seek. */
  place?: ScoreHit;
  /** Edit mode: the cursor a chord name or a section marker stands for. */
  cursor?: EditCursor;
}

const barNumber = (score: Score, id: Id): number =>
  score.masterBars.findIndex((bar) => bar.id === id) + 1;

/** "Bar 3" or "Bars 12 to 16": the accessible name of what a bar selection is. */
export const barsLabel = (score: Score, bars: BarRange): string => {
  const start = barNumber(score, bars.startBar);
  const end = barNumber(score, bars.endBar);
  return start === end ? `Bar ${String(start)}` : `Bars ${String(start)} to ${String(end)}`;
};

const within = (score: Score, bars: BarRange, id: Id): boolean => {
  const at = barNumber(score, id);
  return at >= barNumber(score, bars.startBar) && at <= barNumber(score, bars.endBar);
};

/** The beat-level facts a target carries, from the score's index. */
function beatFacts(score: Score, beat: Id) {
  const info = scoreIndex(score).beats.get(beat);
  const track = info && score.tracks[info.trackIndex];
  const masterBar = info && score.masterBars[info.masterBarIndex];
  return track && masterBar ? { track: track.id, masterBar: masterBar.id } : undefined;
}

const paper = (): ScoreMenuOpen => ({
  request: { surface: 'score.paper', target: { kind: 'paper' }, label: 'Score' },
});

type Surface = 'score.note' | 'score.beat' | 'score.bar' | 'score.chord' | 'score.section';

/**
 * A menu on a note, beat, bar, chord name or section marker, and what opening it adopts: in play
 * mode the bar, in edit mode the cursor, put where a plain click on `hit` would put it, or on the
 * mark's own beat or bar.
 */
function adopted(
  at: {
    services: MenuServices;
    score: Score;
    mode: MenuMode;
    hit: ScoreHit;
  },
  surface: Surface,
  target: MenuTarget,
  masterBar: Id,
  track: Id | undefined,
  what: string,
): ScoreMenuOpen {
  const { services, score, mode, hit } = at;
  const request = {
    surface,
    target,
    label: `${what}, bar ${String(barNumber(score, masterBar))}`,
  };
  if (mode === 'play') {
    return { request, adopt: { bars: { startBar: masterBar, endBar: masterBar }, track } };
  }
  if (surface === 'score.chord' || surface === 'score.section') {
    const cursor = markCursor(services, score, target);
    return { request, ...(cursor && { cursor }) };
  }
  return { request, place: hit };
}

/** Whether the point is inside the edit range: its beat when it is on one, else its bar. */
function insideRange(score: Score, services: MenuServices, hit: ScoreHit): boolean {
  const { range } = services.selection.getState();
  const { anchor, column } = hit;
  if (!range) return false;
  const index = scoreIndex(score);
  const beat =
    anchor?.kind === 'beat'
      ? anchor.id
      : anchor?.kind === 'note'
        ? index.noteBeat.get(anchor.id)
        : undefined;
  if (beat !== undefined) {
    const visible = visibleTracks(score, services.document.getState().view);
    return rangeBeats(score, range, visible).some(({ beats }) => beats.some((b) => b.id === beat));
  }
  const bar = anchor?.masterBar ?? column?.id;
  if (bar === undefined || !rangeBars(score, range).includes(bar)) return false;
  // The bar-number area names no track. Empty staff space does: it is inside only on a track the
  // range covers and, for a range of beats, where a beat of the range sits, as a click would say.
  const track = anchor?.track;
  if (track === undefined) return true;
  const visible = visibleTracks(score, services.document.getState().view);
  const at = index.barIndex.get(bar);
  const span = rangeSpan(score, range, visible);
  if (!span?.tracks.includes(track)) return false;
  return (
    range.kind === 'bars' ||
    rangeBeats(score, range, visible).some((part) => part.track === track && part.bar === at)
  );
}

/**
 * What a right-click on the score opens. The first match wins: a chord name, a section marker,
 * the paper outside every system, the selection, then the note, the beat and the bar under the
 * point. The selection is the selected bars in play mode and the edit range in edit mode.
 */
export function scoreMenuRequest(
  hit: ScoreHit,
  services: MenuServices,
  mode: MenuMode,
): ScoreMenuOpen | undefined {
  const { score } = services.document.getState();
  if (!score) return paper();
  const { anchor, column, mark } = hit;
  const at = { services, score, mode, hit };

  if (mark?.kind === 'chord') {
    const facts = beatFacts(score, mark.beat);
    if (facts) {
      return adopted(
        at,
        'score.chord',
        { kind: 'chord', beat: mark.beat, ...facts },
        facts.masterBar,
        facts.track,
        'Chord name',
      );
    }
  }
  if (mark?.kind === 'section') {
    const name = score.masterBars.find((bar) => bar.id === mark.masterBar)?.section?.name;
    return adopted(
      at,
      'score.section',
      { kind: 'section', masterBar: mark.masterBar },
      mark.masterBar,
      undefined,
      name?.trim() ? `Section ${name.trim()}` : 'Section',
    );
  }
  if (!anchor) return paper();

  const barId = anchor.masterBar ?? column?.id;
  const { bars, range } = services.selection.getState();
  if (mode === 'play') {
    if (bars && barId !== undefined && within(score, bars, barId)) {
      return {
        request: {
          surface: 'score.range',
          target: { kind: 'range', bar: barId },
          label: barsLabel(score, bars),
        },
      };
    }
  } else if (range && insideRange(score, services, hit)) {
    const covered = barRangeOf(score, range);
    return {
      request: {
        surface: 'score.range',
        target: { kind: 'range', ...(barId !== undefined && { bar: barId }) },
        label: covered ? barsLabel(score, covered) : 'Selection',
      },
    };
  }

  const index = scoreIndex(score);
  const beatId =
    anchor.kind === 'beat'
      ? anchor.id
      : anchor.kind === 'note'
        ? index.noteBeat.get(anchor.id)
        : undefined;
  const facts = beatId === undefined ? undefined : beatFacts(score, beatId);
  if (beatId !== undefined && facts) {
    if (anchor.kind === 'note') {
      return adopted(
        at,
        'score.note',
        { kind: 'note', note: anchor.id, beat: beatId, ...facts },
        facts.masterBar,
        facts.track,
        'Note',
      );
    }
    return adopted(
      at,
      'score.beat',
      { kind: 'beat', beat: beatId, ...facts },
      facts.masterBar,
      facts.track,
      'Beat',
    );
  }
  if (barId === undefined) return paper();
  return adopted(
    at,
    'score.bar',
    { kind: 'bar', masterBar: barId, track: anchor.track },
    barId,
    anchor.track,
    'Bar',
  );
}

/** Edit mode: the range, else what the cursor is on (a note, a beat, an empty slot), at the caret. */
function editKeyboardRequest(
  services: MenuServices,
  score: Score,
  layout: LayoutResult,
  clientRect: (rect: Rect) => DOMRect,
): MenuRequest {
  const { range, cursor } = services.selection.getState();
  const anchorOf = (boxes: Parameters<typeof caretRect>[0]) => {
    const rect = caretRect(boxes);
    return rect && { anchor: clientRect(rect) };
  };
  if (range) {
    const covered = barRangeOf(score, range);
    return {
      surface: 'score.range',
      target: { kind: 'range' },
      label: covered ? barsLabel(score, covered) : 'Selection',
      ...anchorOf(
        rangeBoxes(layout, score, range, visibleTracks(score, services.document.getState().view)),
      ),
    };
  }
  if (!cursor) return paper().request;
  const where = anchorOf(caretBoxes(layout, score, cursor));
  const facts = cursor.beat === undefined ? undefined : beatFacts(score, cursor.beat);
  const found = cursor.beat === undefined ? undefined : beatWithTrack(score, cursor.beat);
  const bar = barNumber(score, cursor.masterBar);
  if (found && facts) {
    const onNote = found.beat.notes.find((n) => n.string === cursor.string);
    if (onNote) {
      return {
        surface: 'score.note',
        target: { kind: 'note', note: onNote.id, beat: found.beat.id, ...facts },
        label: `Note, bar ${String(bar)}`,
        ...where,
      };
    }
    return {
      surface: 'score.beat',
      target: { kind: 'beat', beat: found.beat.id, ...facts },
      label: `Beat, bar ${String(bar)}`,
      ...where,
    };
  }
  return {
    surface: 'score.bar',
    target: { kind: 'bar', masterBar: cursor.masterBar, track: cursor.track },
    label: `Bar ${String(bar)}`,
    ...where,
  };
}

/**
 * What the keyboard's context-menu key opens on the score: the selected bars, else the bar the
 * playhead or the last click is in. `clientRect` puts a layout box in client px for the menu's
 * anchor.
 */
export function scoreKeyboardRequest(
  services: MenuServices,
  layout: LayoutResult,
  clientRect: (rect: Rect) => DOMRect,
  mode: MenuMode,
): MenuRequest | undefined {
  const { score } = services.document.getState();
  if (!score) return paper().request;
  if (mode === 'edit') return editKeyboardRequest(services, score, layout, clientRect);
  const { bars, barsAnchor, currentTrack } = services.selection.getState();
  const box = (range: BarRange) => {
    const [first] = barColumns(layout, score, range);
    return first && clientRect(anchorBox(layout, first));
  };
  if (bars) {
    const anchor = box(bars);
    return {
      surface: 'score.range',
      target: { kind: 'range' },
      label: barsLabel(score, bars),
      ...(anchor && { anchor }),
    };
  }
  const bar = barsAnchor ?? playheadBar(services) ?? score.masterBars[0]?.id;
  if (bar === undefined) return paper().request;
  const anchor = box({ startBar: bar, endBar: bar });
  return {
    surface: 'score.bar',
    target: { kind: 'bar', masterBar: bar, track: currentTrack },
    label: barsLabel(score, { startBar: bar, endBar: bar }),
    ...(anchor && { anchor }),
  };
}

/**
 * Makes the right-clicked bar the selection, and its track the current one; never moves the
 * playhead or an active loop (the selection is marked without re-looping, so the bar the menu
 * acts on is always drawn).
 */
export function adoptMenuTarget(
  services: Pick<AppServices, 'selection'>,
  adopt: NonNullable<ScoreMenuOpen['adopt']>,
): void {
  const { selection } = services;
  selection.getState().selectBars(adopt.bars, adopt.bars.startBar, { reloop: false });
  if (adopt.track !== undefined) selection.getState().setCurrentTrack(adopt.track);
}

/**
 * Edit mode: puts the cursor where the right-click was, as a plain click would, but never seeks.
 * `placeAt` is the editor pointer's. A click inside the range, or on the paper, adopts nothing.
 */
export function adoptEditMenuTarget(
  services: Pick<AppServices, 'selection'>,
  open: Pick<ScoreMenuOpen, 'place' | 'cursor'>,
  placeAt: (hit: ScoreHit) => unknown,
): void {
  if (open.place) {
    placeAt(open.place);
  } else if (open.cursor) {
    services.selection.getState().setEdit({
      cursor: open.cursor,
      currentTrack: open.cursor.track,
      selection: {},
      range: undefined,
      bars: undefined,
      barsAnchor: undefined,
    });
  }
}
