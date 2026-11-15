import { write } from '@reprise/formats';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { createEntryStore } from './entry-store';
import { EditStatusLine } from './status-line';
import { entryScore } from './test/entry-scores';

async function setup() {
  const services = createTestServices();
  const entry = createEntryStore();
  await services.document
    .getState()
    .openBytes('entry.reprise', (await write(entryScore(), 'reprise')).bytes);
  const score = services.document.getState().score;
  if (!score) throw new Error('not open');
  const cursor = cursorAtPosition(
    score,
    { track: 0, bar: 2, voice: 0, stop: 1 },
    { string: 4, staff: 'tab' },
  );
  services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  render(<EditStatusLine {...services} entry={entry} />);
  return { services, entry };
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
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Overwrite · Voice 1 · Quarter · Bar 3 · Beat 2 · String 4');
    act(() => {
      entry.getState().setMode('insert');
      entry.getState().setRhythm({ duration: 8, dots: 1, tuplet: undefined });
    });
    expect(status.textContent).toContain('Insert · Voice 1 · Dotted eighth');
  });

  it('shows a waiting digit and the last refusal', async () => {
    const { services, entry } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
      const cursor = services.selection.getState().cursor;
      if (cursor) entry.getState().setPending({ fret: 1, cursor });
      entry.getState().setMessage('Bar 2 has an eighth left: a quarter does not fit');
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Fret 1…');
    expect(status.textContent).toContain('Bar 2 has an eighth left: a quarter does not fit');
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
    expect(screen.getByRole('status').textContent).toContain(
      'Voice 2 · Quarter · Bar 1 · End of bar',
    );
  });
});
