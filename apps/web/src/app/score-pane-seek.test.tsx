import { act, fireEvent, screen } from '@testing-library/react';
import { write } from '@reprise/formats';
import type { Anchor, LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { positionEventAt } from '@/test/position';
import { createTestServices } from '@/test/services';

import { ScorePane } from './score-pane';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

const BAR = 3840;

/** Bars 1 and 2 repeated, then 14 more: 1 2 1 2 3 … 16, over several systems. */
function song(): Score {
  const builder = score().title('Seek').track('guitar');
  for (let bar = 0; bar < 16; bar++) {
    builder.bar();
    if (bar === 0) builder.repeatStart();
    if (bar === 1) builder.repeatEnd(2);
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, (bar + beat) % 12)]);
  }
  return builder.build();
}

async function setup() {
  stubViewport(1280, 800);
  const services = createTestServices();
  mirrorAudio(services);
  renderWithServices(<ScorePane hint={null} />, services);
  await act(async () => {
    await services.document
      .getState()
      .openBytes('seek.reprise', (await write(song(), 'reprise')).bytes);
  });
  const opened = services.document.getState().score;
  const result = services.layout.getState().result;
  if (!opened || !result) throw new Error('not open');
  return { services, score: opened, result };
}

function canvas(): HTMLElement {
  const found = screen
    .getByRole('region', { name: 'Score: Seek' })
    .querySelector<HTMLElement>('.score-canvas');
  if (!found) throw new Error('no canvas');
  return found;
}

const centreOf = (anchor: Anchor) => ({
  clientX: anchor.bbox.x + anchor.bbox.width / 2,
  clientY: anchor.bbox.y + anchor.bbox.height / 2,
});

function beatAnchor(result: LayoutResult, masterBar: string, index: number): Anchor {
  const found = result.anchors
    .filter((anchor) => anchor.kind === 'beat' && anchor.masterBar === masterBar)
    .sort((a, b) => a.bbox.x - b.bbox.x)[index];
  if (!found) throw new Error('no beat anchor');
  return found;
}

function click(at: { clientX: number; clientY: number }, shiftKey = false) {
  fireEvent.pointerDown(canvas(), { ...at, button: 0, shiftKey });
  fireEvent.pointerUp(canvas(), { ...at, button: 0, shiftKey });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('click to seek', () => {
  it('seeks to a beat, keeps its bar as the anchor and makes its track current', async () => {
    const { services, score: opened, result } = await setup();
    const bar3 = opened.masterBars[2]?.id ?? '';
    const beat = beatAnchor(result, bar3, 2);
    click(centreOf(beat));
    // Bar 3 is the fifth pass: 1 2 1 2 3.
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(4 * BAR + 1920);
    expect(services.selection.getState()).toMatchObject({
      bars: undefined,
      barsAnchor: bar3,
      currentTrack: beat.track,
    });
    expect(services.ui.getState().follow.request).toBeGreaterThan(0);
  });

  it('stays in the repeat’s current time through', async () => {
    const { services, score: opened, result } = await setup();
    const bar1 = opened.masterBars[0]?.id ?? '';
    act(() => {
      services.playback.setState({ position: positionEventAt(opened, BAR + 100) });
    });
    click(centreOf(beatAnchor(result, bar1, 0)));
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(0);

    act(() => {
      services.playback.setState({ position: positionEventAt(opened, 3 * BAR + 100) });
    });
    click(centreOf(beatAnchor(result, bar1, 0)));
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(2 * BAR);
  });

  it('seeks to the nearer system’s nearest bar from the gap between systems', async () => {
    const { services, score: opened, result } = await setup();
    const [s0, s1] = result.systems;
    if (!s0 || !s1) throw new Error('two systems expected');
    const bottom = s0.bbox.y + s0.bbox.height;
    click({ clientX: s1.bbox.x + 2, clientY: bottom + (s1.bbox.y - bottom) * 0.75 });
    const index = s1.bars.start;
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith((index + 2) * BAR);
    expect(services.selection.getState().barsAnchor).toBe(opened.masterBars[index]?.id);
  });

  it('selects with Shift+click and by dragging, without seeking', async () => {
    const { services, score: opened, result } = await setup();
    const id = (index: number) => opened.masterBars[index]?.id ?? '';
    click(centreOf(beatAnchor(result, id(1), 0)));
    services.fakeAudio.seek.mockClear();
    click(centreOf(beatAnchor(result, id(3), 0)), true);
    expect(services.selection.getState().bars).toEqual({ startBar: id(1), endBar: id(3) });

    const from = centreOf(beatAnchor(result, id(4), 0));
    const to = centreOf(beatAnchor(result, id(5), 1));
    fireEvent.pointerDown(canvas(), { ...from, button: 0 });
    fireEvent.pointerMove(canvas(), { ...from, clientX: from.clientX + 10 });
    fireEvent.pointerMove(canvas(), to);
    expect(document.querySelectorAll('.score-selection')).toHaveLength(2);
    expect(services.selection.getState().bars).toEqual({ startBar: id(1), endBar: id(3) });
    fireEvent.pointerUp(canvas(), to);
    expect(services.selection.getState()).toMatchObject({
      bars: { startBar: id(4), endBar: id(5) },
      barsAnchor: id(4),
    });

    fireEvent.pointerDown(canvas(), { ...from, button: 0 });
    fireEvent.pointerMove(canvas(), to);
    fireEvent.pointerCancel(canvas(), to);
    expect(document.querySelectorAll('.score-selection')).toHaveLength(2);
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
  });

  it('draws the loop, keeps it on a click inside and turns it off on a click outside', async () => {
    const { services, score: opened, result } = await setup();
    const id = (index: number) => opened.masterBars[index]?.id ?? '';
    act(() => {
      services.audio.setLoop({ startBar: id(4), endBar: id(5) });
    });
    expect(document.querySelectorAll('.score-loop')).toHaveLength(2);

    click(centreOf(beatAnchor(result, id(5), 0)));
    expect(services.playback.getState().settings.loop).toBeDefined();
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(7 * BAR);

    click(centreOf(beatAnchor(result, id(8), 0)));
    expect(services.playback.getState().settings.loop).toBeUndefined();
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(10 * BAR);
    expect(document.querySelectorAll('.score-loop')).toHaveLength(0);
  });

  it('offers Follow playback only while playing with following paused', async () => {
    const { services } = await setup();
    expect(screen.queryByRole('button', { name: 'Follow playback' })).toBeNull();
    act(() => {
      services.playback.setState({ transport: 'playing' });
      services.ui.getState().pauseFollow();
    });
    const button = screen.getByRole('button', { name: 'Follow playback' });
    const request = services.ui.getState().follow.request;
    fireEvent.click(button);
    expect(services.ui.getState().follow).toEqual({ on: true, request: request + 1 });
    expect(screen.queryByRole('button', { name: 'Follow playback' })).toBeNull();
  });
});
