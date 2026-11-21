import { write } from '@reprise/formats';
import type { Anchor, LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { createAppMenus } from '../app-menus';
import { createAppRegistry } from '../app-registry';
import { ContextMenuHost } from '../context-menu/context-menu-host';
import { SHORTCUT_OVERRIDES_SETTING } from '../keymap';
import { enterPracticeMode } from '../practice-mode';
import { ScorePane } from '../score-pane';
import { installShortcutDispatcher } from '../shortcut-dispatcher';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

function song(): Score {
  const builder = score().title('Pill').track('guitar');
  for (let bar = 0; bar < 8; bar++) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, (bar + beat) % 12)]);
  }
  return builder.build();
}

async function setup() {
  stubViewport(1280, 800);
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services, 'other');
  const menus = createAppMenus(registry);
  renderWithServices(
    <>
      <ScorePane hint={null} />
      <ContextMenuHost registry={registry} menus={menus} keyboard="other" />
    </>,
    services,
  );
  await act(async () => {
    await services.document
      .getState()
      .openBytes('pill.reprise', (await write(song(), 'reprise')).bytes);
  });
  const opened = services.document.getState().score;
  const result = services.layout.getState().result;
  if (!opened || !result) throw new Error('not open');
  const id = (index: number) => opened.masterBars[index]?.id ?? '';
  const select = (from: number, to: number) => {
    act(() => {
      services.selection.getState().selectBars({ startBar: id(from), endBar: id(to) }, id(from));
    });
  };
  return { services, registry, score: opened, result, id, select };
}

const region = () => screen.getByRole('region', { name: 'Score: Pill' });
const canvas = () => {
  const found = region().querySelector<HTMLElement>('.score-canvas');
  if (!found) throw new Error('no canvas');
  return found;
};
const toolbar = () => screen.getByRole('toolbar');
const button = (name: string) => within(toolbar()).getByRole('button', { name });
const centreOf = (anchor: Anchor) => ({
  clientX: anchor.bbox.x + anchor.bbox.width / 2,
  clientY: anchor.bbox.y + anchor.bbox.height / 2,
});
function beatAnchor(result: LayoutResult, masterBar: string, index: number): Anchor {
  const found = result.anchors
    .filter((anchor) => anchor.kind === 'beat' && anchor.masterBar === masterBar)
    .sort((a, b) => a.bbox.x - b.bbox.x)[index];
  if (!found) throw new Error('no beat anchor');
  return found;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the selection pill over a bar range', () => {
  it('is a toolbar named for the bars, with the four actions and a menu button', async () => {
    const { select } = await setup();
    expect(screen.queryByRole('toolbar')).toBeNull();
    select(1, 3);
    expect(toolbar()).toHaveAccessibleName('Bars 2 to 4');
    expect(toolbar()).toHaveAttribute('aria-orientation', 'horizontal');
    const names = within(toolbar())
      .getAllByRole('button')
      .map((each) => each.getAttribute('aria-label'));
    expect(names).toEqual([
      'Loop these bars',
      'Speed trainer on these bars',
      'Focus on loop',
      'Copy bars',
      'More actions',
    ]);
    expect(button('More actions')).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('hides while playing or counting in, while dragging, while typing and for a foreign menu', async () => {
    const { services, result, id, select } = await setup();
    select(1, 3);
    expect(screen.queryByRole('toolbar')).not.toBeNull();

    act(() => {
      services.playback.setState({ transport: 'playing' });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => {
      services.playback.setState({ transport: 'counting-in' });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => {
      services.playback.setState({ transport: 'stopped' });
    });
    expect(screen.queryByRole('toolbar')).not.toBeNull();

    const from = centreOf(beatAnchor(result, id(4), 0));
    fireEvent.pointerDown(canvas(), { ...from, button: 0 });
    fireEvent.pointerMove(canvas(), { ...from, clientX: from.clientX + 10 });
    fireEvent.pointerMove(canvas(), centreOf(beatAnchor(result, id(5), 1)));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.pointerUp(canvas(), centreOf(beatAnchor(result, id(5), 1)));
    expect(screen.queryByRole('toolbar')).not.toBeNull();

    act(() => {
      services.entry.getState().setPending({
        fret: 1,
        cursor: {
          track: 'x',
          masterBar: id(0),
          voice: 0,
          beat: undefined,
          string: 1,
          staff: 'tab',
          at: { track: 0, bar: 0, beat: 0 },
        },
      });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => {
      services.entry.getState().setPending(undefined);
    });

    act(() => {
      services.contextMenu
        .getState()
        .show({ surface: 'score.paper', target: { kind: 'paper' }, label: 'Score' }, 'pointer', {
          x: 1,
          y: 1,
        });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => {
      services.contextMenu.getState().hide();
    });
    expect(screen.queryByRole('toolbar')).not.toBeNull();
  });

  it('runs the command on a click and leaves the selection and the focus alone', async () => {
    const { services, id, select } = await setup();
    select(1, 3);
    region().focus();
    const loop = button('Loop these bars');
    // The press must not move focus off the score.
    expect(fireEvent.mouseDown(loop)).toBe(false);
    fireEvent.click(loop);
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: id(1),
      endBar: id(3),
    });
    expect(services.selection.getState().bars).toEqual({ startBar: id(1), endBar: id(3) });
    expect(document.activeElement).toBe(region());
  });

  it('is pressed while the loop is the selection, and a second press turns the loop off', async () => {
    const { services, select } = await setup();
    select(1, 3);
    expect(button('Loop these bars')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button('Loop these bars'));
    expect(button('Loop these bars')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button('Loop these bars'));
    expect(services.playback.getState().settings.loop).toBeUndefined();
    expect(button('Loop these bars')).toHaveAttribute('aria-pressed', 'false');
    expect(services.selection.getState().bars).toBeDefined();
  });

  it('never lets a press on it reach the score: no seek, no selection change', async () => {
    const { services, id, select } = await setup();
    select(1, 3);
    const loop = button('Loop these bars');
    fireEvent.pointerDown(loop, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(loop, { clientX: 400, clientY: 5 });
    fireEvent.pointerUp(loop, { button: 0, clientX: 400, clientY: 5 });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.selection.getState().bars).toEqual({ startBar: id(1), endBar: id(3) });
  });

  it('is one tab stop reached by Tab from the score, with the toolbar arrows inside', async () => {
    const user = userEvent.setup();
    const { select } = await setup();
    select(1, 3);
    region().focus();
    await user.tab();
    expect(document.activeElement).toBe(button('Loop these bars'));
    expect(
      within(toolbar())
        .getAllByRole('button')
        .filter((each) => each.tabIndex === 0),
    ).toHaveLength(1);

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(button('Speed trainer on these bars'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(button('More actions'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(button('Loop these bars'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(button('More actions'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(button('Loop these bars'));
    // The roving stop follows focus.
    await user.keyboard('{ArrowRight}');
    expect(button('Speed trainer on these bars').tabIndex).toBe(0);
    expect(button('Loop these bars').tabIndex).toBe(-1);
  });

  it('returns focus to where it came from on Escape, and neither clears the selection nor leaves practice mode', async () => {
    const user = userEvent.setup();
    const { services, registry, select } = await setup();
    const off = installShortcutDispatcher(window, registry, 'other');
    select(1, 3);
    act(() => {
      enterPracticeMode(services);
    });
    expect(services.ui.getState().practiceMode.on).toBe(true);
    region().focus();
    await user.tab();
    expect(document.activeElement).toBe(button('Loop these bars'));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(region());
    expect(services.ui.getState().practiceMode.on).toBe(true);
    expect(services.selection.getState().bars).toBeDefined();
    off();
  });

  it('is reached by Alt+F10 too, and the key follows a rebinding', async () => {
    const { services, registry, select } = await setup();
    const off = installShortcutDispatcher(window, registry, 'other');
    select(1, 3);
    fireEvent.keyDown(document.body, { key: 'F10', altKey: true });
    expect(document.activeElement).toBe(button('Loop these bars'));
    off();

    expect(button('Loop these bars')).not.toHaveAttribute('aria-keyshortcuts');
    act(() => {
      services.settings.set(SHORTCUT_OVERRIDES_SETTING, {
        'transport.loopSelection': { key: 'F8' },
      });
    });
    expect(button('Loop these bars')).toHaveAttribute('aria-keyshortcuts', 'F8');
  });

  it('puts focus on the score when it hides with focus inside', async () => {
    const { services, select } = await setup();
    select(1, 3);
    act(() => {
      button('Copy bars').focus();
    });
    act(() => {
      services.selection.getState().selectBars(undefined);
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.activeElement).toBe(region());
  });

  it('opens the range menu from the menu button as a keyboard open, and focus returns to it', async () => {
    const user = userEvent.setup();
    const { select } = await setup();
    select(1, 3);
    const more = button('More actions');
    act(() => {
      more.focus();
    });
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Bars 2 to 4' });
    expect(menu).toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'true');
    // The pill stays up for the menu it opened (the menu hides the rest from the tree).
    expect(document.querySelector('[data-selection-pill]')).not.toHaveAttribute('hidden');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(document.activeElement).toBe(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers no Focus in practice mode', async () => {
    const { services, select } = await setup();
    select(1, 3);
    expect(screen.queryByRole('button', { name: 'Focus on loop' })).not.toBeNull();
    act(() => {
      enterPracticeMode(services);
    });
    expect(screen.queryByRole('button', { name: 'Focus on loop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Loop these bars' })).not.toBeNull();
  });

  it('does not render in edit mode', async () => {
    const { services, select } = await setup();
    select(1, 3);
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('does not pause following when Space presses one of its buttons', async () => {
    const { services, select } = await setup();
    select(1, 3);
    act(() => {
      button('Copy bars').focus();
    });
    fireEvent.keyDown(button('Copy bars'), { key: ' ' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(services.ui.getState().follow.on).toBe(true);
  });
});
