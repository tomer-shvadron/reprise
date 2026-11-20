import type { MouseEvent } from 'react';

// A click must not take focus from the page, or the next Space would press the button again.
export const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};

/** A tooltip's text: the label, then the shortcut in parentheses when the command has one. */
export function tooltipText(label: string, keys: string | undefined): string {
  return keys ? `${label} (${keys})` : label;
}
