import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fetchFixture } from '@/test/assets';
import { positionEventAt } from '@/test/position';

import { renderBar } from './test/render-bar';

const field = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Tempo in BPM' });

// In a browser only because it reads a fixture; the audio is the fake one.
describe('TempoControl over a fixture', () => {
  it('shows the written tempo at the new speed after a speed change while paused', async () => {
    const { services } = renderBar();
    const bytes = await fetchFixture('gp/beat-tempo-change.gp');
    await act(async () => {
      await services.document.getState().openBytes('beat-tempo-change.gp', bytes);
    });
    const { score } = services.document.getState();
    if (!score) throw new Error('the fixture did not open');
    const seek = (tick: number) => {
      act(() => {
        services.playback.setState({ position: positionEventAt(score, tick) });
      });
    };
    const speed = (value: number) => {
      act(() => {
        services.audio.setTempo('percent', value);
      });
    };

    speed(25);
    expect(field()).toHaveValue('30');
    // 120 at tick 5760 and 121 at 7680 both show 30 at 25%.
    seek(5760);
    seek(7680);
    expect(field()).toHaveValue('30');
    speed(200);
    expect(field()).toHaveValue('242');
    speed(100);
    expect(field()).toHaveValue('121');
    speed(105);
    expect(field()).toHaveValue('127');
  });
});
