import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fourBars, positionEventAt } from '@/test/position';

import { renderBar } from './test/render-bar';

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Tempo in BPM' });
const speed = () => screen.getByRole('slider', { name: 'Speed' });
const percentButton = () => screen.getByRole('button', { name: /^Relative speed/ });

describe('TempoControl', () => {
  it('is disabled with no song', () => {
    renderBar();
    expect(field()).toBeDisabled();
    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('aria-keyshortcuts', 'Alt+T');
    expect(percentButton()).toBeDisabled();
  });

  it('shows its tooltip on hover with the key', async () => {
    const { open } = renderBar();
    await open(fourBars());
    await userEvent.setup().hover(field());
    const tip = await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tip).toHaveTextContent(/^Quarter notes per minute, \w+\+T$/);
  });

  it('never opens its tooltip on focus, so it cannot cover the number', async () => {
    const { open } = renderBar();
    await open(fourBars());
    act(() => {
      field().focus();
    });
    // Radix opens on focus synchronously, so there is nothing to wait for.
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(field()).toHaveAttribute('data-state', 'closed');
  });

  it('shows both step keys in the speed slider tooltip', async () => {
    const { open } = renderBar();
    await open(fourBars());
    const wrapper = speed().closest('[data-commands]');
    if (!wrapper) throw new Error('no slider wrapper');
    fireEvent.pointerMove(wrapper);
    await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    const content = document.querySelector('[data-slot=tooltip-content]');
    expect(content).toHaveTextContent('Speed');
    const caps = [...(content?.querySelectorAll('[data-slot=kbd]') ?? [])];
    expect(caps.map((cap) => cap.textContent)).toEqual(['[', ']']);
  });

  it('links the slider to the BPM field', async () => {
    const { services, open } = renderBar();
    await open(fourBars());
    expect(field()).toHaveValue('120');

    speed().focus();
    fireEvent.keyDown(speed(), { key: 'PageDown' });
    const value = Number(speed().getAttribute('aria-valuenow'));
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('percent', value);
    expect(field()).toHaveValue(String(Math.round((120 * value) / 100)));

    act(() => {
      services.audio.setTempo('percent', 75);
    });
    expect(field()).toHaveValue('90');
  });

  it('in fixed tempo the field takes the BPM as typed and the slider is disabled', async () => {
    const { services, open } = renderBar();
    const user = userEvent.setup();
    const song = fourBars();
    await open(song);
    expect(screen.queryByTestId('fixed-tempo-marker')).toBeNull();
    act(() => {
      services.audio.setTempo('bpm', 90);
    });
    expect(field()).toHaveValue('90');
    expect(screen.getByTestId('fixed-tempo-marker')).toHaveTextContent('Fixed');
    expect(speed()).toHaveAttribute('data-disabled');
    expect(speed()).toHaveAttribute('aria-valuenow', '100');
    expect(speed()).toHaveAccessibleDescription(/Fixed tempo is on/);
    expect(percentButton()).toHaveAttribute('aria-pressed', 'false');
    expect(percentButton()).toHaveTextContent('–');
    expect(percentButton()).toBeDisabled();

    await user.click(field());
    await user.keyboard('100{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('bpm', 100);
    await user.click(field());
    await user.keyboard('500{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('bpm', 400);
    act(() => {
      services.audio.setTempo('bpm', 90);
    });

    // Past the tempo mark in bar 3 the field still shows the fixed BPM.
    act(() => {
      services.playback.setState({
        position: positionEventAt(services.document.getState().score ?? song, 2 * 3840),
      });
    });
    expect(field()).toHaveValue('90');
    expect(speed()).toHaveAttribute('aria-valuenow', '100');
  });

  it('turns a typed BPM into a percent, at the written tempo under the playhead', async () => {
    const { services, open } = renderBar();
    const user = userEvent.setup();
    const song = fourBars();
    await open(song);

    await user.click(field());
    await user.keyboard('90{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('percent', 75);
    expect(speed()).toHaveAttribute('aria-valuenow', '75');
    expect(percentButton()).toHaveTextContent('75%');
    expect(field()).toHaveValue('90');

    // Bar 3 carries a tempo mark of 160.
    act(() => {
      services.playback.setState({
        position: positionEventAt(services.document.getState().score ?? song, 2 * 3840),
      });
    });
    expect(field()).toHaveValue('120');
    await user.click(field());
    await user.keyboard('80{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('percent', 50);
  });

  it('clamps to 25–200%, reverts with Escape or an invalid value, and steps with the arrows', async () => {
    const { services, open } = renderBar();
    const user = userEvent.setup();
    await open(fourBars());

    await user.click(field());
    await user.keyboard('500{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('percent', 200);
    expect(field()).toHaveValue('240');

    await user.click(field());
    await user.keyboard('10{Enter}');
    expect(services.fakeAudio.setTempo).toHaveBeenLastCalledWith('percent', 25);
    expect(field()).toHaveValue('30');

    const calls = services.fakeAudio.setTempo.mock.calls.length;
    await user.click(field());
    await user.keyboard('99{Escape}');
    expect(field()).toHaveValue('30');
    await user.click(field());
    await user.keyboard('abc');
    await user.tab();
    expect(field()).toHaveValue('30');
    expect(services.fakeAudio.setTempo).toHaveBeenCalledTimes(calls);

    await user.click(field());
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('31');
    expect(field()).toHaveFocus();
  });

  it('focuses the field for Set tempo and toggles the relative speed', async () => {
    const { services, open, registry } = renderBar();
    await open(fourBars());

    act(() => {
      void registry.get('transport.setTempo')?.run();
    });
    expect(field()).toHaveFocus();

    act(() => {
      services.audio.setTempo('percent', 75);
    });
    const user = userEvent.setup();
    await user.click(percentButton());
    expect(percentButton()).toHaveTextContent('100%');
    await user.click(percentButton());
    expect(percentButton()).toHaveTextContent('75%');
  });
});
