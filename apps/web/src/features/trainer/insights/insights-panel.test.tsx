import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/app/app';
import { createAppRegistry } from '@/app/app-registry';
import { chord, repeat, song, type SongBar } from '@/lib/insights/test/songs';
import { aMinorRiff } from '@/test/a-minor-riff';
import { createTestServices } from '@/test/services';
import type { Score } from '@reprise/model';

import { scaleOverlayFor } from '../fretboard/scale-overlay';

import { insightsFor } from './insights-for';
import { SLOW_AFTER_MS } from './insights-store';

async function setup(song?: Score) {
  const services = createTestServices();
  render(<App services={services} keyboard="mac" />);
  if (song) {
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
  }
  act(() => {
    services.ui.getState().showPanelView('insights');
  });
  return services;
}

const panel = () => screen.getByRole('region', { name: 'Song insights' });

describe('the Insights view', () => {
  it('asks for a song when none is open', async () => {
    await setup();
    expect(within(panel()).getByText('Open a song to see insights.')).toBeInTheDocument();
  });

  it('shows the key, scale and shape of the open song', async () => {
    await setup(aMinorRiff());
    const key = await within(panel()).findByText('A minor');
    expect(key).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: 'Scale' })).toBeInTheDocument();
    expect(
      within(
        panel().querySelector<HTMLElement>('[data-insight-card="scale"]') ?? panel(),
      ).getByText('A minor pentatonic'),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: 'Shape' })).toBeInTheDocument();
    expect(
      within(panel()).getByText('Likely. Next best: C major (relative major)'),
    ).toBeInTheDocument();
    expect(within(panel()).getByText('Notes: A C D E G')).toBeInTheDocument();
    expect(
      within(panel()).getByRole('heading', { level: 2, name: 'Song insights' }),
    ).toBeInTheDocument();
    const histogram = panel().querySelector('[data-pitch-histogram]');
    expect(histogram?.getAttribute('aria-label')).toMatch(/^Most used notes: A \d+%/);
  });

  it('says there are too few notes for a key, and has no Scale card', async () => {
    await setup(score().tempo(120).track('guitar').bar().beat('4', []).build());
    expect(await within(panel()).findByText('Not enough notes to find a key.')).toBeInTheDocument();
    expect(within(panel()).queryByRole('heading', { name: 'Scale' })).not.toBeInTheDocument();
  });

  it('shows the scale on the fretboard from the Scale card', async () => {
    const services = await setup(aMinorRiff());
    await userEvent.click(
      await within(panel()).findByRole('button', { name: 'Show on fretboard' }),
    );
    await within(document.body).findByText(/Scale: A minor pentatonic/);
    expect(scaleOverlayFor(services).getState().overlay).toMatchObject({
      tonic: 9,
      scaleId: 'minorPentatonic',
      source: 'song',
    });
    expect(services.ui.getState().bottomPanel.open).toBe(true);
  });
});

const A = 9;

/** Verse and Chorus, each Am F C G twice (the chorus in the other order), written chord names. */
function twoSections(): Score {
  const verse: SongBar[] = [
    { chord: chord(A, true), name: 'Am', section: 'Verse' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
    { chord: chord(7), name: 'G' },
  ];
  const chorus: SongBar[] = [
    { chord: chord(0), name: 'C', section: 'Solo chorus' },
    { chord: chord(7), name: 'G' },
    { chord: chord(A, true), name: 'Am' },
    { chord: chord(5), name: 'F' },
  ];
  const again = (bars: SongBar[]): SongBar[] =>
    bars.map((bar) =>
      bar.name === undefined ? { chord: bar.chord } : { chord: bar.chord, name: bar.name },
    );
  return song([...verse, ...again(verse), ...chorus, ...again(chorus)]);
}

describe('the Sections, Chords and Tracks cards', () => {
  it('lists the sections with bars, key, scale and the tracks in them', async () => {
    await setup(twoSections());
    const card = await within(panel()).findByRole('region', { name: 'Sections' });
    const rows = card.querySelectorAll('[data-insight-section]');
    expect([...rows].map((row) => row.getAttribute('data-insight-section'))).toEqual([
      'Verse',
      'Solo chorus',
    ]);
    expect(within(card).getByText('Bars 1–8, 0:16')).toBeInTheDocument();
    expect(within(card).getByText('Solo')).toBeInTheDocument();
    expect(
      within(card).getAllByRole('button', { name: /^Show .* on fretboard$/ }).length,
    ).toBeGreaterThan(0);
  });

  it('shows a section scale on the fretboard as a section overlay', async () => {
    const services = await setup(twoSections());
    const card = await within(panel()).findByRole('region', { name: 'Sections' });
    const [first] = within(card).getAllByRole('button', {
      name: /^Show .* in Verse on fretboard$/,
    });
    if (!first) throw new Error('no button');
    await userEvent.click(first);
    expect(scaleOverlayFor(services).getState().overlay?.source).toBe('section');
    expect(services.ui.getState().bottomPanel.open).toBe(true);
  });

  it('seeks to the first bar of a section from its name', async () => {
    const services = await setup(twoSections());
    const card = await within(panel()).findByRole('region', { name: 'Sections' });
    await userEvent.click(within(card).getByRole('button', { name: 'Solo chorus' }));
    expect(services.transport.getState().announcement?.text ?? '').not.toMatch(/not played/);
  });

  it('lists the chords as names and opens the Chords tab on a chip', async () => {
    const services = await setup(twoSections());
    const card = await within(panel()).findByRole('region', { name: 'Chords' });
    expect(within(card).queryByText(/Inferred/)).not.toBeInTheDocument();
    expect(within(card).getByText('Verse:')).toBeInTheDocument();
    expect(card.textContent).toMatch(/Am–F–C–G/);
    await userEvent.click(within(card).getByRole('button', { name: /^Am, \d+ times?/ }));
    expect(services.ui.getState().chordsName).toBe('Am');
    expect(services.ui.getState().rightPanelView).toBe('chords');
  });

  it('marks chords read from the notes as inferred', async () => {
    await setup(song(repeat([{ chord: chord(A, true) }, { chord: chord(5) }], 4)));
    const card = await within(panel()).findByRole('region', { name: 'Chords' });
    expect(within(card).getByText('Inferred from the notes.')).toBeInTheDocument();
  });

  it('lists each track with its range and a rough difficulty', async () => {
    await setup(aMinorRiff());
    const card = await within(panel()).findByRole('region', { name: 'Tracks' });
    expect(within(card).getByText(/^Range /)).toBeInTheDocument();
    const rating = within(card).getByText(/^Difficulty \d of 5 \(rough\)$/);
    expect(rating.closest('details')?.textContent).toMatch(/Speed/);
  });

  it('scrolls to the section the context-menu command was run on', async () => {
    const services = await setup(twoSections());
    const card = await within(panel()).findByRole('region', { name: 'Sections' });
    const bar = services.document.getState().score?.masterBars[10];
    if (!bar) throw new Error('no bar');
    services.menuTarget.getState().set({ kind: 'section', masterBar: bar.id });
    await act(async () => {
      await createAppRegistry(services).get('trainer.sectionInsights')?.run();
    });
    const row = card.querySelector<HTMLElement>('[data-section-bar="8"]');
    expect(row).toHaveAttribute('data-focused');
  });
});

describe('the analysing status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is announced from outside the busy section, and only once the analysis is slow', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const services = createTestServices();
    // A client that never answers keeps the analysis running.
    insightsFor(services, {
      client: { analyse: () => new Promise(() => undefined), dispose() {} },
    });
    render(<App services={services} keyboard="mac" />);
    const { bytes } = await write(aMinorRiff(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    act(() => {
      services.ui.getState().showPanelView('insights');
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    const section = panel();
    expect(section).toHaveAttribute('aria-busy', 'true');
    // The status is not inside the busy section, or a screen reader may hold it back.
    const status = document.querySelector<HTMLElement>('[data-insights-status]');
    if (!status) throw new Error('no status');
    expect(section.contains(status)).toBe(false);
    expect(status).toHaveTextContent('');
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
      await Promise.resolve();
    });
    expect(status).toHaveTextContent('Analysing…');
  });
});
