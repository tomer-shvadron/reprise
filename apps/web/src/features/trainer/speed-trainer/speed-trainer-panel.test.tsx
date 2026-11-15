import { write } from '@reprise/formats';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { CommandSourceContext } from '@/app/use-command';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { SpeedTrainerPanel } from './speed-trainer-panel';
import { speedTrainerFor } from './speed-trainer-for';

async function setup(options: { loop?: boolean } = {}) {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const result = renderWithServices(
    <CommandSourceContext value={{ registry, keyboard: 'mac' }}>
      <SpeedTrainerPanel />
    </CommandSourceContext>,
    services,
  );
  const { bytes } = await write(fourBars(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const bars = services.document.getState().score?.masterBars ?? [];
  const [first, second] = bars;
  if (!first || !second) throw new Error('bars');
  if (options.loop ?? true) {
    act(() => {
      services.fakeAudio.setLoop({ startBar: first.id, endBar: second.id });
    });
  }
  let pass = 0;
  const loop = () => {
    pass += 1;
    act(() => {
      services.playback.setState({ lastLoop: { pass, when: pass } });
    });
  };
  const field = (name: string) => screen.getByRole('textbox', { name });
  const commit = (name: string, text: string) => {
    fireEvent.change(field(name), { target: { value: text } });
    fireEvent.keyDown(field(name), { key: 'Enter' });
  };
  return { ...result, services, loop, field, commit, user: userEvent.setup() };
}

describe('SpeedTrainerPanel', () => {
  it('asks for a loop first, and the button loops the selection', async () => {
    const { services, user } = await setup({ loop: false });
    expect(screen.getByTestId('speed-trainer-loop')).toHaveTextContent(
      'Select bars and loop them to train',
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Loop selection' }));
    expect(services.playback.getState().settings.loop).toBeDefined();
    expect(screen.getByTestId('speed-trainer-loop')).toHaveTextContent('Bars 1–4');
  });

  it('labels the loop and the written tempo', async () => {
    await setup();
    expect(screen.getByTestId('speed-trainer-loop')).toHaveTextContent('Bars 1–2');
    expect(screen.getByText(/Written tempo at bar 1: 120 BPM/)).toBeInTheDocument();
  });

  it('converts the shown values when the unit changes', async () => {
    const { field, user } = await setup();
    expect(field('Start')).toHaveValue('70');
    await user.click(screen.getByRole('radio', { name: 'BPM' }));
    expect(field('Start')).toHaveValue('84');
    expect(field('Step')).toHaveValue('6');
    expect(field('Target')).toHaveValue('120');
    await user.click(screen.getByRole('radio', { name: 'Percent' }));
    expect(field('Start')).toHaveValue('70');
  });

  it('commits a valid value on Enter and reverts an invalid one', async () => {
    const { field, commit } = await setup();
    commit('Start', '80');
    expect(field('Start')).toHaveValue('80');
    commit('Start', 'abc');
    expect(field('Start')).toHaveValue('80');
    commit('Target', '500');
    expect(field('Target')).toHaveValue('100');
    commit('Repetitions per step', '3');
    expect(field('Repetitions per step')).toHaveValue('3');
    commit('Repetitions per step', '0');
    expect(field('Repetitions per step')).toHaveValue('3');
  });

  it('follows the run through its steps and disables the setup while running', async () => {
    const { services, loop, commit, field, user } = await setup();
    commit('Start', '90');
    commit('Step', '5');
    commit('Target', '100');
    commit('Repetitions per step', '2');

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('speed-trainer-tempo')).toHaveTextContent('90 % 108 BPM');
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Pass 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Next: 95 % · 114 BPM')).toBeInTheDocument();
    expect(field('Start')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Running');

    loop();
    expect(screen.getByText('Pass 2 of 2')).toBeInTheDocument();
    loop();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('speed-trainer-tempo')).toHaveTextContent('95 %');
    const bar = screen.getByRole('progressbar', { name: 'Progress to target' });
    expect(bar).toHaveAttribute('aria-valuetext', 'Step 2 of 3, 95 % · 114 BPM');
    expect(bar).toHaveAttribute('aria-valuenow', '50');

    loop();
    loop();
    loop();
    loop();
    expect(screen.getByText('Target reached')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Done');
    expect(services.playback.getState().settings.tempo.value).toBe(100);
  });

  it('labels the main button by state, and holds and resets', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByRole('button', { name: 'Hold' }));
    expect(screen.getByRole('status')).toHaveTextContent('Held');
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('status')).toHaveTextContent('Running');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('marks a pass missed from the button', async () => {
    const { services, user } = await setup();
    expect(screen.getByRole('button', { name: 'Missed pass' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByRole('button', { name: 'Missed pass' }));
    expect(speedTrainerFor(services).getState().missed).toBe(true);
  });

  it('keeps the run when the panel unmounts', async () => {
    const { services, user, unmount } = await setup();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    unmount();
    expect(speedTrainerFor(services).getState().status).toBe('running');
    expect(within(document.body).queryByRole('region')).toBeNull();
  });
});
