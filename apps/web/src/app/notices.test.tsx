import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Warning } from '@reprise/formats';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';

import { Notices } from './notices';

const warning = (severity: Warning['severity'], message: string, count?: number): Warning => ({
  code: 'invalid-value',
  severity,
  message,
  location: { track: 0, bar: 4, beat: 2 },
  ...(count !== undefined && { count }),
});

describe('Notices', () => {
  it('shows an open error with its code and dismisses it', async () => {
    const { services } = renderWithServices(<Notices />);
    const user = userEvent.setup();

    await act(() => services.document.getState().openBytes('notes.txt', new Uint8Array([1, 2])));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not open notes.txt');
    expect(alert).toHaveTextContent('Not a Guitar Pro or Reprise file (unknown-format)');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(services.document.getState().error).toBeUndefined();
  });

  it('counts warnings, lists them by severity with locations, and dismisses', async () => {
    const { services } = renderWithServices(<Notices />);
    const user = userEvent.setup();
    act(() => {
      services.document.setState({
        file: { name: 'song.gp5', format: 'gp5', key: '', savedKeys: [] },
        warnings: [
          warning('info', 'RSE dropped', 3),
          warning('warning', 'A bend was clamped'),
          warning('error', 'The file ended early'),
        ],
        warningsOpen: true,
      });
    });

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Opened song.gp5 with 2 warnings');
    await user.click(within(notice).getByRole('button', { name: 'Details' }));
    const rows = within(screen.getByRole('list', { name: 'Import details' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      'error The file ended early · Track 1 · bar 5 · beat 3',
      'warning A bend was clamped · Track 1 · bar 5 · beat 3',
      'info RSE dropped ×3 · Track 1 · bar 5 · beat 3',
    ]);

    await user.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(services.document.getState().warningsOpen).toBe(false);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('opens the list from Show import details, and shows the next file collapsed', () => {
    const { services } = renderWithServices(<Notices />);
    act(() => {
      services.document.setState({
        file: { name: 'song.gp5', format: 'gp5', key: '', savedKeys: [] },
        warnings: [warning('warning', 'A bend was clamped')],
      });
      services.document.getState().showImportDetails();
    });

    expect(screen.getByRole('list', { name: 'Import details' })).toHaveTextContent(
      'A bend was clamped',
    );
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    act(() => {
      services.document.setState({
        file: { name: 'other.gp5', format: 'gp5', key: '', savedKeys: [] },
        detailsOpen: false,
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Opened other.gp5 with 1 warning');
    expect(screen.queryByRole('list', { name: 'Import details' })).not.toBeInTheDocument();
  });

  it('caps the details list', async () => {
    const { services } = renderWithServices(<Notices />);
    const user = userEvent.setup();
    act(() => {
      services.document.setState({
        file: { name: 'big.gp5', format: 'gp5', key: '', savedKeys: [] },
        warnings: Array.from({ length: 250 }, (_, i) => warning('warning', `w${String(i)}`)),
        warningsOpen: true,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Details' }));

    const list = screen.getByRole('list', { name: 'Import details' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(201);
    expect(list).toHaveTextContent('and 50 more');
  });

  it('offers Retry on a sounds error, and hides it until a different one', async () => {
    const { services } = renderWithServices(<Notices />);
    const user = userEvent.setup();
    const error = (message: string) => {
      act(() => {
        services.playback.setState({
          sounds: { status: 'error', loaded: 0, total: undefined, error: message },
        });
      });
    };

    error('The sound bank is missing');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sounds unavailable');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(services.fakeAudio.retry).toHaveBeenCalledOnce();

    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    error('The sound bank is damaged');
    expect(screen.getByRole('alert')).toHaveTextContent('The sound bank is damaged');
  });
});
