import { act, screen } from '@testing-library/react';
import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { renderWithServices } from '@/test/render';

import { ScorePane } from './score-pane';

const bytesOf = async (title: string) =>
  (await write(score().title(title).build(), 'reprise')).bytes;

describe('ScorePane', () => {
  it('shows the hint, then the file being opened', () => {
    const { services } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />);
    expect(screen.getByText('Open a file')).toBeInTheDocument();

    act(() => {
      services.document.setState({ opening: 'song.gp5' });
    });
    expect(screen.getByText('Opening song.gp5…')).toBeInTheDocument();
  });

  it('paints the score, named by its title or else its file', async () => {
    stubViewport(1280, 800);
    const { services } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />);

    const riff = await bytesOf('Riff');
    const untitled = await bytesOf('');
    await act(() => services.document.getState().openBytes('riff.reprise', riff));
    expect(screen.getByRole('region', { name: 'Score: Riff' })).toBeInTheDocument();

    await act(() => services.document.getState().openBytes('untitled.reprise', untitled));
    expect(screen.getByRole('region', { name: 'Score: untitled.reprise' })).toBeInTheDocument();
  });

  it('shows a layout error in place', () => {
    const { services } = renderWithServices(<ScorePane hint={<p>Open a file</p>} />);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    act(() => {
      services.layout.setState({ error: 'no room for the bar' });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This score could not be drawn. no room for the bar',
    );
  });
});
