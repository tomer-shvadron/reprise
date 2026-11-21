import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { useBodyContextMenuFallback } from './context-menu/body-fallback';

// A sheet or dialog covers the score: the menu key must not reach the score behind it.
const sheet = <div role="dialog" data-state="open" data-app-sheet="library" />;

function Fallback() {
  useBodyContextMenuFallback();
  return null;
}

/** A keyboard `contextmenu` event: a pointer event with no pointer type, as Chromium raises it. */
function keyboardContextMenu(): Event {
  class FakePointerEvent extends MouseEvent {
    readonly pointerType = '';
  }
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  return new FakePointerEvent('contextmenu', { bubbles: true, cancelable: true });
}

function scoreSurface() {
  const surface = document.createElement('div');
  surface.setAttribute('data-score-surface', '');
  const asked = vi.fn();
  surface.addEventListener('contextmenu', asked);
  document.body.append(surface);
  return { surface, asked };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the context menu key behind a modal', () => {
  it('opens the score menu from the body, but not while a modal is open (app.contextMenu)', () => {
    const run = () => void createAppRegistry(createTestServices()).get('app.contextMenu')?.run();
    const { asked } = scoreSurface();
    run();
    expect(asked).toHaveBeenCalledOnce();

    asked.mockClear();
    render(sheet);
    run();
    expect(asked).not.toHaveBeenCalled();
  });

  it('opens the score menu for a bodyless keyboard event, but not while a modal is open', () => {
    render(<Fallback />);
    const { asked } = scoreSurface();
    document.body.dispatchEvent(keyboardContextMenu());
    expect(asked).toHaveBeenCalledOnce();

    asked.mockClear();
    render(sheet);
    document.body.dispatchEvent(keyboardContextMenu());
    expect(asked).not.toHaveBeenCalled();
  });
});
