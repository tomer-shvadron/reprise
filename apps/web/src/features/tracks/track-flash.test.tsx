import { write } from '@reprise/formats';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderTracks, threeTracks } from './test/render-tracks';
import { TrackFlash } from './track-flash';

afterEach(() => {
  vi.useRealTimers();
});

describe('TrackFlash', () => {
  it('stays quiet when a score opens, names a changed track politely, then clears', async () => {
    const { services, open } = renderTracks(() => <TrackFlash />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    const ids = await open();
    expect(status).toBeEmptyDOMElement();

    vi.useFakeTimers();
    act(() => {
      services.selection.getState().setCurrentTrack(ids[1] ?? '');
    });
    expect(status).toHaveTextContent('Track 2: Bass');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(status).toBeEmptyDOMElement();
  });

  it('stays quiet when the same native file is reopened under a new document', async () => {
    const { services, open } = renderTracks(() => <TrackFlash />);
    const song = threeTracks();
    const ids = await open(song);
    act(() => {
      services.selection.getState().setCurrentTrack(ids[2] ?? '');
    });
    const status = screen.getByRole('status');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    expect(status).toBeEmptyDOMElement();
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('copy.reprise', bytes);
      services.selection.getState().setCurrentTrack(ids[0] ?? '');
    });
    expect(status).toBeEmptyDOMElement();
  });
});
