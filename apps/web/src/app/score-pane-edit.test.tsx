import { write } from '@reprise/formats';
import type { Anchor, LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { editScore } from '@/features/editor/test/scores';
import { stubViewport } from '@/features/score/test/viewport-stub';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { ScorePane } from './score-pane';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

const BAR = 3840;

async function setup() {
  stubViewport(1280, 800);
  const services = createTestServices();
  mirrorAudio(services);
  renderWithServices(<ScorePane hint={null} />, services);
  const built: Score = { ...editScore(), meta: { ...editScore().meta, title: 'Edit' } };
  await act(async () => {
    await services.document
      .getState()
      .openBytes('edit.reprise', (await write(built, 'reprise')).bytes);
  });
  const opened = services.document.getState().score;
  const result = services.layout.getState().result;
  if (!opened || !result) throw new Error('not open');
  const canvas = () => {
    const found = screen
      .getByRole('region', { name: 'Score: Edit' })
      .querySelector<HTMLElement>('.score-canvas');
    if (!found) throw new Error('no canvas');
    return found;
  };
  return { services, score: opened, result, canvas };
}

const noteAt = (result: LayoutResult, score: Score, track: number, bar: number, beat: number) => {
  const id = score.tracks[track]?.bars[bar]?.voices[0]?.beats[beat]?.notes[0]?.id;
  const anchor: Anchor | undefined = result.anchors.find((a) => a.kind === 'note' && a.id === id);
  if (!anchor) throw new Error('no note anchor');
  return {
    clientX: anchor.bbox.x + anchor.bbox.width / 2,
    clientY: anchor.bbox.y + anchor.bbox.height / 2,
    button: 0,
  };
};

describe('the score pane in edit mode', () => {
  it('places the cursor on a clicked note and seeks a stopped playhead to it', async () => {
    const { services, score, result, canvas } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const at = noteAt(result, score, 0, 1, 1);
    fireEvent.pointerDown(canvas(), at);
    fireEvent.pointerUp(canvas(), at);
    expect(services.selection.getState().cursor).toMatchObject({
      track: score.tracks[0]?.id,
      at: { bar: 1, beat: 1 },
    });
    expect(services.selection.getState().selection.noteIds).toHaveLength(1);
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(BAR + 960);
    expect(document.querySelectorAll('.score-caret').length).toBeGreaterThan(0);
  });

  it('does not seek on a Shift+click, which extends a range drawn as boxes', async () => {
    const { services, score, result, canvas } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const first = noteAt(result, score, 0, 0, 0);
    fireEvent.pointerDown(canvas(), first);
    fireEvent.pointerUp(canvas(), first);
    services.fakeAudio.seek.mockClear();
    const second = noteAt(result, score, 0, 0, 3);
    fireEvent.pointerDown(canvas(), { ...second, shiftKey: true });
    fireEvent.pointerUp(canvas(), { ...second, shiftKey: true });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.selection.getState().range?.kind).toBe('beats');
    expect(document.querySelectorAll('.score-range')).toHaveLength(1);
    expect(document.querySelectorAll('.score-selection')).toHaveLength(0);
  });

  it('keeps click-to-seek and bar selection in play mode, with no caret', async () => {
    const { services, score, result, canvas } = await setup();
    const at = noteAt(result, score, 0, 1, 1);
    fireEvent.pointerDown(canvas(), at);
    fireEvent.pointerUp(canvas(), at);
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(BAR + 960);
    expect(services.selection.getState().cursor).toBeUndefined();
    expect(document.querySelectorAll('.score-caret')).toHaveLength(0);
  });

  it('seeks only on a plain click: not on Cmd or Ctrl+click, which toggle a note', async () => {
    const { services, score, result, canvas } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const at = noteAt(result, score, 0, 1, 1);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      fireEvent.pointerDown(canvas(), { ...at, ...modifier });
      fireEvent.pointerUp(canvas(), { ...at, ...modifier });
    }
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.selection.getState().cursor?.at.bar).toBe(1);
    // Two toggles of one note: picked, then unpicked.
    expect(services.selection.getState().selection.noteIds).toEqual([]);
  });

  it('never turns off a loop: inside it seeks, outside it moves the cursor only', async () => {
    const { services, score, result, canvas } = await setup();
    const id = (i: number) => score.masterBars[i]?.id ?? '';
    act(() => {
      services.audio.setLoop({ startBar: id(0), endBar: id(0) });
      services.editing.getState().setEditing(true);
    });
    const outside = noteAt(result, score, 0, 1, 1);
    fireEvent.pointerDown(canvas(), outside);
    fireEvent.pointerUp(canvas(), outside);
    expect(services.playback.getState().settings.loop).toBeDefined();
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.selection.getState().cursor?.at.bar).toBe(1);

    const inside = noteAt(result, score, 0, 0, 2);
    fireEvent.pointerDown(canvas(), inside);
    fireEvent.pointerUp(canvas(), inside);
    expect(services.playback.getState().settings.loop).toBeDefined();
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(1920);
  });

  it('clears the range on leaving edit mode, so a play-mode drag previews its bars', async () => {
    const { services, score, result, canvas } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const a = noteAt(result, score, 0, 0, 0);
    const b = noteAt(result, score, 0, 0, 3);
    fireEvent.pointerDown(canvas(), a);
    fireEvent.pointerUp(canvas(), a);
    fireEvent.pointerDown(canvas(), { ...b, shiftKey: true });
    fireEvent.pointerUp(canvas(), { ...b, shiftKey: true });
    expect(services.selection.getState().range).toBeDefined();
    act(() => {
      services.editing.getState().setEditing(false);
    });
    expect(services.selection.getState().range).toBeUndefined();
    expect(document.querySelectorAll('.score-range')).toHaveLength(0);

    // A range left in the store (as by another writer) must not hide the drag preview.
    act(() => {
      services.selection.getState().setEdit({
        range: {
          kind: 'bars',
          anchor: {
            track: score.tracks[0]?.id ?? '',
            masterBar: score.masterBars[0]?.id ?? '',
            beat: undefined,
          },
          focus: {
            track: score.tracks[0]?.id ?? '',
            masterBar: score.masterBars[0]?.id ?? '',
            beat: undefined,
          },
        },
      });
    });
    const from = noteAt(result, score, 0, 0, 0);
    const to = noteAt(result, score, 0, 1, 0);
    fireEvent.pointerDown(canvas(), from);
    fireEvent.pointerMove(canvas(), { ...from, clientX: from.clientX + 10 });
    fireEvent.pointerMove(canvas(), to);
    expect(document.querySelectorAll('.score-selection').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.score-range')).toHaveLength(0);
  });
});
