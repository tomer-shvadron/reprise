import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { analyseScore } from '@/lib/insights';
import { positionEventAt } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { insightsFor } from '../insights/insights-for';

import { arpeggioOverlayFor } from './arpeggio-overlay';
import { Fretboard } from './fretboard';
import { geometryOf } from './fretboard-geometry';
import { scaleOverlayFor } from './scale-overlay';

afterEach(() => {
  window.localStorage.clear();
});

const BAR = 3840;

/** Four bars of quarter notes with Am, F, C, G written over their first beats, then a fifth with none. */
function chords(names: (string | undefined)[] = ['Am', 'F', 'C', 'G', undefined]): Score {
  const builder = score().tempo(120).track('guitar');
  for (const name of names) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) {
      builder.beat('4', [note(1, 5)], beat === 0 && name ? { chord: { name } } : {});
    }
  }
  return builder.build();
}

async function open(built: Score) {
  const services = createTestServices();
  insightsFor(services, {
    client: {
      analyse: (current) => Promise.resolve(analyseScore(current)),
      dispose: () => undefined,
    },
  });
  const result = renderWithServices(<Fretboard />, services);
  const { bytes } = await write(built, 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const at = (playbackTick: number) => {
    const current = services.document.getState().score;
    if (!current) throw new Error('no score');
    act(() => {
      services.playback.setState({ position: positionEventAt(current, playbackTick) });
    });
  };
  at(0);
  return { ...result, services, at, store: arpeggioOverlayFor(services) };
}

const layer = () => document.querySelector('[data-fretboard-arpeggio]');
const chip = () => document.querySelector('[data-arpeggio-chip]')?.textContent ?? '';
const labels = () =>
  [...document.querySelectorAll('[data-fretboard-arpeggio] [data-arpeggio-tone]')].map((g) =>
    g.getAttribute('data-arpeggio-tone'),
  );

describe('Fretboard arpeggio overlay', () => {
  it('draws nothing and no chip while off', async () => {
    await open(chords());
    expect(layer()).toBeNull();
    expect(chip()).toBe('');
  });

  it('holds a chord: degree labels, an accessible name, and the root ringed heavier', async () => {
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('Am7');
    });
    expect(layer()?.getAttribute('aria-label')).toBe('Am7 chord tones: A R, C ♭3, E 5, G ♭7');
    expect(new Set(labels())).toEqual(new Set(['R', '♭3', '5', '♭7']));
    expect(document.querySelectorAll('[data-arpeggio-root]').length).toBeGreaterThan(0);
    expect(chip()).toContain('Arpeggio: Am7 · held');
  });

  it('switches the labels to note names', async () => {
    const user = userEvent.setup();
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('Bb7');
    });
    await user.click(screen.getByRole('button', { name: 'Choose an arpeggio' }));
    const picker = within(screen.getByRole('dialog', { name: 'Arpeggio tool' }));
    await user.click(picker.getByRole('button', { name: 'Notes' }));
    expect(new Set(labels())).toEqual(new Set(['R', '3', '5', '♭7']));
    const names = [...document.querySelectorAll('[data-fretboard-arpeggio] text')].map(
      (text) => text.textContent,
    );
    expect(new Set(names)).toEqual(new Set(['B♭', 'D', 'F', 'A♭']));
  });

  it('says so for a chord it does not recognise', async () => {
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('C7alt');
    });
    expect(chip()).toContain('Arpeggio: C7alt not recognised');
    expect(layer()).toBeNull();
  });

  it('asks for a pick when held with nothing picked', async () => {
    const { store } = await open(chords());
    act(() => {
      store.getState().turnOn();
      store.getState().setFollow(false);
    });
    expect(chip()).toContain('Arpeggio: pick a chord');
  });

  it('sits between the scale and the lit notes, with a dashed ring outside the scale', async () => {
    const { services, store } = await open(chords());
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
      store.getState().hold('E7');
    });
    const order = [...document.querySelectorAll('[data-fretboard] > g')].map((g) =>
      g.hasAttribute('data-fretboard-scale')
        ? 'scale'
        : g.hasAttribute('data-fretboard-arpeggio')
          ? 'arpeggio'
          : g.hasAttribute('data-fretboard-notes')
            ? 'notes'
            : 'board',
    );
    expect(order).toEqual(['board', 'scale', 'arpeggio', 'notes']);
    // G♯ is E7's third and no A minor pentatonic note.
    const outside = document.querySelectorAll('[data-outside-scale]');
    expect(outside.length).toBeGreaterThan(0);
    for (const ring of outside) expect(ring.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(document.querySelectorAll('[data-arpeggio-root]:not([data-outside-scale])').length).toBe(
      document.querySelectorAll('[data-arpeggio-root]').length,
    );
  });

  it('marks no ring as outside the scale when no scale is on', async () => {
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('E7');
    });
    expect(document.querySelectorAll('[data-outside-scale]')).toHaveLength(0);
  });

  it('follows the song chords through the position, and renders only on a change', async () => {
    const { store, at } = await open(chords());
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: Am');
    });
    const first = layer();
    let writes = 0;
    store.subscribe(() => {
      writes++;
    });
    at(1000);
    expect(layer()).toBe(first);
    expect(first?.querySelector('[data-arpeggio-tone]')).not.toBeNull();
    const node = first?.querySelector('[data-arpeggio-tone]');
    at(2000);
    expect(layer()?.querySelector('[data-arpeggio-tone]')).toBe(node);
    // Frames inside one chord write nothing to the store.
    expect(writes).toBe(0);
    at(BAR);
    expect(writes).toBe(1);
    expect(chip()).toBe('Arpeggio: F');
    expect(layer()?.getAttribute('aria-label')).toMatch(/^F chord tones/);
    at(3 * BAR + 100);
    expect(chip()).toBe('Arpeggio: G');
  });

  it('says there is no chord past the hold', async () => {
    const { store, at } = await open(
      chords([
        'Am',
        'F',
        'C',
        'G',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]),
    );
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: Am');
    });
    at(12 * BAR);
    expect(chip()).toBe('Arpeggio: no chord here');
    expect(layer()).toBeNull();
  });

  it('says so when the song has no chords', async () => {
    const { store } = await open(chords([undefined, undefined]));
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: no chords in this song');
    });
  });

  it('shows the chord of the edit cursor beat in edit mode', async () => {
    const { services, store } = await open(chords());
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: Am');
    });
    const current = services.document.getState().score;
    const track = current?.tracks[0];
    const masterBar = current?.masterBars[2];
    const beat = track?.bars[2]?.voices[0].beats[1];
    if (!track || !masterBar || !beat) throw new Error('score');
    act(() => {
      services.editing.getState().setEditing(true);
      services.selection.getState().setEdit({
        cursor: {
          track: track.id,
          masterBar: masterBar.id,
          voice: 0,
          beat: beat.id,
          string: 1,
          staff: 'tab',
          at: { track: 0, bar: 2, beat: 1 },
        },
      });
    });
    expect(chip()).toBe('Arpeggio: C');
  });

  it('turning follow off keeps the chord on the neck', async () => {
    const user = userEvent.setup();
    const { store, at } = await open(chords());
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: Am');
    });
    await user.click(screen.getByRole('button', { name: 'Choose an arpeggio' }));
    const picker = within(screen.getByRole('dialog', { name: 'Arpeggio tool' }));
    await user.click(picker.getByRole('switch', { name: 'Follow chord changes' }));
    at(BAR);
    expect(chip()).toBe('Arpeggio: Am · held');
  });

  it('picks a root and quality from the header, which holds it', async () => {
    const user = userEvent.setup();
    const { store } = await open(chords());
    await user.click(screen.getByRole('button', { name: 'Choose an arpeggio' }));
    const picker = within(screen.getByRole('dialog', { name: 'Arpeggio tool' }));
    await user.click(picker.getByRole('button', { name: 'F♯' }));
    await user.click(picker.getByRole('button', { name: 'm7♭5' }));
    expect(store.getState()).toMatchObject({ on: true, follow: false, held: 'F#m7b5' });
    expect(picker.getByRole('button', { name: 'F♯' }).getAttribute('aria-pressed')).toBe('true');
    expect(picker.getByRole('button', { name: 'm7♭5' }).getAttribute('aria-pressed')).toBe('true');
    expect(chip()).toBe('Arpeggio: F#m7b5 · held');
    expect(layer()?.getAttribute('aria-label')).toBe('F#m7b5 chord tones: F♯ R, A ♭3, C ♭5, E ♭7');
  });

  const pressedIn = (picker: { getAllByRole: (role: 'button') => HTMLElement[] }) =>
    picker
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.textContent);

  it('presses a root but no quality for a chord no button stands for', async () => {
    const user = userEvent.setup();
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('E5');
    });
    await user.click(screen.getByRole('button', { name: 'Choose an arpeggio' }));
    const picker = within(screen.getByRole('dialog', { name: 'Arpeggio tool' }));
    // Degrees is pressed too; the quality buttons are the ones that must not be.
    expect(pressedIn(picker)).toEqual(['Degrees', 'E']);
    // The next click starts from the default quality, not from a stale pick.
    await user.click(picker.getByRole('button', { name: 'E' }));
    expect(store.getState().held).toBe('Em');
  });

  it('presses no root or quality while no chord is drawn', async () => {
    const user = userEvent.setup();
    const { store } = await open(chords([undefined, undefined]));
    act(() => {
      store.getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: no chords in this song');
    });
    await user.click(screen.getByRole('button', { name: 'Choose an arpeggio' }));
    const picker = within(screen.getByRole('dialog', { name: 'Arpeggio tool' }));
    expect(pressedIn(picker)).toEqual(['Degrees']);
  });

  it('mirrors the rings for a left-handed player', async () => {
    const { services, store } = await open(chords());
    act(() => {
      store.getState().hold('Am7');
    });
    const xs = () =>
      [...document.querySelectorAll('[data-fretboard-arpeggio] circle')]
        .map((circle) => Number(circle.getAttribute('cx')))
        .sort((x, y) => x - y);
    const right = xs();
    act(() => {
      services.ui.getState().setFretboardLeftHanded(true);
    });
    const { width } = geometryOf({ strings: 6, frets: 24, capo: 0 }, false);
    expect(xs()).toEqual(right.map((x) => width - x).sort((x, y) => x - y));
  });

  it('says the chords are unavailable when the analysis fails', async () => {
    const services = createTestServices();
    insightsFor(services, {
      client: { analyse: () => Promise.reject(new Error('boom')), dispose: () => undefined },
    });
    renderWithServices(<Fretboard />, services);
    const { bytes } = await write(chords(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    act(() => {
      arpeggioOverlayFor(services).getState().turnOn();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: chords unavailable');
    });
  });

  it('says it is finding the chords until the analysis lands', async () => {
    const services = createTestServices();
    let answer: (insights: ReturnType<typeof analyseScore>) => void = () => undefined;
    insightsFor(services, {
      client: {
        analyse: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
        dispose: () => undefined,
      },
    });
    renderWithServices(<Fretboard />, services);
    const built = chords();
    const { bytes } = await write(built, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    const opened = services.document.getState().score;
    if (!opened) throw new Error('no score');
    act(() => {
      services.playback.setState({ position: positionEventAt(opened, 0) });
      arpeggioOverlayFor(services).getState().turnOn();
    });
    expect(chip()).toBe('Arpeggio: finding chords…');
    await act(async () => {
      answer(analyseScore(opened));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip()).toBe('Arpeggio: Am');
    });
  });

  it('moves focus to the Arpeggio button after Hide', async () => {
    const user = userEvent.setup();
    const { store } = await open(chords());
    act(() => {
      store.getState().hold('Am');
    });
    screen.getByRole('button', { name: 'Hide the arpeggio' }).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose an arpeggio' }));
  });
});
