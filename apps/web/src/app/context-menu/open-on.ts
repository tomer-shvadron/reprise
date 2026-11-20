/**
 * The `contextmenu` events this module raised itself, which are keyboard opens: a synthetic event
 * has no `pointerType`, so it is marked here instead.
 */
const synthetic = new WeakSet<Event>();

/**
 * Whether a `contextmenu` event came from the keyboard (the Menu key, Shift+F10 on Windows) and
 * not from a pointer. The Pointer Events spec gives a keyboard one a `pointerType` of `''`, but
 * Chromium raises it as a `PointerEvent` of type `mouse` with `button` -1 and no buttons down
 * (checked in the player e2e), so a press-less event also counts: a right-click has `button` 2
 * (Windows raises it on release, when `buttons` is already 0) and a mac Ctrl+click has the
 * primary button still down. The events this module raised itself are marked.
 */
export function contextMenuVia(event: Event): 'pointer' | 'keyboard' {
  if (synthetic.has(event)) return 'keyboard';
  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
    if (event.pointerType === '') return 'keyboard';
    // Only a mouse: a touch or pen long-press raised on release also has no buttons down.
    return event.pointerType === 'mouse' && event.button !== 2 && event.buttons === 0
      ? 'keyboard'
      : 'pointer';
  }
  return 'pointer';
}

/**
 * Opens the context menu of the surface around `element`, as the Menu key would: a bubbling,
 * cancelable `contextmenu` event at the element's bottom-left corner, which the nearest surface
 * that handles it answers. Chromium raises none for Shift+F10 on macOS, and the selection
 * pill's menu button has no key at all, so both come through here.
 */
export function openContextMenuOn(element: Element): void {
  const rect = element.getBoundingClientRect();
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: rect.left,
    clientY: rect.bottom,
  });
  synthetic.add(event);
  element.dispatchEvent(event);
}
