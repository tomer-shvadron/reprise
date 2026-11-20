import { write } from '@reprise/formats';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { CommandSourceContext } from '@/app/use-command';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { SpeedTrainerChip, TunerButton } from './practice-chips';
import { speedTrainerFor } from './speed-trainer/speed-trainer-for';

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  renderWithServices(
    <CommandSourceContext value={{ registry, keyboard: 'mac' }}>
      <SpeedTrainerChip />
      <TunerButton />
    </CommandSourceContext>,
    services,
  );
  const { bytes } = await write(fourBars(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const [first, second] = services.document.getState().score?.masterBars ?? [];
  if (!first || !second) throw new Error('bars');
  act(() => {
    services.fakeAudio.setLoop({ startBar: first.id, endBar: second.id });
  });
  return { services, user: userEvent.setup() };
}

describe('SpeedTrainerChip', () => {
  it('reads off, then follows a run pass by pass', async () => {
    const { services } = await setup();
    const chip = screen.getByTestId('speed-trainer-chip');
    expect(chip).toHaveAccessibleName('Trainer off (speed trainer)');
    expect(chip).toHaveAttribute('data-status', 'idle');

    const trainer = speedTrainerFor(services);
    act(() => {
      trainer.getState().start();
    });
    const { repsPerStep } = trainer.getState().config;
    expect(chip).toHaveAttribute('data-status', 'running');
    expect(chip).toHaveAccessibleName(
      new RegExp(
        `^\\d+% · 1/${String(repsPerStep)} \\(speed trainer running, \\d+ percent of \\d+, pass 1 of ${String(repsPerStep)}\\)$`,
      ),
    );
    expect(chip).toHaveTextContent(`· 1/${String(repsPerStep)}`);

    act(() => {
      services.playback.setState({ lastLoop: { pass: 1, when: 1 } });
    });
    expect(chip).toHaveTextContent(`· 2/${String(repsPerStep)}`);

    act(() => {
      trainer.getState().hold();
    });
    expect(chip).toHaveTextContent('held');
  });

  it('shows the speed trainer in the panel and leaves focus where it was', async () => {
    const { services, user } = await setup();
    act(() => {
      services.ui.getState().showPanelView('mixer');
    });
    const sibling = document.createElement('input');
    document.body.append(sibling);
    sibling.focus();
    const chip = screen.getByTestId('speed-trainer-chip');
    await user.click(chip);
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    expect(services.ui.getState().panels.rightPanel).toBe(true);
    expect(chip).not.toHaveFocus();
    expect(sibling).toHaveFocus();
    sibling.remove();
  });

  it('reaches done with a full bar and one clear name, then resets to off', async () => {
    const { services } = await setup();
    const trainer = speedTrainerFor(services);
    const chip = screen.getByTestId('speed-trainer-chip');
    act(() => {
      trainer.getState().start();
    });
    const bar = screen.getByTestId('speed-trainer-chip-bar');
    expect(bar.style.width).toBe('0%');
    act(() => {
      trainer.setState({ stepIndex: 3 });
    });
    const plan = trainer.getState().plan?.percents ?? [];
    const first = plan[0] ?? 0;
    const span = (plan.at(-1) ?? 1) - first;
    expect(bar.style.width).toBe(`${String(Math.round((((plan[3] ?? 0) - first) / span) * 100))}%`);
    act(() => {
      trainer.setState({ status: 'done' });
    });
    expect(chip).toHaveAttribute('data-status', 'done');
    expect(chip).toHaveTextContent('Done');
    expect(chip).toHaveAccessibleName(/^Done \(speed trainer reached \d+ percent\)$/);
    expect(screen.getByTestId('speed-trainer-chip-bar').style.width).toBe('100%');
    act(() => {
      trainer.getState().reset();
    });
    expect(chip).toHaveAccessibleName('Trainer off (speed trainer)');
    expect(chip).toHaveTextContent('Trainer off');
    expect(trainer.getState().plan).toBeDefined();
  });

  it('draws a descending ramp from empty to full', async () => {
    const { services } = await setup();
    const trainer = speedTrainerFor(services);
    act(() => {
      trainer.getState().setConfig({ start: 100, step: 10, target: 80 });
      trainer.getState().start();
    });
    const bar = screen.getByTestId('speed-trainer-chip-bar');
    expect(bar.style.width).toBe('0%');
    act(() => {
      trainer.setState({ stepIndex: 1 });
    });
    expect(bar.style.width).toBe('50%');
    act(() => {
      trainer.setState({ stepIndex: 2 });
    });
    expect(bar.style.width).toBe('100%');
  });
});

describe('SpeedTrainerChip text', () => {
  const variants = [
    ['auto', 'min-[1100px]:inline'],
    ['always', 'inline'],
    ['never', 'hidden'],
  ] as const;
  it.each(variants)('keeps the name with text=%s', (text, className) => {
    const services = createTestServices();
    mirrorAudio(services);
    const registry = createAppRegistry(services);
    renderWithServices(
      <CommandSourceContext value={{ registry, keyboard: 'mac' }}>
        <SpeedTrainerChip text={text} />
      </CommandSourceContext>,
      services,
    );
    expect(screen.getByTestId('speed-trainer-chip-text').className).toContain(className);
    expect(screen.getByTestId('speed-trainer-chip')).toHaveAccessibleName(
      'Trainer off (speed trainer)',
    );
  });
});

describe('TunerButton', () => {
  it('shows the tuner in the panel and leaves focus where it was', async () => {
    const { services, user } = await setup();
    const sibling = document.createElement('input');
    document.body.append(sibling);
    sibling.focus();
    const button = screen.getByRole('button', { name: 'Tuner' });
    await user.click(button);
    expect(services.ui.getState().rightPanelView).toBe('tuner');
    expect(services.ui.getState().panels.rightPanel).toBe(true);
    expect(button).not.toHaveFocus();
    expect(sibling).toHaveFocus();
    sibling.remove();
  });
});
