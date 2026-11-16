import type { Score } from '@reprise/model';
import { note, score as scoreBuilder } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { timelineOf } from '@/state/timeline';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { EXPECTED_BARS } from './test/acceptance-song';
import { EditorDialogs } from './editor-dialogs';
import { createNewSong } from './new-song';

function setup() {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  renderWithServices(<EditorDialogs />, services);
  act(() => {
    createNewSong(services);
  });
  const run = (id: string) => {
    const command = registry.get(id);
    if (!command) throw new Error(`no command ${id}`);
    act(() => {
      void command.run();
    });
  };
  const score = (): Score => {
    const current = services.document.getState().score;
    if (!current) throw new Error('no score');
    return current;
  };
  const bar = () =>
    score().masterBars.findIndex(
      ({ id }) => id === services.selection.getState().cursor?.masterBar,
    ) + 1;
  const toBar = (n: number) => {
    run('editor.scoreStart');
    for (let at = 1; at < n; at++) run('editor.nextBar');
  };
  const message = () => services.entry.getState().message;
  return { services, registry, run, score, bar, toBar, message, user: userEvent.setup() };
}

const revision = (services: ReturnType<typeof setup>['services']) =>
  services.document.getState().revision;

describe('the bar commands', () => {
  it('insert a bar before or after, each one undo step, with the cursor in the new bar', () => {
    const { services, run, score, bar } = setup();
    const before = revision(services);
    run('editor.insertBarAfter');
    expect(score().masterBars).toHaveLength(2);
    expect(bar()).toBe(2);
    run('editor.insertBarBeforeMac');
    expect(score().masterBars).toHaveLength(3);
    // Before bar 2: the cursor lands in the new bar 2, pushing the old one to 3.
    expect(bar()).toBe(2);
    expect(revision(services)).toBe(before + 2);
    expect(services.document.getState().undoLabel).toBe('insertBar');
    act(() => {
      services.document.getState().undo();
    });
    expect(score().masterBars).toHaveLength(2);
  });

  it('delete the bars of a range as one undo step, keeping the tempo on the next bar', () => {
    const { services, run, score, toBar } = setup();
    for (let i = 0; i < 4; i++) run('editor.insertBarAfter');
    expect(score().masterBars).toHaveLength(5);
    const kept = [0, 4].map((index) => score().masterBars[index]?.id);
    toBar(2);
    run('editor.selectNextBar');
    run('editor.selectNextBar');
    const before = revision(services);
    run('editor.deleteBarsMac');
    expect(score().masterBars[0]?.tempo?.bpm).toBe(120);
    expect(score().masterBars.map(({ id }) => id)).toEqual(kept);
    expect(score().masterBars).toHaveLength(2);
    expect(revision(services)).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('deleteBars');
    act(() => {
      services.document.getState().undo();
    });
    expect(score().masterBars).toHaveLength(5);
  });

  it('refuse to delete every bar, on the status line and with the score untouched', () => {
    const { services, run, score, message } = setup();
    const before = revision(services);
    run('editor.deleteBarsMac');
    expect(score().masterBars).toHaveLength(1);
    expect(revision(services)).toBe(before);
    expect(message()).toBe('A score keeps at least one bar.');
  });

  it('toggle the repeat start on the first bar of a range and the repeat end on its last', () => {
    const { services, run, score, toBar } = setup();
    run('editor.insertBarAfter');
    run('editor.insertBarAfter');
    toBar(1);
    run('editor.selectNextBar');
    const before = revision(services);
    run('editor.toggleRepeatStart');
    run('editor.toggleRepeatEnd');
    expect(score().masterBars.map(({ repeat }) => repeat)).toEqual([
      { start: true, endCount: 0 },
      { start: false, endCount: 2 },
      { start: false, endCount: 0 },
    ]);
    expect(revision(services)).toBe(before + 2);
    run('editor.toggleRepeatEnd');
    expect(score().masterBars[1]?.repeat.endCount).toBe(0);
  });

  it('say why a repeat end cannot go while an ending depends on it', async () => {
    const { run, score, toBar, message, user } = setup();
    run('editor.insertBarAfter');
    toBar(1);
    run('editor.barProperties');
    await user.click(screen.getByLabelText('Repeat end'));
    await user.click(screen.getByRole('button', { name: 'Ending 1' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(score().masterBars[0]?.alternateEndings).toEqual([1]);
    run('editor.toggleRepeatEnd');
    expect(score().masterBars[0]?.repeat.endCount).toBe(2);
    expect(message()).toMatch(/alternate ending needs a repeat end/i);
  });
});

describe('the keys', () => {
  it('[ and ] edit repeats in edit mode and still step the tempo outside it', () => {
    const { services, registry, score } = setup();
    const press = (code: 'BracketLeft' | 'BracketRight') =>
      dispatchShortcut(
        new KeyboardEvent('keydown', {
          key: code === 'BracketLeft' ? '[' : ']',
          code,
          cancelable: true,
        }),
        registry,
        'mac',
      );
    expect(press('BracketLeft')).toBe(true);
    expect(score().masterBars[0]?.repeat.start).toBe(true);
    act(() => {
      services.editing.getState().setEditing(false);
    });
    const before = revision(services);
    press('BracketLeft');
    expect(revision(services)).toBe(before);
  });

  it('opens bar properties with the platform key and directions with D, and Insert inserts a bar on Windows', async () => {
    const { registry, score, user } = setup();
    const key = (init: KeyboardEventInit, platform: 'mac' | 'other') => {
      act(() => {
        dispatchShortcut(
          new KeyboardEvent('keydown', { cancelable: true, ...init }),
          registry,
          platform,
        );
      });
    };
    key({ key: 't', code: 'KeyT', ctrlKey: true }, 'other');
    expect(screen.getByRole('dialog', { name: 'Bar 1' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    key({ key: 'd', code: 'KeyD' }, 'other');
    expect(screen.getByLabelText('Jump')).toHaveFocus();
    await user.keyboard('{Escape}');
    key({ key: 'Insert', code: 'Insert' }, 'other');
    expect(score().masterBars).toHaveLength(2);
  });
});

describe('the master-bar dialog', () => {
  it('starts in the section the command names', () => {
    const { run } = setup();
    run('editor.section');
    expect(screen.getByLabelText('Section name')).toHaveFocus();
  });

  it('checks a field range as the player types and keeps Apply off until it holds', async () => {
    const { run, user } = setup();
    run('editor.barProperties');
    const beats = screen.getByLabelText('Beats per bar');
    await user.clear(beats);
    await user.type(beats, '33');
    expect(beats).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.clear(beats);
    await user.type(beats, '3');
    expect(beats).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('applies on Enter as one undo step and cancels on Escape', async () => {
    const { services, run, score, toBar, user } = setup();
    run('editor.insertBarAfter');
    toBar(1);
    run('editor.barProperties');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const before = revision(services);
    run('editor.barProperties');
    await user.clear(screen.getByLabelText('Beats per bar'));
    await user.type(screen.getByLabelText('Beats per bar'), '3{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Continue until the next change is on: bar 2 follows bar 1's old signature.
    expect(score().masterBars.map(({ timeSignature }) => timeSignature.numerator)).toEqual([3, 3]);
    expect(revision(services)).toBe(before + 1);
  });

  it('shows Mixed for a field whose bars differ and leaves it alone unless edited', async () => {
    const { services, run, score, toBar, user } = setup();
    run('editor.insertBarAfter');
    toBar(2);
    run('editor.barProperties');
    await user.clear(screen.getByLabelText('Beats per bar'));
    await user.type(screen.getByLabelText('Beats per bar'), '3{Enter}');
    toBar(1);
    run('editor.selectNextBar');
    run('editor.barProperties');
    expect(screen.getByLabelText('Beats per bar')).toHaveAttribute('placeholder', 'Mixed');
    await user.click(screen.getByLabelText('Repeat end'));
    const before = revision(services);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(revision(services)).toBe(before + 1);
    expect(score().masterBars.map(({ timeSignature }) => timeSignature.numerator)).toEqual([4, 3]);
    expect(score().masterBars[1]?.repeat.endCount).toBe(2);
  });
});

describe('a smaller time signature that no longer holds the notes', () => {
  it('is refused with the bars named, the dialog stays open and nothing changes', async () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    renderWithServices(<EditorDialogs />, services);
    const built = scoreBuilder().track('guitar');
    built
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 1)])
      .beat('4', [note(1, 2)])
      .beat('4', [note(1, 3)]);
    act(() => {
      services.document.getState().newDocument(built.build());
      services.editing.getState().setEditing(true);
    });
    const user = userEvent.setup();
    act(() => {
      void registry.get('editor.barProperties')?.run();
    });
    const before = revision(services);
    await user.clear(screen.getByLabelText('Beats per bar'));
    await user.type(screen.getByLabelText('Beats per bar'), '3{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bar 1 holds more than 3/4 allows: shorten or delete the notes first.',
    );
    expect(screen.getByRole('dialog', { name: 'Bar 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Beats per bar')).toHaveFocus();
    expect(revision(services)).toBe(before);
  });
});

describe('the acceptance song, built through the commands and dialogs', () => {
  it('plays the expected bars at 10.5 s', async () => {
    const { services, run, score, toBar, user } = setup();
    for (let i = 0; i < 6; i++) run('editor.insertBarAfter');
    const dialog = () => screen.getByRole('dialog');
    const apply = async () => {
      await user.click(within(dialog()).getByRole('button', { name: 'Apply' }));
    };

    toBar(1);
    run('editor.barProperties');
    await user.clear(screen.getByLabelText(/Beats per minute/));
    await user.type(screen.getByLabelText(/Beats per minute/), '240');
    await user.click(screen.getByLabelText('Segno', { exact: true }));
    await apply();

    toBar(2);
    run('editor.toggleRepeatStart');

    toBar(3);
    run('editor.barProperties');
    await user.click(screen.getByLabelText('Repeat end'));
    await user.click(screen.getByRole('button', { name: 'Ending 1' }));
    await apply();

    toBar(4);
    run('editor.barProperties');
    await user.click(screen.getByRole('button', { name: 'Ending 2' }));
    await user.selectOptions(screen.getByLabelText('Jump'), 'To Coda');
    await apply();

    toBar(5);
    run('editor.selectNextBar');
    run('editor.barProperties');
    expect(dialog()).toHaveAccessibleName('Bars 5–6');
    await user.clear(screen.getByLabelText('Beats per bar'));
    await user.type(screen.getByLabelText('Beats per bar'), '3');
    await user.click(screen.getByLabelText('Continue until the next change'));
    await user.selectOptions(screen.getByLabelText('Jump'), 'D.S. al Coda');
    const before = revision(services);
    await apply();
    expect(revision(services)).toBe(before + 1);

    toBar(7);
    run('editor.directions');
    await user.click(screen.getByLabelText('Coda', { exact: true }));
    await apply();

    const timeline = timelineOf(score());
    expect(timeline.map.passes.map(({ masterBarIndex }) => masterBarIndex + 1)).toEqual(
      EXPECTED_BARS,
    );
    expect(timeline.warnings).toEqual([]);
    expect(timeline.map.durationSeconds).toBeCloseTo(10.5, 9);
  });
});
