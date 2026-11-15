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
import { LEFT_HANDED_STORAGE_KEY } from './fretboard-prefs';

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
    expect(screen.getByText('7 strings')).toBeInTheDocument();
  });

  it('shows four strings for a bass and its note names', async () => {
    const { container } = await open(song('bass', {}, [[4, 3]]));
    expect(lit()).toEqual(['string 4, fret 3, G']);
    expect(screen.getByText('4 strings')).toBeInTheDocument();
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
    expect(lit()).toEqual(['string 1, fret 0, F#']);
    const capoCenter = (circle: Element | null) => Number(circle?.getAttribute('cx'));
    const withoutCapo = await open(song('guitar', {}, [[1, 2]]));
    expect(capoCenter(document.querySelector('[aria-label="string 1, fret 0, F#"] circle'))).toBe(
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
