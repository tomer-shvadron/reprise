import { write } from '@reprise/formats';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { CommandSourceContext } from '@/app/use-command';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { createRig } from './test-rig';
import { tunerFor } from './tuner-for';
import { TunerPanel } from './tuner-panel';

async function setup(options: { song?: boolean } = {}) {
  const rig = createRig();
  const services = createTestServices({ platform: fakePlatform({ microphone: rig.microphone }) });
  mirrorAudio(services);
  tunerFor(services, rig.deps);
  if (options.song ?? true) {
    const { bytes } = await write(fourBars(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
  }
  const registry = createAppRegistry(services);
  const result = renderWithServices(
    <CommandSourceContext value={{ registry, keyboard: 'mac' }}>
      <TunerPanel />
    </CommandSourceContext>,
    services,
  );
  const user = userEvent.setup();
  const flush = () => act(() => Promise.resolve());
  const listen = async () => {
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    act(() => {
      rig.tick(12);
    });
  };
  return { ...result, services, rig, user, flush, listen };
}

describe('TunerPanel', () => {
  it('invites a Start, then shows A2 at +12 cents with string 5 highlighted', async () => {
    const { listen } = await setup();
    expect(screen.getByText('Click Start to listen.')).toBeInTheDocument();
    await listen();
    expect(screen.getByLabelText('A2')).toBeInTheDocument();
    expect(screen.getByTestId('tuner-cents')).toHaveTextContent('+12');
    const meter = screen.getByRole('meter', { name: 'Tuning' });
    expect(meter).toHaveAttribute('aria-valuenow', '12');
    expect(meter).toHaveAttribute('aria-valuetext', 'A2, 12 cents sharp');
    expect(screen.getByRole('button', { name: 'String 5, A2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'String 6, E2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText(/110\.\d Hz/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows the tuning name and orders the strings from the lowest', async () => {
    await setup();
    expect(screen.getByText(/E standard/)).toBeInTheDocument();
    const names = screen
      .getAllByRole('button', { name: /^String \d/ })
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      'String 6, E2',
      'String 5, A2',
      'String 4, D3',
      'String 3, G3',
      'String 2, B3',
      'String 1, E4',
    ]);
  });

  it('pins the meter to a clicked string, and Auto lets go', async () => {
    const { listen, user } = await setup();
    await listen();
    await user.click(screen.getByRole('button', { name: 'String 6, E2' }));
    expect(screen.getByRole('button', { name: 'String 6, E2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('meter', { name: 'Tuning' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText(/Tune down/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Auto' }));
    expect(screen.getByRole('button', { name: 'String 5, A2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText(/Tune down/)).not.toBeInTheDocument();
  });

  it('moves the readout when the reference changes', async () => {
    const { listen, rig } = await setup();
    await listen();
    const field = screen.getByRole('textbox', { name: 'Reference (A4)' });
    fireEvent.change(field, { target: { value: '432' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('432');
    // The tracker starts over under a new reference; the same pitch is now 44 cents sharp.
    act(() => {
      rig.tick(12);
    });
    expect(screen.getByLabelText('A2')).toBeInTheDocument();
    expect(screen.getByTestId('tuner-cents')).toHaveTextContent('+44');
  });

  it('reverts an invalid reference', async () => {
    await setup();
    const field = screen.getByRole('textbox', { name: 'Reference (A4)' });
    fireEvent.change(field, { target: { value: '500' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('440');
  });

  it('steps the reference with the buttons', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Lower the reference' }));
    expect(screen.getByRole('textbox', { name: 'Reference (A4)' })).toHaveValue('439');
  });

  it('shows a refused microphone and asks again on Try again', async () => {
    const { user, rig, flush } = await setup();
    rig.microphone.mockRejectedValueOnce(new DOMException('x', 'NotAllowedError'));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access is blocked');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(rig.microphone).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('measures chromatic cents and hides the strings with no song open', async () => {
    const { listen } = await setup({ song: false });
    expect(screen.queryByRole('group', { name: 'Strings' })).not.toBeInTheDocument();
    await listen();
    expect(screen.getByLabelText('A2')).toBeInTheDocument();
    expect(screen.getByTestId('tuner-cents')).toHaveTextContent('+12');
  });

  it('hints about headphones while a song plays', async () => {
    const { listen, services } = await setup();
    await listen();
    expect(screen.queryByText(/Use headphones/)).not.toBeInTheDocument();
    act(() => {
      services.playback.setState({ transport: 'playing' });
    });
    expect(screen.getByText(/Use headphones/)).toBeInTheDocument();
  });

  it('dims a held reading and says nothing to tune once it clears', async () => {
    const { listen, rig } = await setup();
    await listen();
    rig.hear.hz = undefined;
    act(() => {
      rig.tick(5);
    });
    expect(screen.getByTestId('tuner-note')).toHaveAttribute('data-held', 'true');
    act(() => {
      rig.tick(80);
    });
    expect(screen.getByText('Play a string')).toBeInTheDocument();
  });

  it('turns the in-tune state on for a string at pitch', async () => {
    const { listen, rig } = await setup();
    rig.hear.hz = 110;
    await listen();
    act(() => {
      rig.tick(10);
    });
    expect(screen.getByText('In tune')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Tuning' })).toHaveAttribute(
      'aria-valuetext',
      'A2, in tune',
    );
  });

  it('stops capture when the panel unmounts', async () => {
    const { listen, rig, unmount } = await setup();
    await listen();
    unmount();
    expect(rig.captures[0]?.closed).toBe(true);
    expect(rig.streams[0]?.track.stop).toHaveBeenCalled();
    expect(rig.contexts[0]?.close).toHaveBeenCalled();
  });
});
