import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';
import type { EditCursor } from '@/state/selection';

import { cursorAtPosition } from './cursor';
import { entryController, installEntry, TWO_DIGIT_MS } from './entry-controller';
import { createEntryStore } from './entry-store';
import { entryScore } from './test/entry-scores';

async function setup(built: Score = entryScore()) {
  const services = createTestServices();
  const entry = createEntryStore();
  const preview = vi.fn();
  const dispose = installEntry({ ...services, entry, preview });
  await services.document
    .getState()
    .openBytes('entry.reprise', (await write(built, 'reprise')).bytes);
  const score = () => {
    const found = services.document.getState().score;
    if (!found) throw new Error('not open');
    return found;
  };
  const cursorAt = (bar: number, stop: number, string = 1, voice = 0): EditCursor => {
    const cursor = cursorAtPosition(
      score(),
      { track: 0, bar, voice, stop },
      { string, staff: 'tab' },
    );
    if (!cursor) throw new Error('no such stop');
    return cursor;
  };
  const goTo = (bar: number, stop: number, string = 1, voice = 0) => {
    const cursor = cursorAt(bar, stop, string, voice);
    services.selection.getState().setEdit({ cursor, currentTrack: cursor.track });
  };
  services.editing.getState().setEditing(true);
  goTo(0, 0);
  const controller = () => {
    const found = entryController(entry);
    if (!found) throw new Error('not installed');
    return found;
  };
  const doc = () => services.document.getState();
  const beats = (bar: number, voice = 0) =>
    score().tracks[0]?.bars[bar]?.voices[voice]?.beats ?? [];
  return { services, entry, preview, dispose, score, goTo, controller, doc, beats, cursorAt };
}

describe('installEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits 0 and 3 to 9 at once: one entry, one preview', async () => {
    const { controller, doc, preview, beats, score } = await setup();
    const before = doc().revision;
    controller().fret(3);
    expect(doc().revision).toBe(before + 1);
    expect(beats(0)[0]?.notes[0]).toMatchObject({ string: 1, fret: 3 });
    expect(preview).toHaveBeenCalledTimes(1);
    // The default quarter at 120 bpm, at the dynamic a new note gets (f).
    expect(preview).toHaveBeenCalledWith(
      score().tracks[0]?.id,
      { string: 1, fret: 3 },
      { velocity: 95, seconds: 0.5 },
    );
    controller().fret(0);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(0);
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('waits after a 1 or a 2 on 24 frets, and a second digit makes one two-digit entry', async () => {
    const { controller, doc, preview, beats, entry } = await setup();
    const before = doc().revision;
    controller().fret(1);
    expect(entry.getState().pending?.fret).toBe(1);
    expect(doc().revision).toBe(before);
    controller().fret(2);
    expect(entry.getState().pending).toBeUndefined();
    expect(doc().revision).toBe(before + 1);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(12);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[1]).toEqual({ string: 1, fret: 12 });
    vi.advanceTimersByTime(TWO_DIGIT_MS * 2);
    expect(doc().revision).toBe(before + 1);
  });

  it('commits a waiting digit after the timeout', async () => {
    const { controller, doc, beats } = await setup();
    const before = doc().revision;
    controller().fret(2);
    vi.advanceTimersByTime(TWO_DIGIT_MS - 1);
    expect(doc().revision).toBe(before);
    vi.advanceTimersByTime(1);
    expect(doc().revision).toBe(before + 1);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(2);
  });

  it('starts a new entry when the second digit would pass the last fret: 2 then 5 is two entries', async () => {
    const { controller, doc, beats } = await setup();
    const before = doc().revision;
    controller().fret(2);
    controller().fret(5);
    // The 2 was entered as a new beat and the cursor stayed on it, so the 5 replaces it.
    expect(doc().revision).toBe(before + 2);
    expect(beats(0)).toHaveLength(1);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(5);
  });

  it('waits only for a digit that can start a fret on the neck', async () => {
    const built = entryScore();
    const { controller, entry, doc } = await setup({
      ...built,
      tracks: built.tracks.map((track) => ({ ...track, fretCount: 12 })),
    });
    const before = doc().revision;
    controller().fret(2);
    expect(entry.getState().pending).toBeUndefined();
    expect(doc().revision).toBe(before + 1);
    controller().fret(1);
    expect(entry.getState().pending?.fret).toBe(1);
    controller().fret(3);
    // 13 is past the 12th fret: the 1 commits, then the 3 is its own entry.
    expect(doc().revision).toBe(before + 3);
  });

  it('commits a waiting digit on any other key, before the shortcut dispatcher sees it', async () => {
    const { controller, doc, beats } = await setup();
    const before = doc().revision;
    controller().fret(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(doc().revision).toBe(before + 1);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(1);
    controller().fret(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(doc().revision).toBe(before + 1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    expect(doc().revision).toBe(before + 2);
  });

  it('commits a waiting digit on a pointer press, and when edit mode turns off', async () => {
    const { controller, doc, services } = await setup();
    const before = doc().revision;
    controller().fret(1);
    window.dispatchEvent(new Event('pointerdown'));
    expect(doc().revision).toBe(before + 1);
    controller().fret(2);
    services.editing.getState().setEditing(false);
    expect(doc().revision).toBe(before + 2);
  });

  it('cancels a waiting digit with Escape, which then does not clear the selection', async () => {
    const { controller, doc, entry } = await setup();
    const before = doc().revision;
    controller().fret(1);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(entry.getState().pending).toBeUndefined();
    vi.advanceTimersByTime(TWO_DIGIT_MS * 2);
    expect(doc().revision).toBe(before);
    const idle = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
  });

  it('lands the entry on the beat and string typed at, after the cursor moved away', async () => {
    const { controller, goTo, services, beats, cursorAt } = await setup();
    goTo(2, 1, 2);
    controller().fret(1);
    const away = cursorAt(2, 3, 4);
    services.selection.getState().setEdit({ cursor: away });
    expect(beats(2)[1]?.notes.find((n) => n.string === 2)?.fret).toBe(1);
    expect(services.selection.getState().cursor).toBe(away);
  });

  it('makes each entry exactly one history step, and one undo restores the score', async () => {
    const { controller, doc, goTo, score, services } = await setup();
    const cases: [string, () => void][] = [
      [
        'fret at the end slot',
        () => {
          goTo(0, 0);
          controller().fret(5);
        },
      ],
      [
        'fret on a beat',
        () => {
          goTo(2, 0);
          controller().fret(9);
        },
      ],
      [
        'two-digit fret',
        () => {
          goTo(2, 0);
          controller().fret(1);
          controller().fret(2);
        },
      ],
      [
        'rest',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'rest' });
        },
      ],
      [
        'tie',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'tie' });
        },
      ],
      [
        'insert after',
        () => {
          goTo(1, 3);
          controller().act({ kind: 'insertAfter' });
        },
      ],
      [
        'shorter',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'shorter' });
        },
      ],
      [
        'delete note',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'deleteNote' });
        },
      ],
      [
        'insert-mode insertion in the middle of a bar',
        () => {
          services.entry.getState().setMode('insert');
          services.entry.getState().setRhythm({ duration: 8, dots: 0, tuplet: undefined });
          goTo(1, 0);
          controller().fret(4);
          services.entry.getState().setMode('overwrite');
        },
      ],
      [
        'dot',
        () => {
          goTo(1, 3);
          controller().act({ kind: 'dot' });
        },
      ],
      [
        'triplet',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'triplet' });
        },
      ],
      [
        'delete beat',
        () => {
          goTo(2, 1);
          controller().act({ kind: 'deleteBeat' });
        },
      ],
    ];
    for (const [name, enter] of cases) {
      const before = score();
      const revision = doc().revision;
      enter();
      expect(doc().revision, name).toBe(revision + 1);
      expect(score(), name).not.toBe(before);
      doc().undo();
      // Undo rebuilds the nodes it touched, so the score is equal, not the same object.
      expect(score(), name).toEqual(before);
    }
  });

  it('refuses an overfull entry with the room left, touching neither the score nor the history', async () => {
    const { controller, doc, goTo, entry, preview, score, services } = await setup();
    goTo(1, 4);
    const before = score();
    const label = doc().undoLabel;
    const revision = doc().revision;
    controller().fret(3);
    expect(entry.getState().message).toBe('Bar 2 has an eighth left: a quarter does not fit');
    expect(score()).toBe(before);
    expect(doc().revision).toBe(revision);
    expect(doc().undoLabel).toBe(label);
    expect(preview).not.toHaveBeenCalled();
    const cursor = services.selection.getState().cursor;
    if (cursor) services.selection.getState().setEdit({ cursor: { ...cursor, string: 2 } });
    expect(entry.getState().message).toBeUndefined();
  });

  it('keeps the edit when the preview throws', async () => {
    const { controller, doc, preview } = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    preview.mockImplementation(() => {
      throw new RangeError('no such string');
    });
    const revision = doc().revision;
    controller().fret(4);
    expect(doc().revision).toBe(revision + 1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('does not sound a rest, and sounds a tied note with its origin fret', async () => {
    const { controller, goTo, preview } = await setup();
    goTo(2, 1);
    controller().act({ kind: 'rest' });
    expect(preview).not.toHaveBeenCalled();
    goTo(2, 2, 1);
    controller().act({ kind: 'tie' });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[1]).toEqual({ string: 1, fret: 5 });
  });

  it('lands the cursor on the inserted beat and takes chord notes there in insert mode', async () => {
    const { controller, entry, goTo, services, beats, doc } = await setup();
    entry.getState().setMode('insert');
    goTo(0, 0);
    controller().fret(5);
    const first = beats(0)[0];
    expect(services.selection.getState().cursor?.beat).toBe(first?.id);
    expect(entry.getState().inserted).toBe(first?.id);
    const revision = doc().revision;
    const cursor = services.selection.getState().cursor;
    if (cursor) services.selection.getState().setEdit({ cursor: { ...cursor, string: 3 } });
    expect(entry.getState().inserted).toBe(first?.id);
    controller().fret(7);
    expect(doc().revision).toBe(revision + 1);
    expect(beats(0)).toHaveLength(1);
    expect(beats(0)[0]?.notes.map((n) => n.fret)).toEqual([5, 7]);
  });

  it('mirrors the rhythm of the beat the cursor sits on, and keeps it at the end slot', async () => {
    const { entry, goTo } = await setup();
    goTo(1, 3);
    expect(entry.getState().rhythm).toMatchObject({ duration: 8 });
    goTo(0, 0);
    expect(entry.getState().rhythm).toMatchObject({ duration: 8 });
    goTo(2, 0);
    expect(entry.getState().rhythm).toMatchObject({ duration: 4 });
  });

  it('applies a rhythm key at the end slot to the current rhythm only', async () => {
    const { controller, entry, doc, goTo } = await setup();
    goTo(0, 0);
    const revision = doc().revision;
    controller().act({ kind: 'shorter' });
    expect(doc().revision).toBe(revision);
    expect(entry.getState().rhythm.duration).toBe(8);
    controller().fret(4);
    expect(doc().revision).toBe(revision + 1);
  });

  it('appends a bar past a full last bar as its own undo step, and lands on it', async () => {
    const { controller, goTo, doc, score, services } = await setup();
    goTo(2, 3);
    const before = score();
    const revision = doc().revision;
    expect(controller().appendBar()).toBe(true);
    expect(doc().revision).toBe(revision + 1);
    expect(score().masterBars).toHaveLength(4);
    expect(services.selection.getState().cursor?.masterBar).toBe(score().masterBars[3]?.id);
    doc().undo();
    expect(score()).toEqual(before);
    goTo(1, 0);
    expect(controller().appendBar()).toBe(false);
  });

  it('moves to the same bar and onset in another voice, and back', async () => {
    const { controller, goTo, services } = await setup();
    goTo(2, 2);
    controller().setVoice(1);
    const cursor = services.selection.getState().cursor;
    expect(cursor?.voice).toBe(1);
    expect(cursor?.beat).toBeUndefined();
    expect(cursor?.at.bar).toBe(2);
    controller().setVoice(0);
    expect(services.selection.getState().cursor).toMatchObject({ voice: 0, at: { bar: 2 } });
  });

  it('does nothing outside edit mode or without a cursor', async () => {
    const { controller, doc, services } = await setup();
    const revision = doc().revision;
    services.editing.getState().setEditing(false);
    controller().fret(3);
    controller().act({ kind: 'rest' });
    services.editing.getState().setEditing(true);
    services.selection.getState().setEdit({ cursor: undefined });
    controller().fret(3);
    expect(doc().revision).toBe(revision);
  });

  it('drops a waiting digit when another document opens, and stops listening after the cleanup', async () => {
    const { controller, entry, services, dispose } = await setup();
    controller().fret(1);
    await services.document
      .getState()
      .openBytes('other.reprise', (await write(entryScore(), 'reprise')).bytes);
    expect(entry.getState().pending).toBeUndefined();
    dispose();
    expect(entryController(entry)).toBeUndefined();
  });

  it('joins a second digit typed on a layout whose digit row prints something else (AZERTY)', async () => {
    const { controller, doc, beats } = await setup();
    const before = doc().revision;
    controller().fret(1);
    // The physical Digit2 key prints "é" there: the capture listener must not flush on it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'é', code: 'Digit2' }));
    expect(doc().revision).toBe(before);
    controller().fret(2);
    expect(doc().revision).toBe(before + 1);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(12);
    // A shifted digit is not the fret command, so it commits what waits.
    controller().fret(1);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', code: 'Digit2', shiftKey: true }),
    );
    expect(doc().revision).toBe(before + 2);
  });

  it('drops a waiting digit when the score changes under it so its beat no longer resolves', async () => {
    const { controller, doc, goTo, entry, beats, services } = await setup();
    goTo(2, 1);
    controller().fret(1);
    const revision = doc().revision;
    const beat = beats(2)[1];
    if (!beat) throw new Error('missing');
    const { removeBeat } = await import('@reprise/model');
    doc().apply(removeBeat({ beatId: beat.id }));
    expect(entry.getState().pending).toBeUndefined();
    vi.advanceTimersByTime(TWO_DIGIT_MS * 2);
    expect(doc().revision).toBe(revision + 1);
    expect(services.selection.getState().cursor).toBeDefined();
  });

  it('does not remember an inserted beat for an entry committed after the cursor moved away', async () => {
    const { controller, entry, goTo, services, cursorAt } = await setup();
    entry.getState().setMode('insert');
    goTo(0, 0);
    controller().fret(1);
    services.selection.getState().setEdit({ cursor: cursorAt(2, 3, 4) });
    expect(entry.getState().inserted).toBeUndefined();
  });
});
