import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AudioServiceDebug } from '@/app/audio/audio-service';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { EffectsDemo } from './effects-demo';

describe('EffectsDemo', () => {
  it('asks to open a file with no score', () => {
    renderWithServices(<EffectsDemo />);
    expect(screen.getByText('Open a file to try effects.')).toBeInTheDocument();
  });

  it('bypasses and restores a stage of a track through the engine', async () => {
    const services = createTestServices();
    const setStageBypass = vi.fn();
    // The fake service has no engine; the demo only calls setStageBypass on it.
    const debug = { engine: { setStageBypass } } as unknown as AudioServiceDebug;
    services.fakeAudio.debug.mockReturnValue(debug);
    const { bytes } = await write(score().track('guitar', { name: 'Lead' }).build(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    renderWithServices(<EffectsDemo />, services);
    const id = services.document.getState().score?.tracks[0]?.id;

    const drive = screen.getByRole('button', { name: 'Bypass drive on Lead' });
    const user = userEvent.setup();
    await user.click(drive);
    expect(setStageBypass).toHaveBeenLastCalledWith(id, 'drive', true);
    expect(drive).toHaveAttribute('aria-pressed', 'true');
    await user.click(drive);
    expect(setStageBypass).toHaveBeenLastCalledWith(id, 'drive', false);
  });
});
