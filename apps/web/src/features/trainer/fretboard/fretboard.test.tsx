import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { positionEventAt } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { Fretboard } from './fretboard';
import { geometryOf } from './fretboard-geometry';
import { scaleOverlayFor } from './scale-overlay';
import { LEFT_HANDED_STORAGE_KEY } from '@/state/fretboard-prefs';

afterEach(() => {
  window.localStorage.clear();
});

type Tuned = { tuning?: number[]; capo?: number };

/** One bar of two beats: the notes of the first, then the second. */
function song(
  instrument: 'guitar' | 'bass',
  options: Tuned,
  first: [number, number][],
  second: [number, number][] = [],
): Score {
  const builder = score().tempo(120).track(instrument, options).bar();
  builder.beat(
    '2',
    first.map(([string, fret]) => note(string, fret)),
  );
  builder.beat(
    '2',
    second.map(([string, fret]) => note(string, fret)),
  );
  return builder.build();
}

async function open(built: Score) {
  const services = createTestServices();
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
  return { ...result, services, at };
}

const lit = () =>
  Array.from(document.querySelectorAll('[data-fretboard-notes] [role="img"]')).map(
    (el) => el.getAttribute('aria-label') ?? '',
  );

const STANDARD = [40, 45, 50, 55, 59, 64];
const DROP_D = [38, 45, 50, 55, 59, 64];
const SEVEN = [35, 40, 45, 50, 55, 59, 64];

describe('Fretboard note placement', () => {
  it.each([
    ['standard', STANDARD, [[3, 5]] as [number, number][], ['string 3, fret 5, C']],
    ['drop D', DROP_D, [[6, 0]] as [number, number][], ['string 6, fret 0, D']],
    ['seven strings', SEVEN, [[7, 0]] as [number, number][], ['string 7, fret 0, B']],
  ])('names a note on %s', async (_name, tuning, notes, expected) => {
    await open(song('guitar', { tuning }, notes));
    expect(lit()).toEqual(expected);
  });

  it('draws one line per string of the track', async () => {
    const { container } = await open(song('guitar', { tuning: SEVEN }, [[1, 3]]));
    expect(container.querySelectorAll('[data-fretboard] line')).toHaveLength(7 + 1 + 24);
    expect(screen.getByText(/^7 strings/)).toBeInTheDocument();
  });

  it('shows four strings for a bass and its note names', async () => {
    const { container } = await open(song('bass', {}, [[4, 3]]));
    expect(lit()).toEqual(['string 4, fret 3, G']);
    expect(screen.getByText(/^4 strings/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-fretboard] line')).toHaveLength(4 + 1 + 24);
  });

  it('places the high string above the low one', async () => {
    await open(
      song('guitar', {}, [
        [1, 0],
        [6, 0],
      ]),
    );
    const cy = (label: string) =>
      Number(
        document.querySelector(`[aria-label="${label}"] circle`)?.getAttribute('cy') ?? Number.NaN,
      );
    expect(cy('string 1, fret 0, E')).toBeLessThan(cy('string 6, fret 0, E'));
  });

  it('counts frets from the capo and draws it', async () => {
    const { container } = await open(song('guitar', { capo: 2 }, [[1, 0]]));
    expect(screen.getByText(/capo 2/)).toBeInTheDocument();
    expect(container.querySelector('[data-capo]')).not.toBeNull();
    // Open high E under a capo on fret 2 sounds F#, and sits at the capo's fret.
    expect(lit()).toEqual(['string 1, fret 2 (capo 2, written 0), F#']);
    const capoCenter = (circle: Element | null) => Number(circle?.getAttribute('cx'));
    const withoutCapo = await open(song('guitar', {}, [[1, 2]]));
    expect(
      capoCenter(
        document.querySelector('[aria-label="string 1, fret 2 (capo 2, written 0), F#"] circle'),
      ),
    ).toBe(
      capoCenter(withoutCapo.container.querySelector('[aria-label="string 1, fret 2, F#"] circle')),
    );
  });
});

describe('Fretboard following playback', () => {
  it('lights the beat at the position and moves on to the next', async () => {
    const { at } = await open(song('guitar', {}, [[2, 1]], [[3, 2]]));
    expect(lit()).toEqual(['string 2, fret 1, C']);
    at(960 * 2);
    expect(lit()).toEqual(['string 3, fret 2, A']);
  });

  it('keeps the same elements while the lit set is unchanged', async () => {
    const { at } = await open(song('guitar', {}, [[2, 1]], [[3, 2]]));
    const before = document.querySelector('[data-fretboard-notes] > g');
    at(10);
    expect(document.querySelector('[data-fretboard-notes] > g')).toBe(before);
  });

  it('lights the heard beat, behind the engine, while running, and the engine when stopped', async () => {
    const { services, at } = await open(song('guitar', {}, [[2, 1]], [[3, 2]]));
    const current = services.document.getState().score;
    const second = current?.masterBars[0];
    if (!second) throw new Error('score');
    act(() => {
      services.playback.setState({ transport: 'playing' });
      services.heard.current = { masterBarId: second.id, tick: 0, playbackTick: 0 };
    });
    at(960 * 2);
    // The engine is on the second beat; the listener still hears the first.
    expect(lit()).toEqual(['string 2, fret 1, C']);
    act(() => {
      services.playback.setState({ transport: 'stopped' });
    });
    expect(lit()).toEqual(['string 3, fret 2, A']);
  });

  it('names the open strings and draws a position past fret 24', async () => {
    const { container } = await open(song('guitar', { tuning: DROP_D, capo: 5 }, [[1, 22]]));
    expect(screen.getByText(/tuning D A D G B E/)).toBeInTheDocument();
    const svg = container.querySelector('[data-fretboard]');
    const [, , width] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const cx = Number(document.querySelector('[data-fretboard-notes] circle')?.getAttribute('cx'));
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(width ?? 0);
    // 5 + 22 is fret 27, so 27 fret numbers are drawn.
    expect(container.querySelectorAll('[data-fretboard] > g[aria-hidden] > g text')).toHaveLength(
      27,
    );
  });

  it('does not announce the highlights', async () => {
    const { container } = await open(song('guitar', {}, [[2, 1]]));
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});

describe('Fretboard edit cursor', () => {
  it('lights the cursor beat in edit mode while stopped', async () => {
    const built = song('guitar', {}, [[2, 1]], [[3, 2]]);
    const { services } = await open(built);
    const current = services.document.getState().score;
    const track = current?.tracks[0];
    const masterBar = current?.masterBars[0];
    const beat = track?.bars[0]?.voices[0].beats[1];
    if (!track || !masterBar || !beat) throw new Error('score');
    act(() => {
      services.editing.getState().setEditing(true);
      services.selection.getState().setEdit({
        cursor: {
          track: track.id,
          masterBar: masterBar.id,
          voice: 0,
          beat: beat.id,
          string: 3,
          staff: 'tab',
          at: { track: 0, bar: 0, beat: 1 },
        },
      });
    });
    expect(lit()).toEqual(['string 3, fret 2, A']);
    act(() => {
      services.editing.getState().setEditing(false);
    });
    expect(lit()).toEqual(['string 2, fret 1, C']);
  });
});

describe('Fretboard left-handed flip', () => {
  it('mirrors the board and remembers the choice', async () => {
    const built = song('guitar', {}, [[2, 1]]);
    const first = await open(built);
    const cx = () =>
      Number(document.querySelector('[data-fretboard-notes] circle')?.getAttribute('cx'));
    const right = cx();
    await userEvent.click(within(first.container).getByRole('switch', { name: 'Left-handed' }));
    expect(cx()).toBeGreaterThan(1200 - right - 1);
    expect(cx()).toBeLessThan(1200 - right + 1);
    expect(window.localStorage.getItem(LEFT_HANDED_STORAGE_KEY)).toBe('1');
    first.unmount();
    await open(built);
    expect(screen.getByRole('switch', { name: 'Left-handed' })).toBeChecked();
  });
});

describe('Fretboard empty state', () => {
  it('says so with no song open', () => {
    renderWithServices(<Fretboard />);
    expect(screen.getByText(/No fretted track selected/)).toBeInTheDocument();
  });

  it('says so for a drum track', async () => {
    const built = score()
      .tempo(120)
      .track('drums')
      .bar()
      .beat('4', [note(0, 38)])
      .build();
    const services = createTestServices();
    renderWithServices(<Fretboard />, services);
    const { bytes } = await write(built, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('drums.reprise', bytes);
    });
    expect(screen.getByText(/No fretted track selected/)).toBeInTheDocument();
  });
});

describe('Fretboard scale overlay', () => {
  const tones = () => document.querySelectorAll('[data-fretboard-scale] [data-scale-tone]');

  it('keeps a song overlay on with no dots while the song has no scale', async () => {
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'song');
      scaleOverlayFor(services).getState().showNone();
    });
    expect(screen.getByText('Song scale: none found')).toBeTruthy();
    expect(document.querySelector('[data-fretboard-scale]')).toBeNull();
  });

  it('marks the scale with the tonic ringed, under the lit notes, and clears from the chip', async () => {
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    expect(document.querySelector('[data-fretboard-scale]')).toBeNull();
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
    });
    const layer = document.querySelector('[data-fretboard-scale]');
    expect(layer?.getAttribute('aria-label')).toBe('A minor pentatonic: A C D E G');
    // Five tones on six strings across 24 frets, every one a scale tone.
    expect(tones().length).toBeGreaterThan(30);
    expect(document.querySelectorAll('[data-scale-tonic]').length).toBeGreaterThan(0);
    expect(screen.getByText(/Scale: A minor pentatonic/)).toBeTruthy();
    // The notes layer comes after, so it paints on top.
    const order = [...document.querySelectorAll('[data-fretboard] > g')].map((g) =>
      g.hasAttribute('data-fretboard-scale')
        ? 'scale'
        : g.hasAttribute('data-fretboard-notes')
          ? 'notes'
          : 'board',
    );
    expect(order).toEqual(['board', 'scale', 'notes']);
    expect(lit()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the scale' }));
    expect(document.querySelector('[data-fretboard-scale]')).toBeNull();
  });

  const ringXs = () =>
    [...document.querySelectorAll('[data-fretboard-scale] circle')].map((c) =>
      Number(c.getAttribute('cx')),
    );

  it('starts at the capo fret, which is the leftmost ring', async () => {
    const { services } = await open(song('guitar', { capo: 3 }, [[1, 0]]));
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
    });
    const geometry = geometryOf({ strings: 6, frets: 24, capo: 3 }, false);
    expect(Math.min(...ringXs())).toBeCloseTo(geometry.dotX(3));
    // Without the capo the open strings' tones sit further left.
    const plain = await open(song('guitar', {}, [[1, 0]]));
    act(() => {
      scaleOverlayFor(plain.services).getState().show(9, 'minorPentatonic', 'manual');
    });
    expect(Math.min(...ringXs())).toBeLessThan(geometry.dotX(3));
  });

  it('mirrors the rings for a left-handed player', async () => {
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
    });
    const right = ringXs().sort((x, y) => x - y);
    act(() => {
      services.ui.getState().setFretboardLeftHanded(true);
    });
    const left = ringXs().sort((x, y) => x - y);
    const { width } = geometryOf({ strings: 6, frets: 24, capo: 0 }, false);
    expect(left.length).toBe(right.length);
    expect(left).toEqual(right.map((x) => width - x).sort((x, y) => x - y));
  });

  it('keeps the picked spelling in the chip and the label', async () => {
    const user = userEvent.setup();
    await open(song('guitar', {}, [[1, 5]]));
    await user.click(screen.getByRole('button', { name: 'Choose a scale' }));
    const picker = within(screen.getByRole('dialog', { name: 'Scale tool' }));
    await user.click(picker.getByRole('button', { name: 'E♭' }));
    await user.click(picker.getByRole('button', { name: 'blues' }));
    expect(screen.getByText(/Scale: E♭ blues/)).toBeTruthy();
    expect(document.querySelector('[data-fretboard-scale]')?.getAttribute('aria-label')).toBe(
      'E♭ blues: E♭ G♭ A♭ A B♭ D♭',
    );
  });

  it('shows what is on the neck as the picker selection', async () => {
    const user = userEvent.setup();
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    await user.click(screen.getByRole('button', { name: 'Choose a scale' }));
    const picker = within(screen.getByRole('dialog', { name: 'Scale tool' }));
    await user.click(picker.getByRole('button', { name: 'A' }));
    await user.click(picker.getByRole('button', { name: 'minor pentatonic' }));
    act(() => {
      scaleOverlayFor(services).getState().show(4, 'dorian', 'section');
    });
    expect(picker.getByRole('button', { name: 'E' }).getAttribute('aria-pressed')).toBe('true');
    expect(picker.getByRole('button', { name: 'Dorian' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(picker.getByRole('button', { name: 'Mixolydian' }));
    expect(screen.getByText(/Scale: E Mixolydian/)).toBeTruthy();
  });

  it('moves focus to the Scale button after Hide', async () => {
    const user = userEvent.setup();
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    act(() => {
      scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
    });
    screen.getByRole('button', { name: 'Hide the scale' }).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a scale' }));
  });

  it('picks a tonic and a scale from the header', async () => {
    const user = userEvent.setup();
    const { services } = await open(song('guitar', {}, [[1, 5]]));
    await user.click(screen.getByRole('button', { name: 'Choose a scale' }));
    const picker = within(screen.getByRole('dialog', { name: 'Scale tool' }));
    await user.click(picker.getByRole('button', { name: 'D' }));
    await user.click(picker.getByRole('button', { name: 'Dorian' }));
    expect(scaleOverlayFor(services).getState().overlay).toMatchObject({
      tonic: 2,
      scaleId: 'dorian',
      source: 'manual',
    });
    expect(screen.getByText(/Scale: D Dorian/)).toBeTruthy();
  });
});
