import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderTracks } from './test/render-tracks';
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
});
