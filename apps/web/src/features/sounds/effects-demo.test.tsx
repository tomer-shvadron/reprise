import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { EffectsDemo } from './effects-demo';

async function open(services: ReturnType<typeof createTestServices>) {
  const { bytes } = await write(score().track('guitar', { name: 'Lead' }).build(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  return services.document.getState().score?.tracks[0]?.id;
}

describe('EffectsDemo', () => {
  it('asks to open a file with no score', () => {
    renderWithServices(<EffectsDemo />);
    expect(screen.getByText('Open a file to try effects.')).toBeInTheDocument();
  });

  it('bypasses and restores a stage of a track through the audio service', async () => {
    const services = createTestServices();
    const id = await open(services);
    renderWithServices(<EffectsDemo />, services);

    const drive = screen.getByRole('button', { name: 'Bypass drive on Lead' });
    const user = userEvent.setup();
    await user.click(drive);
    expect(services.fakeAudio.setStageBypass).toHaveBeenLastCalledWith(id, 'drive', true);
    expect(drive).toHaveAttribute('aria-pressed', 'true');
    await user.click(drive);
    expect(services.fakeAudio.setStageBypass).toHaveBeenLastCalledWith(id, 'drive', false);
  });

  it('restores what it bypassed when it unmounts', async () => {
    const services = createTestServices();
    const id = await open(services);
    const { unmount } = renderWithServices(<EffectsDemo />, services);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bypass tone on Lead' }));
    unmount();
    expect(services.fakeAudio.setStageBypass).toHaveBeenLastCalledWith(id, 'tone', false);
  });

  it('restores and clears its toggles when another document opens', async () => {
    const services = createTestServices();
    const id = await open(services);
    renderWithServices(<EffectsDemo />, services);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bypass tone on Lead' }));
    await open(services);
    expect(services.fakeAudio.setStageBypass).toHaveBeenCalledWith(id, 'tone', false);
    expect(screen.getByRole('button', { name: 'Bypass tone on Lead' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
