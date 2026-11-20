import { write } from '@reprise/formats';
import { anchorBox, hitTest, type Anchor, type LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { nearestColumn, type Gesture, type ScorePointerEvent } from '@/features/score';
import { createTestServices } from '@/test/services';

import { createEditPointer } from './edit-pointer';
import { editScore } from './test/scores';

async function setup() {
  const services = createTestServices();
  await services.document
    .getState()
    .openBytes('edit.reprise', (await write(editScore(), 'reprise')).bytes);
  const score = services.document.getState().score;
  const layout = services.layout.getState().result;
  if (!score || !layout) throw new Error('not open');
  const handle = createEditPointer({ selection: services.selection, document: services.document });
  const state = () => services.selection.getState();
  return { services, score, layout, handle, state };
}

function eventAt(
  layout: LayoutResult,
  x: number,
  y: number,
  init: PointerEventInit = {},
): ScorePointerEvent {
  const point = { x, y };
  return {
    type: 'down',
    point,
    anchor: hitTest(layout, x, y),
    column: nearestColumn(layout, layout.systems, point),
    event: new PointerEvent('pointerdown', init),
  };
}

function centreOfNote(
  layout: LayoutResult,
  score: Score,
  track: number,
  bar: number,
  beat: number,
) {
  const note = score.tracks[track]?.bars[bar]?.voices[0]?.beats[beat]?.notes[0];
  const anchor = layout.anchors.find((a) => a.kind === 'note' && a.id === note?.id);
  if (!anchor || !note) throw new Error('no note');
  const box = anchorBox(layout, anchor);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, note };
}

/** A press inside the column where no track's bar is: found by scanning down its box. */
function columnPress(layout: LayoutResult, column: Anchor): ScorePointerEvent {
  const box = anchorBox(layout, column);
  for (let y = box.y + 0.5; y < box.y + box.height; y += 0.5) {
    const event = eventAt(layout, box.x + box.width / 2, y);
    if (event.anchor === column) return event;
  }
  throw new Error('the column is covered everywhere');
}

const click = (event: ScorePointerEvent, shift = false): Gesture => ({
  kind: 'click',
  event,
  shift,
});

describe('the edit pointer', () => {
  it('places the cursor on the clicked note, picks it and makes its track current', async () => {
    const { score, layout, handle, state } = await setup();
    const { x, y, note } = centreOfNote(layout, score, 1, 0, 2);
    expect(handle(layout, click(eventAt(layout, x, y)))).toBe(true);
    expect(state().cursor).toMatchObject({
      track: score.tracks[1]?.id,
      beat: score.tracks[1]?.bars[0]?.voices[0]?.beats[2]?.id,
      at: { track: 1, bar: 0, beat: 2 },
    });
    expect(state().selection).toEqual({ noteIds: [note.id] });
    expect(state().currentTrack).toBe(score.tracks[1]?.id);
    expect(state().range).toBeUndefined();
  });

  it('toggles a note in the picked set with Cmd or Ctrl, keeping the others', async () => {
    const { score, layout, handle, state } = await setup();
    const a = centreOfNote(layout, score, 0, 0, 0);
    const b = centreOfNote(layout, score, 0, 0, 1);
    handle(layout, click(eventAt(layout, a.x, a.y)));
    handle(layout, click(eventAt(layout, b.x, b.y, { ctrlKey: true })));
    expect(state().selection).toEqual({ noteIds: [a.note.id, b.note.id] });
    handle(layout, click(eventAt(layout, a.x, a.y, { metaKey: true })));
    expect(state().selection).toEqual({ noteIds: [b.note.id] });
  });

  it('extends a beat range from the cursor with Shift+click', async () => {
    const { score, layout, handle, state } = await setup();
    const a = centreOfNote(layout, score, 0, 0, 0);
    const b = centreOfNote(layout, score, 0, 0, 3);
    handle(layout, click(eventAt(layout, a.x, a.y)));
    handle(layout, click(eventAt(layout, b.x, b.y), true));
    expect(state().range).toMatchObject({
      kind: 'beats',
      anchor: { beat: score.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id },
      focus: { beat: score.tracks[0]?.bars[0]?.voices[0]?.beats[3]?.id },
    });
    expect(state().bars).toEqual({
      startBar: score.masterBars[0]?.id,
      endBar: score.masterBars[0]?.id,
    });
    expect(state().cursor?.at.beat).toBe(3);
  });

  it('previews a drag across tracks, ends it with true, and restores on cancel', async () => {
    const { score, layout, handle, state } = await setup();
    const a = centreOfNote(layout, score, 0, 0, 0);
    const b = centreOfNote(layout, score, 1, 0, 2);
    const from = eventAt(layout, a.x, a.y);
    const to = eventAt(layout, b.x, b.y);
    handle(layout, click(eventAt(layout, a.x, a.y)));
    const placed = state().cursor;
    expect(handle(layout, { kind: 'area', from, to, done: false })).toBe(false);
    expect(state().range).toMatchObject({
      kind: 'beats',
      anchor: { track: score.tracks[0]?.id },
      focus: { track: score.tracks[1]?.id },
    });
    handle(layout, { kind: 'cancel' });
    expect(state().range).toBeUndefined();
    expect(state().cursor).toEqual(placed);

    handle(layout, { kind: 'area', from, to, done: false });
    expect(handle(layout, { kind: 'area', from, to, done: true })).toBe(true);
    expect(state().range?.focus.track).toBe(score.tracks[1]?.id);
    handle(layout, { kind: 'cancel' });
    expect(state().range).toBeDefined();
  });

  it('takes whole bars for a press on a column area with no track', async () => {
    const { score, layout, handle, state } = await setup();
    const column = layout.anchors.find(
      (a) => a.kind === 'bar' && a.track === undefined && a.masterBar === score.masterBars[1]?.id,
    );
    if (!column) throw new Error('no column');
    const event = columnPress(layout, column);
    handle(layout, click(event));
    expect(state().range).toMatchObject({
      kind: 'bars',
      anchor: { masterBar: score.masterBars[1]?.id, beat: undefined },
    });
    expect(state().cursor?.masterBar).toBe(score.masterBars[1]?.id);
    const later = layout.anchors.find(
      (a) => a.kind === 'bar' && a.track === undefined && a.masterBar === score.masterBars[2]?.id,
    );
    if (!later) throw new Error('no later column');
    handle(layout, click(columnPress(layout, later), true));
    expect(state().range).toMatchObject({
      kind: 'bars',
      focus: { masterBar: score.masterBars[2]?.id },
    });
  });

  it('takes the nearest column in a margin, and does nothing where there is none', async () => {
    const { layout, handle, state } = await setup();
    expect(handle(layout, click(eventAt(layout, 1, 1)))).toBe(true);
    expect(state().cursor).toBeDefined();
    const none: ScorePointerEvent = {
      ...eventAt(layout, 1, 1),
      anchor: undefined,
      column: undefined,
    };
    state().setEdit({ cursor: undefined });
    expect(handle(layout, click(none))).toBe(false);
    expect(state().cursor).toBeUndefined();
  });

  it('places the cursor like a plain click for a right-click, without a gesture', async () => {
    const { score, layout, handle, state } = await setup();
    const { x, y, note } = centreOfNote(layout, score, 1, 0, 2);
    const { point, anchor, column } = eventAt(layout, x, y);
    expect(handle.placeAt(layout, { point, anchor, column })).toBe(true);
    expect(state().cursor).toMatchObject({ at: { track: 1, bar: 0, beat: 2 } });
    expect(state().selection.noteIds).toEqual([note.id]);
  });
});
