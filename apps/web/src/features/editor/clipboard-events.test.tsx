import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { createTestServices } from '@/test/services';

import { parseClip, serializeClip } from './clipboard-format';
import { clipboardOf } from './clipboard-store';
import { beatsRange, clipboardScore, cursorAt } from './test/clip-scores';
import { must } from './test/must';

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'execCommand');
});

async function setup(options: { editing?: boolean; score?: Score } = {}) {
  const services = createTestServices();
  disposers.push(() => {
    services.dispose();
  });
  const registry = createAppRegistry(services);
  const built = options.score ?? clipboardScore();
  await services.document
    .getState()
    .openBytes('clip.reprise', (await write(built, 'reprise')).bytes);
  services.editing.getState().setEditing(options.editing ?? true);
  const score = (): Score => must(services.document.getState().score, 'score');
  const goTo = (track: number, bar: number, stop: number) => {
    const cursor = cursorAt(score(), track, bar, stop);
    services.selection.getState().setEdit({ cursor, currentTrack: cursor.track });
  };
  goTo(0, 0, 0);
  const frets = (track: number, bar: number) =>
    score().tracks[track]?.bars[bar]?.voices[0]?.beats.map((beat) => beat.notes[0]?.fret);
  return { services, registry, score, goTo, frets };
}

/** A clipboard event with a stub `clipboardData`: jsdom has neither `ClipboardEvent` nor a clipboard. */
function clipboardEvent(type: 'copy' | 'cut' | 'paste', text = '') {
  const data = new Map<string, string>([['text/plain', text]]);
  const clipboardData = {
    setData: vi.fn((format: string, value: string) => {
      data.set(format, value);
    }),
    getData: vi.fn((format: string) => data.get(format) ?? ''),
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  return { event, data, clipboardData };
}

const fire = (type: 'copy' | 'cut' | 'paste', text = '', target: EventTarget = document.body) => {
  const made = clipboardEvent(type, text);
  act(() => {
    target.dispatchEvent(made.event);
  });
  return made;
};

const selectFirstTwo = (score: Score) => beatsRange(score, { first: 0, bar: 0, from: 0, to: 1 });

describe('the clipboard events', () => {
  it('copy in edit mode writes the versioned clip and prevents the default', async () => {
    const { services, score } = await setup();
    services.selection.getState().setEdit({ range: selectFirstTwo(score()) });
    const { event, data } = fire('copy');
    expect(event.defaultPrevented).toBe(true);
    const text = must(data.get('text/plain'));
    expect(text.startsWith('Reprise clipboard 1\n')).toBe(true);
    const clip = must(parseClip(text));
    expect(clip.tracks[0]?.bars[0]?.voices[0]?.beats).toHaveLength(2);
    expect(clipboardOf(services).get()).toEqual(clip);
    expect(services.entry.getState()).toMatchObject({ message: 'Copied 2 beats', tone: 'notice' });
  });

  it('copy without a selection takes the beat under the cursor', async () => {
    const { services } = await setup();
    fire('copy');
    expect(clipboardOf(services).get()?.tracks[0]?.bars[0]?.voices[0]?.beats).toHaveLength(1);
  });

  it('paste of an envelope applies it as one undo step, following the insert or overwrite mode', async () => {
    const { services, goTo, frets, score } = await setup();
    services.selection.getState().setEdit({ range: selectFirstTwo(score()) });
    const { data } = fire('copy');
    services.selection.getState().setEdit({ range: undefined });
    goTo(0, 3, 0);
    const steps = services.document.getState().revision;
    const { event } = fire('paste', must(data.get('text/plain')));
    expect(event.defaultPrevented).toBe(true);
    expect(frets(0, 3)).toEqual([1, 2]);
    expect(services.document.getState().revision).toBe(steps + 1);
    expect(services.document.getState().undoLabel).toBe('pasteBeats');
    expect(services.entry.getState().message).toBe('Pasted 2 beats');
    act(() => {
      services.document.getState().undo();
    });
    expect(frets(0, 3)).toEqual([]);
  });

  it('paste with foreign text gives a notice and no edit', async () => {
    const { services, score } = await setup();
    const before = score();
    const { event } = fire('paste', 'some words');
    expect(event.defaultPrevented).toBe(true);
    expect(score()).toBe(before);
    expect(services.entry.getState()).toMatchObject({
      message: 'The clipboard holds no notes',
      tone: 'notice',
    });
  });

  it('paste with an empty system clipboard falls back to the internal clip', async () => {
    const { services, goTo, frets } = await setup();
    fire('copy');
    goTo(0, 3, 0);
    fire('paste', '');
    expect(frets(0, 3)).toEqual([1]);
    expect(clipboardOf(services).get()).toBeDefined();
  });

  it('cut empties the beats as one step and puts them on the clipboard', async () => {
    const { services, score, frets } = await setup();
    services.selection.getState().setEdit({ range: selectFirstTwo(score()) });
    const steps = services.document.getState().revision;
    const { event, data } = fire('cut');
    expect(event.defaultPrevented).toBe(true);
    expect(parseClip(must(data.get('text/plain')))).toBeDefined();
    expect(frets(0, 0)).toEqual([3, 4]);
    expect(services.document.getState().revision).toBe(steps + 1);
    expect(services.document.getState().undoLabel).toBe('cutBeats');
    expect(services.selection.getState().range).toBeUndefined();
  });

  it('a refused paste says why and changes nothing', async () => {
    const { services, score, goTo } = await setup();
    services.selection.getState().setEdit({ range: selectFirstTwo(score()) });
    const { data } = fire('copy');
    services.selection.getState().setEdit({ range: undefined });
    goTo(0, 2, 3);
    services.entry.getState().setMode('insert');
    const before = score();
    fire('paste', must(data.get('text/plain')));
    expect(score()).toBe(before);
    expect(services.entry.getState()).toMatchObject({
      message: 'Bar 3 has an eighth left: a half does not fit',
      tone: 'refusal',
    });
  });

  it('is left to the browser with edit mode off, a text selection, a modal or a text field', async () => {
    const { services, score } = await setup({ editing: false });
    services.selection.getState().setEdit({ range: selectFirstTwo(score()) });
    expect(fire('copy').event.defaultPrevented).toBe(false);

    act(() => {
      services.editing.getState().setEditing(true);
    });
    // A text selection somewhere on the page.
    const text = document.createElement('p');
    text.textContent = 'some words';
    document.body.append(text);
    const selection = must(window.getSelection() ?? undefined);
    selection.selectAllChildren(text);
    expect(fire('copy').event.defaultPrevented).toBe(false);
    selection.removeAllRanges();
    expect(fire('copy').event.defaultPrevented).toBe(true);

    // A modal dialog.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(dialog);
    const before = score();
    const { data } = clipboardEvent('copy');
    const pasted = fire(
      'paste',
      must(data.get('text/plain')) || serializeClip(must(clipboardOf(services).get())),
    );
    expect(pasted.event.defaultPrevented).toBe(false);
    expect(fire('cut').event.defaultPrevented).toBe(false);
    expect(score()).toBe(before);
    dialog.remove();

    // A text field keeps its own copy and paste.
    const { container } = render(<input aria-label="name" />);
    const input = must(container.querySelector('input') ?? undefined);
    input.focus();
    const typed = fire('paste', serializeClip(must(clipboardOf(services).get())), input);
    expect(typed.event.defaultPrevented).toBe(false);
    expect(fire('copy', '', input).event.defaultPrevented).toBe(false);
    expect(score()).toBe(before);
  });

  it('a palette Copy raises the copy event, and Paste reads the internal clipboard only', async () => {
    const { services, registry, goTo, frets } = await setup();
    const exec = vi.fn((command: string) => {
      if (command === 'copy') fire('copy');
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    // A palette input holds focus while its command runs: the one-shot flag lets the event through.
    const { container } = render(<input aria-label="palette" />);
    must(container.querySelector('input') ?? undefined).focus();
    act(() => {
      void must(registry.get('editor.copy')).run();
    });
    expect(exec).toHaveBeenCalledWith('copy');
    expect(clipboardOf(services).get()).toBeDefined();
    goTo(0, 3, 0);
    expect(registry.available().map(({ id }) => id)).toContain('editor.paste');
    act(() => {
      void must(registry.get('editor.paste')).run();
    });
    expect(frets(0, 3)).toEqual([1]);
    act(() => {
      void must(registry.get('editor.pasteInsert')).run();
    });
    expect(frets(0, 3)).toEqual([1, 1]);
  });

  it('a palette Copy still copies to the internal clipboard when no event comes', async () => {
    const { services, registry } = await setup();
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    act(() => {
      void must(registry.get('editor.copy')).run();
    });
    expect(clipboardOf(services).get()).toBeDefined();
  });

  it('the palette lists Paste only once there is something to paste', async () => {
    const { services, registry } = await setup();
    const listed = () => registry.available().map(({ id }) => id);
    expect(listed()).not.toContain('editor.paste');
    expect(listed()).toContain('editor.copy');
    fire('copy');
    expect(listed()).toEqual(
      expect.arrayContaining(['editor.paste', 'editor.pasteInsert', 'editor.pasteOverwrite']),
    );
    expect(services.entry.getState().message).toBe('Copied 1 beat');
  });
});

describe('the keys with the real dispatcher', () => {
  const press = (
    registry: ReturnType<typeof createAppRegistry>,
    key: string,
    target: EventTarget,
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: target });
    return { ran: dispatchShortcut(event, registry, 'other'), event };
  };

  it('leaves ⌘C, ⌘X and ⌘V to the browser: nothing runs and the default stays', async () => {
    const { registry, services } = await setup();
    const before = services.document.getState().revision;
    for (const key of ['c', 'x', 'v']) {
      const { ran, event } = press(registry, key, document.body);
      expect(ran).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(services.document.getState().revision).toBe(before);
    // The keys are still on the commands for the palette and the table.
    expect(registry.get('editor.copy')).toMatchObject({
      native: true,
      shortcut: { key: 'c', mod: true },
    });
  });

  it('keeps ⌘C and ⌘V native in a text field, and nothing acts under a modal', async () => {
    const { registry, services, score } = await setup();
    fire('copy');
    const text = serializeClip(must(clipboardOf(services).get()));
    const { container } = render(<input aria-label="name" />);
    const input = must(container.querySelector('input') ?? undefined);
    input.focus();
    for (const key of ['c', 'v']) {
      const { ran, event } = press(registry, key, input);
      expect(ran).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    const before = score();
    expect(press(registry, 'v', document.body).ran).toBe(false);
    fire('paste', text);
    expect(score()).toBe(before);
  });
});
