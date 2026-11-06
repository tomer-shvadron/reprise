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
    // A dotted-quarter mark still reads in quarter notes, so the field says which.
    expect(field()).toHaveAttribute('title', 'Quarter notes per minute · Set tempo… (⌥T)');
    expect(percentButton()).toBeDisabled();
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
