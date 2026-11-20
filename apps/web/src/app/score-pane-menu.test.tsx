import { write } from '@reprise/formats';
import type { Anchor, LayoutResult } from '@reprise/layout';
import { note, score } from '@reprise/model/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { createAppMenus } from './app-menus';
import { createAppRegistry } from './app-registry';
import { ContextMenuHost } from './context-menu/context-menu-host';
import { ScorePane } from './score-pane';
import { CommandSourceContext } from './use-command';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

/** Four bars; a section on bar 2, a chord name on its first beat. */
function song() {
  const builder = score().title('Menu').track('guitar');
  for (let bar = 0; bar < 4; bar++) {
    builder.bar();
    if (bar === 1) builder.section('Verse');
    for (let beat = 0; beat < 4; beat++) {
      builder.beat(
        '4',
        [note(1, (bar + beat) % 12)],
        bar === 1 && beat === 0 ? { chord: { name: 'Am' } } : {},
      );
    }
  }
  return builder.build();
}

async function setup(withScore = true, keyboard: 'mac' | 'other' = 'other') {
  stubViewport(1280, 800);
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const menus = createAppMenus(registry);
  renderWithServices(
    <CommandSourceContext value={{ registry, keyboard }}>
      <ScorePane hint={<p>Open a song</p>} />
      <ContextMenuHost registry={registry} menus={menus} keyboard={keyboard} />
    </CommandSourceContext>,
    services,
  );
  if (withScore) {
    await act(async () => {
      await services.document
        .getState()
        .openBytes('menu.reprise', (await write(song(), 'reprise')).bytes);
    });
  }
  const opened = services.document.getState().score;
  const result = services.layout.getState().result;
  return { services, score: opened, result, registry };
}

const region = () => screen.getByRole('region', { name: 'Score: Menu' });
const canvas = () => {
  const found = region().querySelector<HTMLElement>('.score-canvas');
  if (!found) throw new Error('no canvas');
  return found;
};
const centreOf = (anchor: Anchor) => ({
  clientX: anchor.bbox.x + anchor.bbox.width / 2,
  clientY: anchor.bbox.y + anchor.bbox.height / 2,
});
const noteIn = (result: LayoutResult, masterBar: string, index: number): Anchor => {
  const found = result.anchors
    .filter((a) => a.kind === 'note' && a.masterBar === masterBar)
    .sort((a, b) => a.bbox.x - b.bbox.x)[index];
  if (!found) throw new Error('no note');
  return found;
};
const names = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[data-command]')].map((item) => item.getAttribute('data-command'));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the score’s context menus in play mode', () => {
  it('opens a bar’s menu on a right-click: selects the bar, never seeks, never touches the loop', async () => {
    const { services, score: opened, result } = await setup();
    const bars = opened?.masterBars ?? [];
    if (!result) throw new Error('no layout');
    services.audio.setLoop({ startBar: bars[0]?.id ?? '', endBar: bars[0]?.id ?? '' });
    fireEvent.pointerDown(canvas(), {
      ...centreOf(noteIn(result, bars[2]?.id ?? '', 0)),
      button: 2,
    });
    fireEvent.contextMenu(canvas(), centreOf(noteIn(result, bars[2]?.id ?? '', 0)));
    const menu = await screen.findByRole('menu', { name: 'Note, bar 3' });
    expect(menu).toHaveAttribute('data-context-menu', 'score.note');
    expect(names(menu)).toEqual(
      expect.arrayContaining([
        'transport.playFromSelection',
        'transport.loopSelection',
        'trainer.speedTrainerOnSelection',
        'trainer.showFretboard',
        'editor.copyBars',
        'editor.editHere',
      ]),
    );
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    // The bar is selected and drawn, and the loop stays where it was.
    expect(services.selection.getState().bars).toEqual({
      startBar: bars[2]?.id,
      endBar: bars[2]?.id,
    });
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: bars[0]?.id,
      endBar: bars[0]?.id,
    });
  });

  it('selects the right-clicked bar with no loop, and offers the range menu inside it', async () => {
    const { services, score: opened, result } = await setup();
    const bars = opened?.masterBars ?? [];
    if (!result) throw new Error('no layout');
    const at = centreOf(noteIn(result, bars[2]?.id ?? '', 1));
    fireEvent.contextMenu(canvas(), at);
    await screen.findByRole('menu', { name: 'Note, bar 3' });
    expect(services.selection.getState().bars).toEqual({
      startBar: bars[2]?.id,
      endBar: bars[2]?.id,
    });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // The selection stays after Escape, and a second right-click in it is the range's menu.
    fireEvent.contextMenu(canvas(), at);
    const menu = await screen.findByRole('menu', { name: 'Bar 3' });
    expect(menu).toHaveAttribute('data-context-menu', 'score.range');
    expect(within(menu).getByRole('menuitem', { name: /Loop these bars/ })).toBeInTheDocument();
  });

  it('loops the bar chosen from the menu and leaves the playhead alone', async () => {
    const { services, score: opened, result } = await setup();
    const bars = opened?.masterBars ?? [];
    if (!result) throw new Error('no layout');
    fireEvent.contextMenu(canvas(), centreOf(noteIn(result, bars[3]?.id ?? '', 0)));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Loop this bar/ }));
    await waitFor(() => {
      expect(services.playback.getState().settings.loop).toEqual({
        startBar: bars[3]?.id,
        endBar: bars[3]?.id,
      });
    });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.menuTarget.getState().target).toBeUndefined();
  });

  it('lists no editing command, and edit mode keeps the browser’s menu', async () => {
    const { services, registry, score: opened, result } = await setup();
    const bars = opened?.masterBars ?? [];
    if (!result) throw new Error('no layout');
    fireEvent.contextMenu(canvas(), centreOf(noteIn(result, bars[0]?.id ?? '', 0)));
    const menu = await screen.findByRole('menu');
    for (const id of names(menu)) {
      expect(registry.get(id ?? '')?.context, id ?? '').toBeUndefined();
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(fireEvent.contextMenu(canvas(), centreOf(noteIn(result, bars[0]?.id ?? '', 0)))).toBe(
      true,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the section and chord menus with their own "Edit" labels', async () => {
    const { score: opened, result } = await setup();
    if (!result || !opened) throw new Error('not open');
    const chord = result.primitives.find((p) => p.kind === 'text' && p.lane === 'chord');
    const section = result.primitives.find((p) => p.kind === 'text' && p.lane === 'section');
    if (!chord || !section) throw new Error('no marks');
    const centre = (p: typeof chord) => ({
      clientX: p.bbox.x + p.bbox.width / 2,
      clientY: p.bbox.y + p.bbox.height / 2,
    });
    fireEvent.contextMenu(canvas(), centre(chord));
    const chordMenu = await screen.findByRole('menu', { name: 'Chord name, bar 2' });
    expect(
      within(chordMenu).getByRole('menuitem', { name: /Edit chord name/ }),
    ).toBeInTheDocument();
    expect(names(chordMenu)).toContain('trainer.showFretboard');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    fireEvent.contextMenu(canvas(), centre(section));
    const sectionMenu = await screen.findByRole('menu', { name: 'Section Verse, bar 2' });
    expect(names(sectionMenu)).toEqual(
      expect.arrayContaining([
        'transport.loopSection',
        'transport.loopSelection',
        'editor.editHere',
      ]),
    );
    expect(within(sectionMenu).getByRole('menuitem', { name: /Edit section/ })).toBeInTheDocument();
  });

  it('opens the paper menu outside the systems, with and without a score', async () => {
    const { result } = await setup();
    if (!result) throw new Error('no layout');
    fireEvent.contextMenu(canvas(), { clientX: 2, clientY: 2 });
    const menu = await screen.findByRole('menu', { name: 'Score' });
    expect(menu).toHaveAttribute('data-context-menu', 'score.paper');
    expect(names(menu)).toEqual(
      expect.arrayContaining([
        'transport.playFromStart',
        'transport.toggleLoop',
        'editor.toggleMode',
      ]),
    );
  });

  it('offers a way to open a song on the empty paper', async () => {
    await setup(false);
    fireEvent.contextMenu(screen.getByText('Open a song'));
    const menu = await screen.findByRole('menu', { name: 'Score' });
    expect(names(menu)).toEqual(
      expect.arrayContaining(['file.new', 'file.open', 'library.importFiles', 'library.show']),
    );
    expect(names(menu)).not.toContain('file.print');
  });

  it('opens the focused score’s menu from the keyboard, and the body’s key falls back to it', async () => {
    const { services, score: opened } = await setup();
    const bars = opened?.masterBars ?? [];
    act(() => {
      services.selection
        .getState()
        .selectBars({ startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' });
    });
    // The Menu key with focus on the page itself: Chromium aims the event at the body.
    const keyboard = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: '',
      button: -1,
    });
    act(() => {
      document.body.dispatchEvent(keyboard);
    });
    const menu = await screen.findByRole('menu', { name: 'Bars 2 to 3' });
    expect(menu).toHaveAttribute('data-context-menu', 'score.range');
    expect(keyboard.defaultPrevented).toBe(true);
    expect(services.contextMenu.getState().via).toBe('keyboard');
  });

  it('leaves a pointer’s right-click on the body alone', async () => {
    await setup();
    const click = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      button: 2,
    });
    act(() => {
      document.body.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
