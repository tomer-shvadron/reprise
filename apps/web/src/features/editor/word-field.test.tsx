import { write } from '@reprise/formats';
import { setTrackProperties, type Score } from '@reprise/model';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { useAppServices } from '@/app/services-context';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { ScoreView } from '@/features/score';
import { stubViewport } from '@/features/score/test/viewport-stub';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { must } from './test/must';
import { wordScore } from './test/word-scores';
import { WordField } from './word-field';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

function Stage() {
  const { layout } = useAppServices();
  const result = useStore(layout, (state) => state.result);
  if (!result) return null;
  return (
    <ScoreView layout={result} zoom={1} label="Score: words">
      <WordField />
    </ScoreView>
  );
}

let off: (() => void) | undefined;
afterEach(() => {
  off?.();
  off = undefined;
  cleanup();
});

async function setup(built: Score = wordScore()) {
  stubViewport(1280, 800);
  const services = createTestServices();
  const registry = createAppRegistry(services);
  off = installShortcutDispatcher(window, registry, 'other');
  renderWithServices(<Stage />, services);
  await act(async () => {
    await services.document
      .getState()
      .openBytes('words.reprise', (await write(built, 'reprise')).bytes);
  });
  act(() => {
    services.editing.getState().setEditing(true);
  });
  const score = () => must(services.document.getState().score);
  const beat = (bar: number, index: number) =>
    must(score().tracks[0]?.bars[bar]?.voices[0]?.beats[index]);
  const goTo = (bar: number, stop: number) => {
    const cursor = must(
      cursorAtPosition(score(), { track: 0, bar, voice: 0, stop }, { string: 1, staff: 'tab' }),
    );
    act(() => {
      services.selection.getState().setEdit({ cursor, currentTrack: cursor.track });
    });
  };
  const press = (key: string, init: KeyboardEventInit = {}) => {
    // The window sees what bubbles from the focused element, as in the app.
    const target = document.activeElement ?? document.body;
    act(() => {
      fireEvent.keyDown(target, { key, ...init });
    });
  };
  const field = () => {
    const found = document.querySelector('input');
    if (!found) throw new Error('the field is not open');
    return found;
  };
  const type = (value: string) => {
    fireEvent.change(field(), { target: { value } });
  };
  // The undo labels, oldest first.
  const steps = () => [...services.document.getState().historyLabels.undo].reverse();
  return { services, score, beat, goTo, press, field, type, steps };
}

describe('the word field', () => {
  it('opens on A over the beat, showing its chord name, and focuses', async () => {
    const t = await setup();
    t.goTo(1, 0);
    t.press('a');
    expect(t.field().getAttribute('aria-label')).toBe('Chord name, bar 2 beat 1');
    expect(t.field().value).toBe('Am');
    expect(document.activeElement).toBe(t.field());
  });

  it('commits a chord name and advances on Tab as one undo step', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('a');
    t.type('Am7');
    t.press('Tab');
    expect(t.beat(0, 0).chord?.name).toBe('Am7');
    expect(t.steps()).toEqual(['Chord name']);
    expect(t.field().getAttribute('aria-label')).toBe('Chord name, bar 1 beat 2');
    expect(t.services.selection.getState().cursor?.at).toMatchObject({ bar: 0, beat: 1 });
    t.type('G');
    t.press('Tab', { shiftKey: true });
    expect(t.steps()).toEqual(['Chord name', 'Chord name']);
    expect(t.field().getAttribute('aria-label')).toBe('Chord name, bar 1 beat 1');
    act(() => {
      t.services.document.getState().undo();
    });
    expect(t.beat(0, 1).chord).toBeUndefined();
    expect(t.beat(0, 0).chord?.name).toBe('Am7');
  });

  it('keeps its keys: typing s or p does not toggle a slide or a mute', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('a');
    const before = t.score();
    t.press('s');
    t.press('p');
    expect(t.score()).toBe(before);
    expect(t.services.entry.getState().word).toBeDefined();
  });

  it('cancels on Escape and leaves the score alone', async () => {
    const t = await setup();
    t.goTo(0, 0);
    const before = t.score();
    t.press('t');
    expect(t.field().getAttribute('aria-label')).toContain('Text');
    t.type('rit.');
    t.press('Escape');
    expect(t.services.entry.getState().word).toBeUndefined();
    expect(t.score()).toBe(before);
    expect(document.querySelector('input')).toBeNull();
  });

  it('commits on Enter and closes, and on blur', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('t');
    t.type('rit.');
    t.press('Enter');
    expect(t.beat(0, 0).text).toBe('rit.');
    expect(document.querySelector('input')).toBeNull();
    t.goTo(0, 1);
    t.press('t');
    t.type('a tempo');
    act(() => {
      fireEvent.blur(t.field());
    });
    expect(t.beat(0, 1).text).toBe('a tempo');
    expect(document.querySelector('input')).toBeNull();
  });

  it('suggests the song chords and takes one with the arrows and Enter', async () => {
    const t = await setup();
    t.goTo(1, 1);
    t.press('a');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Am']);
    t.press('ArrowDown');
    t.press('Enter');
    expect(t.beat(1, 1).chord?.name).toBe('Am');
  });

  it('removes a chord and its diagram when the name is emptied, with a notice', async () => {
    const t = await setup();
    t.goTo(1, 0);
    t.press('a');
    t.type('');
    t.press('Enter');
    expect(t.beat(1, 0).chord).toBeUndefined();
    expect(t.services.entry.getState()).toMatchObject({
      message: 'Chord diagram removed',
      tone: 'notice',
    });
  });

  it('does nothing outside edit mode', async () => {
    const t = await setup();
    act(() => {
      t.services.editing.getState().setEditing(false);
    });
    t.goTo(0, 0);
    t.press('a');
    expect(t.services.entry.getState().word).toBeUndefined();
  });
});

describe('the lyrics field', () => {
  it('enters a verse with space and hyphen, skipping the rest, one undo step per beat', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('l', { altKey: true });
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 1, bar 1 beat 1');
    t.type('Twin');
    t.press('-');
    t.type('kle');
    t.press(' ');
    t.type('twin');
    t.press('-');
    t.type('kle');
    t.press(' ');
    expect(t.beat(0, 0).lyrics).toEqual(['Twin-']);
    expect(t.beat(0, 1).lyrics).toEqual(['kle']);
    expect(t.beat(0, 2).lyrics).toBeUndefined();
    expect(t.beat(0, 3).lyrics).toBeUndefined();
    expect(t.beat(1, 0).lyrics).toEqual(['twin-']);
    expect(t.beat(1, 1).lyrics).toEqual(['kle']);
    expect(t.steps()).toEqual(['Lyrics', 'Lyrics', 'Lyrics', 'Lyrics']);
  });

  it('leaves a beat empty on Space in an empty field, and steps back on Backspace', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('l', { altKey: true });
    t.press(' ');
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 1, bar 1 beat 2');
    expect(t.beat(0, 0).lyrics).toBeUndefined();
    t.press('Backspace');
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 1, bar 1 beat 1');
  });

  it('switches among the five lines with the arrows and reopens on the last one', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('l', { altKey: true });
    t.type('one');
    t.press('ArrowDown');
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 2, bar 1 beat 1');
    t.type('uno');
    for (let i = 0; i < 5; i++) t.press('ArrowDown');
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 5, bar 1 beat 1');
    t.press('ArrowUp');
    expect(t.beat(0, 0).lyrics).toEqual(['one', 'uno']);
    t.press('Escape');
    t.goTo(0, 1);
    t.press('l', { altKey: true });
    expect(t.field().getAttribute('aria-label')).toBe('Lyrics line 4, bar 1 beat 2');
  });

  it('lets Shift+Space type a space inside a syllable', async () => {
    const t = await setup();
    t.goTo(0, 0);
    t.press('l', { altKey: true });
    t.type('la la');
    t.press(' ', { shiftKey: true });
    expect(t.services.entry.getState().word?.draft).toBe('la la');
    expect(t.beat(0, 0).lyrics).toBeUndefined();
  });

  it('clears the raw Track.lyrics block with the first edit', async () => {
    const t = await setup();
    const trackId = must(t.score().tracks[0]).id;
    act(() => {
      t.services.document
        .getState()
        .apply(setTrackProperties({ trackId }, { lyrics: [{ startBar: 0, text: 'old' }] }));
    });
    expect(t.score().tracks[0]?.lyrics).toHaveLength(1);
    t.goTo(0, 0);
    t.press('l', { altKey: true });
    t.type('new');
    t.press('Enter');
    expect(t.score().tracks[0]?.lyrics).toEqual([]);
    expect(t.beat(0, 0).lyrics).toEqual(['new']);
  });

  it('opens on the next played beat when the cursor is on a rest', async () => {
    const t = await setup();
    t.goTo(0, 2);
    // The cursor sits on the rest, so the field opens on the next played beat.
    t.press('l', { altKey: true });
    expect(t.services.entry.getState().word?.beatId).toBe(t.beat(1, 0).id);
    t.press('Escape');
  });
});
