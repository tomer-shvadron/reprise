import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/app/app';
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
    expect(within(panel()).getByText('A minor pentatonic')).toBeInTheDocument();
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
