import type { MouseEvent } from 'react';

// A click must not take focus from the page, or the next Space would press the button again.
export const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
};
