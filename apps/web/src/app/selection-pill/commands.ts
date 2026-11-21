import type { Command } from '../command-registry';

export type SelectionPillCommandId = 'view.focusSelectionPill';

type SelectionPillCommand = Command & { id: SelectionPillCommandId };

/** The pill's root; `hidden` while it is not shown. */
export const PILL_SELECTOR = '[data-selection-pill]';

/** The buttons a toolbar arrow can land on. */
export const PILL_BUTTON_SELECTOR = 'button:not(:disabled)';

/** The pill's tab stop: the roving item, else the first enabled button. */
export function pillEntry(root: Element): HTMLElement | undefined {
  const buttons = [...root.querySelectorAll<HTMLElement>(PILL_BUTTON_SELECTOR)];
  return buttons.find((button) => button.tabIndex === 0) ?? buttons[0];
}

function shownPill(): Element | undefined {
  const root = globalThis.document.querySelector(PILL_SELECTOR);
  return root && !root.hasAttribute('hidden') ? root : undefined;
}

/**
 * Moves focus into the selection pill (#339), the way Alt+F10 reaches a toolbar in web editors.
 * Tab from the score gets there too. The pill never takes focus by itself.
 */
export function selectionPillCommands(): SelectionPillCommand[] {
  return [
    {
      id: 'view.focusSelectionPill',
      title: 'Focus the selection toolbar',
      // Option+F10 on a Mac.
      shortcut: { key: 'F10', alt: true },
      inPalette: false,
      repeat: false,
      enabled: () => shownPill() !== undefined,
      run: () => {
        const root = shownPill();
        if (root) pillEntry(root)?.focus();
      },
    },
  ];
}
