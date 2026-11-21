import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cursorAtPosition } from '@/features/editor/cursor';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { ChordsPanel } from './chords-panel';
import { STRUM_STAGGER_MS } from './strum';

function song(capo = 0) {
  const built = score().track('guitar', { capo });
  built
    .bar()
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)], { chord: { name: 'G' } })
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)]);
  return built.build({ ids: 'sequential' });
}

async function setup(options: { capo?: number; editing?: boolean; name?: string } = {}) {
  const services = createTestServices();
  const built = song(options.capo);
  await services.document
    .getState()
    .openBytes('chords.reprise', (await write(built, 'reprise')).bytes);
  const opened = services.document.getState().score;
  if (!opened) throw new Error('no score');
  const cursor = cursorAtPosition(
    opened,
    { track: 0, bar: 0, voice: 0, stop: 3 },
    { string: 1, staff: 'tab' },
  );
  act(() => {
    services.selection.getState().setEdit({ currentTrack: opened.tracks[0]?.id, cursor });
    services.editing.getState().setEditing(options.editing ?? false);
    services.ui.getState().setChordsName(options.name ?? 'Am');
  });
  renderWithServices(<ChordsPanel />, services);
  return { services, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) };
}

const cards = () =>
  screen.getAllByRole('button').filter((b) => /position/.test(b.getAttribute('aria-label') ?? ''));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the Chords panel', () => {
  it('lists Am shapes with the open one first, marked as suggestions', async () => {
    await setup();
    expect(cards()[0]?.getAttribute('aria-label')).toBe(
      'Am, open position: x 0 2 2 1 0, suggestion',
    );
    expect(screen.getAllByText('Suggestion').length).toBeGreaterThan(1);
  });

  it('says so for a name it does not know and for a track with no frets', async () => {
    await setup({ name: 'Cfoo' });
    expect(screen.getByText('No shapes for this chord name')).toBeTruthy();
  });

  it('asks for a fretted track on a drum track', async () => {
    const services = createTestServices();
    const built = score().track('drums');
    built.bar().beat('4', [note(0, 36)]);
    await services.document
      .getState()
      .openBytes(
        'drums.reprise',
        (await write(built.build({ ids: 'sequential' }), 'reprise')).bytes,
      );
    act(() => {
      services.ui.getState().setChordsName('Am');
    });
    renderWithServices(<ChordsPanel />, services);
    expect(screen.getByText('Chord shapes need a fretted track')).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('names the capo', async () => {
    await setup({ capo: 2 });
    expect(screen.getByText(/capo 2/)).toBeTruthy();
  });

  it('strums one previewNote per sounding string, lowest pitch first', async () => {
    const { services, user } = await setup();
    await user.click(cards()[0] as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(STRUM_STAGGER_MS * 8);
    });
    const calls = services.fakeAudio.previewNote.mock.calls.map((call) => call[1]);
    // x02210 stored string 1 first: strings 2, 3, 4, 5 sound, low pitch first is 5, 4, 3, 2... plus open 1.
    expect(calls.map((c) => (c as { string: number }).string)).toEqual([5, 4, 3, 2, 1]);
  });

  it('hides the write buttons in play mode', async () => {
    await setup({ editing: false });
    expect(screen.queryByRole('button', { name: 'Use this shape' })).toBeNull();
  });

  it('writes the shape to the cursor beat as one undo step', async () => {
    const { services, user } = await setup({ editing: true });
    await user.click(screen.getByRole('button', { name: 'Use this shape' }));
    const track = services.document.getState().score?.tracks[0];
    const beat = track?.bars[0]?.voices[0]?.beats[3];
    expect(beat?.chord).toMatchObject({ name: 'Am', diagram: { frets: [0, 1, 2, 2, 0, null] } });
    expect(services.document.getState().historyLabels.undo.at(-1)).toBe('Chord diagram');
    act(() => {
      services.document.getState().undo();
    });
    expect(
      services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats[3]?.chord,
    ).toBeUndefined();
  });

  it('writes the shape to every beat of that name as one undo step', async () => {
    const { services, user } = await setup({ editing: true });
    await user.click(screen.getByRole('button', { name: 'Use for every Am in this track' }));
    const beats = services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
    expect(beats[0]?.chord?.diagram).toBeDefined();
    expect(beats[2]?.chord?.diagram).toBeDefined();
    expect(beats[1]?.chord?.diagram).toBeUndefined();
    expect(services.document.getState().historyLabels.undo).toHaveLength(1);
    act(() => {
      services.document.getState().undo();
    });
    const undone = services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
    expect(undone[0]?.chord?.diagram).toBeUndefined();
  });
});
