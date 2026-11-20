import { useRef, type SyntheticEvent } from 'react';

/**
 * Focus handling for a dropdown menu's trigger. Radix would return focus to the trigger on close,
 * which then takes the next Space, so only someone who tabbed to the trigger goes back to it: a
 * click leaves focus where it was. `remember` goes on the trigger's capture handlers, before
 * Radix's own handler opens the menu, so it never reads the menu's content.
 */
export function useMenuFocusReturn() {
  const returnTo = useRef<Element | null>(null);
  return {
    remember: () => {
      returnTo.current = globalThis.document.activeElement;
    },
    onCloseAutoFocus: (event: Event | SyntheticEvent) => {
      event.preventDefault();
      const target = returnTo.current;
      returnTo.current = null;
      if (
        target instanceof HTMLElement &&
        target.isConnected &&
        target !== globalThis.document.body
      ) {
        target.focus();
      }
    },
  };
}
