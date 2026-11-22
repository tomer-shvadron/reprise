import { write } from '@reprise/formats';
import { PPQ } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/app/app';
import { createAppRegistry } from '@/app/app-registry';
import { chord, repeat, song } from '@/lib/insights/test/songs';
import { modulating, twoSections } from '@/test/two-sections';
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

const card = async (name: string) => within(panel()).findByRole('region', { name });

describe('the Sections, Chords and Tracks cards', () => {
  it('lists the sections with bars, length and the tracks in them', async () => {
    await setup(twoSections());
    const sections = await card('Sections');
    const rows = sections.querySelectorAll('[data-insight-section]');
    expect([...rows].map((row) => row.getAttribute('data-insight-section'))).toEqual([
      'Verse',
      'Solo chorus',
    ]);
    expect(within(sections).getByText('Bars 1–8, 0:16')).toBeInTheDocument();
    expect(within(sections).getByText('Solo')).toBeInTheDocument();
  });

  it('says nothing about a key or scale that is the song’s own, and offers no control for it', async () => {
    await setup(twoSections());
    const sections = await card('Sections');
    expect(within(sections).queryByRole('button', { pressed: false })).toBeNull();
    expect(sections.textContent).not.toMatch(/A natural minor/);
    // The same song's Scale and Tracks cards hold the controls.
    const tracks = await card('Tracks');
    expect(within(tracks).getAllByRole('button', { pressed: false }).length).toBeGreaterThan(0);
  });

  it('shows what differs: a section in another key has its scale as a switch', async () => {
    const services = await setup(modulating());
    const sections = await card('Sections');
    const bridge = within(
      sections.querySelector<HTMLElement>('[data-insight-section="Bridge"]') as HTMLElement,
    );
    const toggle = await bridge.findByRole('button', {
      name: /^Show D minor pentatonic for Melody in Bridge on fretboard$/,
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(scaleOverlayFor(services).getState().overlay).toMatchObject({
      tonic: 2,
      source: 'section',
    });
    expect(services.ui.getState().bottomPanel.open).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Pressing it again hides the scale.
    await userEvent.click(toggle);
    expect(scaleOverlayFor(services).getState().overlay).toBeUndefined();
  });

  it('sets the song overlay from the song’s own scale in the Tracks card', async () => {
    const services = await setup(aMinorRiff());
    const tracks = await card('Tracks');
    const toggle = within(tracks).getByRole('button', {
      name: /^Show A minor pentatonic for .* on fretboard$/,
    });
    await userEvent.click(toggle);
    expect(scaleOverlayFor(services).getState().overlay?.source).toBe('song');
  });

  it('seeks to the first bar of a section from its name', async () => {
    const services = await setup(twoSections());
    const seek = vi.spyOn(services.audio, 'seek');
    const sections = await card('Sections');
    await userEvent.click(
      within(sections).getByRole('button', { name: 'Solo chorus, go to bar 9' }),
    );
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(8 * 4 * PPQ);
  });

  it('lists the chords as names with counts and opens the Chords tab on a chip', async () => {
    const services = await setup(twoSections());
    const chords = await card('Chords');
    expect(within(chords).getByText('Times each chord comes in')).toBeInTheDocument();
    expect(within(chords).queryByText(/Inferred/)).not.toBeInTheDocument();
    expect(within(chords).getAllByText('Verse:').length).toBeGreaterThan(0);
    expect(chords.textContent).toMatch(/Am–F–C–G/);
    const chip = within(chords).getByRole('button', {
      name: /^Am\. Comes in \d+ times, \d+% of the time\. Click for shapes\.$/,
    });
    expect(chip).toHaveTextContent(/^Am×\d+$/);
    await userEvent.click(chip);
    expect(services.ui.getState().chordsName).toBe('Am');
    expect(services.ui.getState().rightPanelView).toBe('chords');
  });

  it('marks chords read from the notes as inferred', async () => {
    await setup(song(repeat([{ chord: chord(A, true) }, { chord: chord(5) }], 4)));
    const chords = await card('Chords');
    expect(within(chords).getByText('Inferred from the notes.')).toBeInTheDocument();
  });

  it('lists each track with its range and says what its rough difficulty rests on', async () => {
    await setup(aMinorRiff());
    const tracks = await card('Tracks');
    expect(within(tracks).getByText(/^Range /)).toBeInTheDocument();
    const rating = within(tracks).getByText(/^Difficulty \d of 5 \(rough\)$/);
    const details = rating.closest('details');
    expect(details?.textContent).toMatch(/A rough guide from these factors; speed counts most\./);
    expect(details?.textContent).toMatch(
      /Speed: 90% of the passages stay under [\d.]+ notes a second \(\d of 5\)/,
    );
    expect(details?.textContent).toMatch(/Frets: 90% of the notes are at fret \d+ or lower/);
    expect(details?.textContent).toMatch(/Hard techniques: \d+% of the notes: tapping, wide bends/);
    expect(details?.textContent).toMatch(/A shift is a move of more than 4 frets/);
  });

  it('moves focus to the section the command was run on, announces it and clears the request', async () => {
    const services = await setup(twoSections());
    const sections = await card('Sections');
    const bar = services.document.getState().score?.masterBars[10];
    if (!bar) throw new Error('no bar');
    services.menuTarget.getState().set({ kind: 'section', masterBar: bar.id });
    await act(async () => {
      await createAppRegistry(services).get('trainer.sectionInsights')?.run();
    });
    const row = sections.querySelector<HTMLElement>('[data-section-from="8"]');
    expect(row).toHaveAttribute('data-focused');
    expect(within(row as HTMLElement).getByRole('button', { name: /^Solo chorus,/ })).toHaveFocus();
    expect(services.transport.getState().announcement?.text).toMatch(/^Solo chorus, bars 9–16/);
    // Handled once: a remount does not scroll or focus again, and a key press clears the tint.
    expect(insightsFor(services).getState().focus).toBeUndefined();
    await userEvent.keyboard('{Shift}');
    expect(row).not.toHaveAttribute('data-focused');
  });

  it('falls back to the section under the edit cursor', async () => {
    const services = await setup(twoSections());
    await card('Sections');
    const score = services.document.getState().score;
    const track = score?.tracks[0];
    const beat = track?.bars[3]?.voices[0]?.beats[0];
    if (!track || !beat) throw new Error('no beat');
    act(() => {
      services.selection.getState().setEdit({
        cursor: {
          track: track.id,
          voice: 0,
          beat: beat.id,
          string: 1,
          staff: 'tab',
          masterBar: score.masterBars[3]?.id ?? '',
          at: { track: 0, bar: 3, beat: 0 },
        },
      });
    });
    await act(async () => {
      await createAppRegistry(services).get('trainer.sectionInsights')?.run();
    });
    expect(document.querySelector('[data-section-from="0"]')).toHaveAttribute('data-focused');
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
