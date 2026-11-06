import { describe, expect, it, vi } from 'vitest';

import { installFirstGesture } from './first-gesture';

describe('installFirstGesture', () => {
  it('fires once, on the first pointer or key press', () => {
    const onGesture = vi.fn();
    installFirstGesture(window, onGesture);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(new PointerEvent('pointerdown'));

    expect(onGesture).toHaveBeenCalledOnce();
  });

  it('does nothing after its cleanup', () => {
    const onGesture = vi.fn();
    const cleanup = installFirstGesture(window, onGesture);

    cleanup();
    window.dispatchEvent(new PointerEvent('pointerdown'));

    expect(onGesture).not.toHaveBeenCalled();
  });
});
