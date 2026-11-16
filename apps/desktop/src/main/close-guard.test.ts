import { describe, expect, it, vi } from 'vitest';

import { CloseGuard, closeAction, type CloseGuardState } from './close-guard';

const state = (overrides: Partial<CloseGuardState> = {}): CloseGuardState => ({
  edited: true,
  rendererGone: false,
  unresponsive: false,
  destroyed: false,
  confirmed: false,
  ...overrides,
});

describe('closeAction', () => {
  it('asks only for an edited document with a live renderer', () => {
    expect(closeAction(state())).toBe('ask');
    expect(closeAction(state({ edited: false }))).toBe('allow');
  });

  it.each([
    ['a crashed renderer', { rendererGone: true }],
    ['an unresponsive renderer', { unresponsive: true }],
    ['a window already being destroyed', { destroyed: true }],
    ['a close the renderer confirmed', { confirmed: true }],
  ] as const)('lets the close through for %s', (_name, overrides) => {
    expect(closeAction(state(overrides))).toBe('allow');
  });
});

function guard() {
  const ports = { ask: vi.fn(), closeWindow: vi.fn(), quitApp: vi.fn() };
  return { ports, guard: new CloseGuard(ports) };
}

describe('CloseGuard', () => {
  it('lets a clean window close without asking', () => {
    const { ports, guard: g } = guard();

    expect(g.onClose()).toBe(false);
    expect(g.onBeforeQuit()).toBe(false);
    expect(ports.ask).not.toHaveBeenCalled();
  });

  it('holds an edited window, asks, and closes once the renderer confirms', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);

    expect(g.onClose()).toBe(true);
    expect(ports.ask).toHaveBeenCalledOnce();
    expect(ports.closeWindow).not.toHaveBeenCalled();

    g.confirm();

    expect(ports.closeWindow).toHaveBeenCalledOnce();
    expect(ports.quitApp).not.toHaveBeenCalled();
    // The close that confirm triggers comes back to the guard and passes.
    expect(g.onClose()).toBe(false);
  });

  it('quits too when the request began as Quit', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);

    expect(g.onBeforeQuit()).toBe(true);
    g.confirm();

    expect(ports.closeWindow).toHaveBeenCalledOnce();
    expect(ports.quitApp).toHaveBeenCalledOnce();
    expect(g.onBeforeQuit()).toBe(false);
  });

  it('does not quit when a cancelled Quit is followed by a plain close', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);
    g.onBeforeQuit();

    // The user cancelled: nothing was sent. Later they press the window's close button.
    expect(g.onClose()).toBe(true);
    g.confirm();

    expect(ports.closeWindow).toHaveBeenCalledOnce();
    expect(ports.quitApp).not.toHaveBeenCalled();
  });

  it('asks again on the next attempt after a cancel', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);

    g.onClose();
    g.onClose();

    expect(ports.ask).toHaveBeenCalledTimes(2);
  });

  it('ignores a confirm nobody asked for, and one after the document went clean', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);

    g.confirm();
    expect(ports.closeWindow).not.toHaveBeenCalled();

    g.onClose();
    g.setEdited(false);
    g.confirm();
    expect(ports.closeWindow).not.toHaveBeenCalled();
  });

  it('closes without an answer when the renderer crashes or hangs mid-question', () => {
    for (const fail of [
      (g: CloseGuard) => {
        g.markRendererGone();
      },
      (g: CloseGuard) => {
        g.markUnresponsive(true);
      },
    ]) {
      const { ports, guard: g } = guard();
      g.setEdited(true);
      g.onClose();

      fail(g);

      expect(ports.closeWindow).toHaveBeenCalledOnce();
    }
  });

  it('quits after an unanswered Quit when the renderer hangs', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);
    g.onBeforeQuit();

    g.markUnresponsive(true);

    expect(ports.closeWindow).toHaveBeenCalledOnce();
    expect(ports.quitApp).toHaveBeenCalledOnce();
  });

  it('never asks a crashed, hung or destroyed window', () => {
    const marks = [
      (g: CloseGuard) => {
        g.markRendererGone();
      },
      (g: CloseGuard) => {
        g.markUnresponsive(true);
      },
      (g: CloseGuard) => {
        g.markDestroyed();
      },
    ];
    for (const mark of marks) {
      const { ports, guard: g } = guard();
      g.setEdited(true);
      mark(g);

      expect(g.onClose()).toBe(false);
      expect(g.onBeforeQuit()).toBe(false);
      expect(ports.ask).not.toHaveBeenCalled();
    }
  });

  it('asks again once a hung renderer responds', () => {
    const { ports, guard: g } = guard();
    g.setEdited(true);
    g.markUnresponsive(true);
    g.markUnresponsive(false);

    expect(g.onClose()).toBe(true);
    expect(ports.ask).toHaveBeenCalledOnce();
  });
});
