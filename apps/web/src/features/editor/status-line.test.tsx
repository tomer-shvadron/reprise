import { write } from '@reprise/formats';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderHeader, spyOnCommand } from '@/app/header/test/render-header';
import { useAppServices } from '@/app/services-context';

import { cursorAtPosition } from './cursor';
import { EditStatusLine } from './status-line';
import { drumScore } from './test/drum-scores';
import { entryScore } from './test/entry-scores';

function Line() {
  const services = useAppServices();
  return <EditStatusLine {...services} />;
}

async function setup() {
  const { services, registry } = renderHeader(<Line />);
  const entry = services.entry;
  await act(async () => {
    await services.document
      .getState()
      .openBytes('entry.reprise', (await write(entryScore(), 'reprise')).bytes);
  });
  const score = services.document.getState().score;
  if (!score) throw new Error('not open');
  const cursor = cursorAtPosition(
    score,
    { track: 0, bar: 2, voice: 0, stop: 1 },
    { string: 4, staff: 'tab' },
  );
  act(() => {
    services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  });
  return { services, entry, registry };
}

describe('EditStatusLine', () => {
  it('shows nothing outside edit mode', async () => {
    await setup();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reads the mode, voice, duration and place while editing', async () => {
    const { services, entry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const status = screen.getByTestId('edit-status');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(status.textContent).toBe('Overwrite · Voice 1 · Quarter · Bar 3 · Beat 2 · String 4');
    act(() => {
      entry.getState().setMode('insert');
      entry.getState().setRhythm({ duration: 8, dots: 1, tuplet: undefined });
    });
    expect(status.textContent).toContain('Insert · Voice 1 · Dotted eighth');
  });

  it('names the drum lane on a drum track, and a waiting digit as a drum number', async () => {
    const { services, entry } = await setup();
    await act(async () => {
      await services.document
        .getState()
        .openBytes('drums.reprise', (await write(drumScore(), 'reprise')).bytes);
    });
    const score = services.document.getState().score;
    const cursor =
      score &&
      cursorAtPosition(
        score,
        { track: 0, bar: 1, voice: 0, stop: 1 },
        { string: 0, staff: 'percussion' },
      );
    act(() => {
      services.editing.getState().setEditing(true);
      services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
    });
    const status = screen.getByTestId('edit-status');
    expect(status.textContent).toBe(
      'Overwrite · Voice 1 · Quarter · Bar 2 · Beat 2 · Acoustic Snare (38)',
    );
    act(() => {
      if (cursor) services.selection.getState().setEdit({ cursor: { ...cursor, pitch: 42 } });
    });
    expect(status.textContent).toContain('Closed Hi-Hat (42)');
    act(() => {
      if (cursor) entry.getState().setPending({ fret: 3, cursor });
    });
    expect(status.textContent).toContain('Drum 3…');
  });

  it('shows a waiting digit and the last refusal', async () => {
    const { services, entry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
      const cursor = services.selection.getState().cursor;
      if (cursor) entry.getState().setPending({ fret: 1, cursor });
      entry.getState().setMessage('Bar 2 has an eighth left: a quarter does not fit');
    });
    expect(screen.getByTestId('edit-status').textContent).toContain('Fret 1…');
    // Only the refusal is the live region.
    expect(screen.getByRole('status').textContent).toBe(
      'Bar 2 has an eighth left: a quarter does not fit',
    );
  });

  it('shows a notice as information, not as an error, and a refusal after it as one again', async () => {
    const { services, entry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
      entry.getState().setMessage('Pasted 4 bars', 'notice');
    });
    expect(screen.getByRole('status').className).not.toContain('text-destructive');
    act(() => {
      entry.getState().setMessage('Bar 2 is full: a quarter does not fit');
    });
    expect(screen.getByRole('status').className).toContain('text-destructive');
  });

  it('names the end of a bar and the voice', async () => {
    const { services } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
      const score = services.document.getState().score;
      const cursor =
        score &&
        cursorAtPosition(
          score,
          { track: 0, bar: 0, voice: 1, stop: 0 },
          { string: 1, staff: 'tab' },
        );
      services.selection.getState().setEdit({ cursor });
    });
    expect(screen.getByTestId('edit-status').textContent).toContain(
      'Voice 2 · Quarter · Bar 1 · End of bar',
    );
  });

  it('runs the mode, voice and duration commands from its segments', async () => {
    const { services, registry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const user = userEvent.setup();
    const toggle = spyOnCommand(registry, 'editor.toggleInsertMode');
    await user.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(toggle).toHaveBeenCalledOnce();

    const voice2 = spyOnCommand(registry, 'editor.editVoice2');
    await user.click(screen.getByRole('button', { name: 'Voice 1' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Voice 2/ }));
    expect(voice2).toHaveBeenCalledOnce();

    const dot = spyOnCommand(registry, 'editor.toggleDot');
    await user.click(screen.getByRole('button', { name: 'Quarter' }));
    await user.click(await screen.findByRole('menuitem', { name: /Dotted/ }));
    expect(dot).toHaveBeenCalledOnce();
    // A step keeps the menu open, so it can repeat.
    expect(screen.getByRole('menuitem', { name: /Dotted/ })).toBeInTheDocument();
  });

  it('opens the palette on a bar number from the position, and does not move focus on mousedown', async () => {
    const { services, registry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    const palette = spyOnCommand(registry, 'app.goToBar');
    const position = screen.getByRole('button', { name: 'Bar 3 · Beat 2 · String 4' });
    expect(fireEvent.mouseDown(position)).toBe(false);
    await userEvent.setup().click(position);
    expect(palette).toHaveBeenCalledOnce();
  });
});
