import { layout } from '@reprise/layout';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { viewLayoutOptions } from '@/features/score';

import { editScore } from '../test/scores';
import { EditDemo } from './edit-demo';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

describe('the edit demo', () => {
  it('places the cursor on a clicked note, and the arrows, Shift and Escape update the overlays', async () => {
    stubViewport(1280, 800);
    const score = editScore();
    const result = layout(
      score,
      viewLayoutOptions({ mode: 'paged', paper: 'a4' }, { tracks: 'all', notation: {} }),
    );
    render(<EditDemo score={score} mode="paged" notation="default" />);
    const status = async (text: RegExp) => {
      await waitFor(() => {
        expect(screen.getByTestId('edit-status').textContent).toMatch(text);
      });
    };
    await status(/track 1, bar 1, stop 1,/);
    const canvas = screen
      .getByRole('region', { name: 'Edit demo score' })
      .querySelector<HTMLElement>('.score-canvas');
    if (!canvas) throw new Error('no canvas');

    const note = score.tracks[0]?.bars[0]?.voices[0]?.beats[2]?.notes[0];
    const anchor = result.anchors.find((a) => a.kind === 'note' && a.id === note?.id);
    if (!anchor) throw new Error('no note anchor');
    const at = {
      clientX: anchor.bbox.x + anchor.bbox.width / 2,
      clientY: anchor.bbox.y + anchor.bbox.height / 2,
      button: 0,
    };
    fireEvent.pointerDown(canvas, at);
    fireEvent.pointerUp(canvas, at);
    await status(/stop 3,.*1 notes picked/);
    const overlays = () => canvas.parentElement?.querySelector('.score-overlays');
    expect(overlays()?.querySelectorAll('.score-caret').length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await status(/stop 4,/);
    expect(screen.getByTestId('edit-status').textContent).not.toMatch(/notes picked/);

    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    await status(/stop 3, .*beats range/);
    expect(overlays()?.querySelectorAll('.score-range')).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    await status(/stop 3, voice 1, string \d \(\w+\)$/);
    expect(overlays()?.querySelectorAll('.score-range')).toHaveLength(0);
  });
});
