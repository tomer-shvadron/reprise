import { describe, expect, it } from 'vitest';

import { contextMenuVia, openContextMenuOn } from './open-on';

const pointerEvent = (init: PointerEventInit) =>
  new PointerEvent('contextmenu', { bubbles: true, cancelable: true, ...init });

describe('contextMenuVia', () => {
  it('reads the spec value for a keyboard open', () => {
    expect(contextMenuVia(pointerEvent({ pointerType: '' }))).toBe('keyboard');
  });

  it('reads Chromium keyboard opens: a mouse event with no button and nothing down', () => {
    expect(contextMenuVia(pointerEvent({ pointerType: 'mouse', button: -1, buttons: 0 }))).toBe(
      'keyboard',
    );
  });

  it('reads a right-click as a pointer open, on press (Linux, macOS) and on release (Windows)', () => {
    expect(contextMenuVia(pointerEvent({ pointerType: 'mouse', button: 2, buttons: 2 }))).toBe(
      'pointer',
    );
    expect(contextMenuVia(pointerEvent({ pointerType: 'mouse', button: 2, buttons: 0 }))).toBe(
      'pointer',
    );
  });

  it('reads a mac Ctrl+click as a pointer open', () => {
    expect(
      contextMenuVia(pointerEvent({ pointerType: 'mouse', button: 0, buttons: 1, ctrlKey: true })),
    ).toBe('pointer');
  });

  it('reads the event openContextMenuOn raised as a keyboard open', () => {
    const button = document.createElement('button');
    document.body.append(button);
    let via: string | undefined;
    button.addEventListener('contextmenu', (event) => {
      via = contextMenuVia(event);
    });
    openContextMenuOn(button);
    expect(via).toBe('keyboard');
    button.remove();
  });
});
