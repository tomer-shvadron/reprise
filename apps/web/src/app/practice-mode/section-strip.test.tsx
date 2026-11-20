import { note, score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { positionEventAt } from '@/test/position';

import { renderHeader } from '../header/test/render-header';

import { SectionStrip } from './section-strip';

function sectioned(markers: Record<number, string>, bars = 12) {
  const builder = score().track('guitar');
  for (let i = 0; i < bars; i += 1) {
    builder.bar();
    const name = markers[i];
    if (name !== undefined) builder.section(name);
    for (let beat = 0; beat < 4; beat += 1) builder.beat('4', [note(1, 0)]);
  }
  return builder.build();
}

const SONG = () => sectioned({ 0: 'Intro', 4: 'Chorus', 8: 'Outro' });

describe('SectionStrip', () => {
  it('lists the sections, named with their bars', async () => {
    const { open } = renderHeader(<SectionStrip />);
    await open(SONG());
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Intro',
      'Chorus',
      'Outro',
    ]);
    expect(screen.getByRole('button', { name: 'Chorus, Bars 5–8' })).toBeInTheDocument();
  });

  it('renders nothing for a song without markers', async () => {
    const { open } = renderHeader(<SectionStrip />);
    await open(sectioned({}));
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('loops a section on a click and announces it, and the pressed one ends the loop', async () => {
    const { open, services } = renderHeader(<SectionStrip />);
    await open(SONG());
    const chorus = screen.getByRole('button', { name: /^Chorus/ });
    expect(chorus).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(chorus);
    const { masterBars } = services.document.getState().score ?? { masterBars: [] };
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: masterBars[4]?.id,
      endBar: masterBars[7]?.id,
    });
    expect(chorus).toHaveAttribute('aria-pressed', 'true');
    expect(services.transport.getState().announcement?.text).toBe('Looping Chorus, bars 5 to 8');

    await userEvent.click(chorus);
    expect(services.playback.getState().settings.loop).toBeUndefined();
    expect(chorus).toHaveAttribute('aria-pressed', 'false');
  });

  it('presses only the section whose bars are exactly the loop', async () => {
    const { open, services } = renderHeader(<SectionStrip />);
    await open(SONG());
    const { masterBars } = services.document.getState().score ?? { masterBars: [] };
    act(() => {
      services.audio.setLoop({
        startBar: masterBars[4]?.id ?? '',
        endBar: masterBars[5]?.id ?? '',
      });
    });
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('marks the section under the playhead as current', async () => {
    const { open, services } = renderHeader(<SectionStrip />);
    const song = SONG();
    await open(song);
    expect(screen.getByRole('button', { name: /^Intro/ })).not.toHaveAttribute('aria-current');
    act(() => {
      // Four quarter notes of 960 ticks a bar: bar index 5 starts at 5 × 3840.
      services.playback.setState({ position: positionEventAt(song, 5 * 3840) });
    });
    expect(screen.getByRole('button', { name: /^Chorus/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Intro/ })).not.toHaveAttribute('aria-current');
  });
});
