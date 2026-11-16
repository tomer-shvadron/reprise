import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { holdQuit, wireCloseGuard } from './close-wiring';

function setup() {
  const events = new EventEmitter();
  const contents = new EventEmitter();
  const ports = { ask: vi.fn(), quit: vi.fn(), forget: vi.fn() };
  const window = {
    events,
    contents,
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    setDocumentEdited: vi.fn(),
  };
  const guard = wireCloseGuard(window, ports);
  const close = () => {
    const event = { preventDefault: vi.fn() };
    events.emit('close', event);
    return event.preventDefault.mock.calls.length > 0;
  };
  return { events, contents, ports, window, guard, close };
}

describe('wireCloseGuard', () => {
  it('prevents a close only while the document is edited', () => {
    const { close, guard, ports } = setup();

    expect(close()).toBe(false);
    guard.setEdited(true);
    expect(close()).toBe(true);
    expect(ports.ask).toHaveBeenCalledOnce();
  });

  it('drops the guard when the window is closed', () => {
    const { events, ports } = setup();

    events.emit('closed');

    expect(ports.forget).toHaveBeenCalledOnce();
  });

  it('lets the next close through after the renderer crashed or hung', () => {
    for (const signal of ['render-process-gone', 'unresponsive']) {
      const { contents, guard, close, ports } = setup();
      guard.setEdited(true);

      contents.emit(signal);

      expect(close()).toBe(false);
      expect(ports.ask).not.toHaveBeenCalled();
    }
  });

  it('asks again once a hung renderer responds', () => {
    const { contents, guard, close } = setup();
    guard.setEdited(true);
    contents.emit('unresponsive');
    contents.emit('responsive');

    expect(close()).toBe(true);
  });

  it('resets the guard and the macOS dot on a committed navigation', () => {
    const { contents, guard, close, window } = setup();
    guard.setEdited(true);
    contents.emit('render-process-gone');

    contents.emit('did-navigate');

    expect(window.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(close()).toBe(false);
    // The reloaded page is guarded again once it reports.
    guard.setEdited(true);
    expect(close()).toBe(true);
  });

  it('does not reset on a navigation that never committed', () => {
    const { contents, guard, close } = setup();
    guard.setEdited(true);

    contents.emit('did-start-navigation');

    expect(close()).toBe(true);
  });
});

describe('holdQuit', () => {
  it('holds Quit while any window is edited, and quits once every one has answered', () => {
    const a = setup();
    const b = setup();
    a.guard.setEdited(true);
    b.guard.setEdited(true);
    const guards = [a.guard, b.guard];
    const event = () => ({ preventDefault: vi.fn() });

    const first = event();
    holdQuit(guards, first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(a.ports.ask).toHaveBeenCalledOnce();
    expect(b.ports.ask).toHaveBeenCalledOnce();

    // Answering the first quits again, which runs before-quit anew: the second still holds it.
    a.guard.answer(true);
    expect(a.ports.quit).toHaveBeenCalledOnce();
    const second = event();
    holdQuit(guards, second);
    expect(second.preventDefault).toHaveBeenCalled();

    b.guard.answer(true);
    expect(b.ports.quit).toHaveBeenCalledOnce();
    const third = event();
    holdQuit(guards, third);
    expect(third.preventDefault).not.toHaveBeenCalled();
  });

  it('does not hold Quit when no window is edited', () => {
    const { guard } = setup();
    const event = { preventDefault: vi.fn() };

    holdQuit([guard], event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
