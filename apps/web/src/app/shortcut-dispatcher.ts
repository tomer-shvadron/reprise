import { contextRank, runCommand, type CommandRegistry } from './command-registry';
import { matchesShortcut, type KeyboardPlatform } from './keyboard';
import { isEditable, isTextField } from './text-field';

// Sliders are left out on purpose: Space plays while one has focus.
const ACTIVATES_ON_SPACE = [
  'button',
  'a[href]',
  'summary',
  ...[
    'button',
    'switch',
    'checkbox',
    'radio',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'tab',
    'treeitem',
  ].map((role) => `[role="${role}"]`),
].join(', ');

/** Keys that move a caret, so a text field keeps them whatever the modifiers. */
const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * The commands that close their own dialog, the one shortcut that dialog lets through: each maps
 * to the attribute marking its content, so a toggle passes only when its dialog is the sole modal.
 */
const TOGGLE_MARKER: Readonly<Record<string, string>> = {
  'app.commandPalette': 'data-command-palette',
  'app.goToBar': 'data-command-palette',
  'app.shortcuts': 'data-shortcut-sheet',
  'app.shortcutsAlt': 'data-shortcut-sheet',
};

/**
 * Radix sets `role` and `data-state` on its dialogs but not `aria-modal`, so both forms count.
 * A Radix popover is also `role="dialog"` yet not modal: it sits in a popper wrapper, left out.
 */
const OPEN_MODAL = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(', ');

/**
 * The modal dialogs open anywhere in the document, not only around the focused element: focus can
 * drift to the body behind a dialog, and a shortcut must not edit the score from there.
 */
function openModals(): Element[] {
  return [...document.querySelectorAll(OPEN_MODAL)].filter(
    (dialog) => dialog.closest('[data-radix-popper-content-wrapper]') === null,
  );
}

/**
 * Whether an open modal stops this command, for a shortcut and for the desktop menu alike (the
 * menu accelerator fires when the dispatcher lets a keydown through). Only a dialog's own
 * toggle passes, and only when that dialog is the sole modal, so Cmd+K closes the palette but opens
 * no second one over another dialog.
 */
export function modalBlocksCommand(id: string): boolean {
  const modals = openModals();
  if (modals.length === 0) return false;
  const marker = TOGGLE_MARKER[id];
  if (marker === undefined) return true;
  return modals.some((modal) => !modal.hasAttribute(marker));
}

/**
 * Whether a command sent by the native menu may run now. A modal drops all of them, except a
 * text field's own undo and redo, which the command replays on the field and not on the score.
 */
export function menuCommandAllowed(id: string): boolean {
  if (!modalBlocksCommand(id)) return true;
  return (id === 'edit.undo' || id === 'edit.redo') && isTextField(document.activeElement);
}

/** Keys that delete text, so a text field keeps them whatever the modifiers. */
const DELETE_KEYS = new Set(['Backspace', 'Delete']);

/** A bare key the focused element handles itself: text in a field, Space or Enter on a control. */
function leavesKeyToTarget(event: KeyboardEvent): boolean {
  const { target } = event;
  if (isEditable(target)) return true;
  const activates = event.key === ' ' || event.key === 'Enter';
  return activates && target instanceof Element && target.closest(ACTIVATES_ON_SPACE) !== null;
}

/**
 * Runs the registered command whose shortcut matches the event; returns whether one ran.
 *
 * What never runs a command (the one place these rules live; the keyboard-shortcuts reference
 * summarises them for users):
 * - Any shortcut while a modal dialog is open, except a dialog's own toggle (Cmd/Ctrl+K for the
 *   palette, Cmd/Ctrl+G to switch the open palette to a bar number, ? or Cmd/Ctrl+/ for the cheat sheet) when that dialog is the only modal. Escape and the rest stay with the dialog. The desktop menu obeys the
 *   same rule through `menuCommandAllowed`.
 * - A key that was already handled (`defaultPrevented`) or is part of IME composition.
 * - A bare key (no Cmd or Ctrl) typed in a text field, and Space or Enter on a focused control.
 * - Arrows, Home, End and Page keys in a text field, select, range or checkbox, whatever the
 *   modifiers.
 * - Backspace and Delete in a text field, whatever the modifiers: they edit its text.
 * - A `native` command's key (Cmd or Ctrl with C, X or V): the key is left alone, not even its
 *   default is prevented, so the browser raises its own copy, cut or paste event, which the
 *   clipboard handler answers by the same rules (a text field and a modal keep the event).
 */
export function dispatchShortcut(
  event: KeyboardEvent,
  registry: CommandRegistry,
  platform: KeyboardPlatform,
  onError: (error: unknown) => void = console.error,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;

  const matching = registry.available().filter((candidate) => {
    const shortcut = registry.shortcutOf(candidate);
    if (!shortcut || candidate.native) return false;
    if (DELETE_KEYS.has(event.key) && isTextField(event.target)) return false;
    if (NAVIGATION_KEYS.has(event.key) && isEditable(event.target)) return false;
    if (!shortcut.mod && leavesKeyToTarget(event)) return false;
    return matchesShortcut(event, shortcut, platform);
  });
  // An active context's binding shadows the context-free one on the same key; between active
  // contexts, the earlier one in COMMAND_CONTEXTS wins.
  const command = matching.sort((a, b) => contextRank(a.context) - contextRank(b.context))[0];
  if (!command) return false;

  if (modalBlocksCommand(command.id)) {
    // Outside a text field, swallow the key so the browser's own Save, Print or Open does not
    // take it; inside one the field keeps it, and the desktop menu drops it (menuCommandAllowed).
    if (!isTextField(event.target)) event.preventDefault();
    return false;
  }

  // A held key is still swallowed, so a held Space does not scroll the page.
  event.preventDefault();
  if (event.repeat && command.repeat === false) return false;
  runCommand(command, onError);
  return true;
}

export function installShortcutDispatcher(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  registry: CommandRegistry,
  platform: KeyboardPlatform,
): () => void {
  const listener = (event: KeyboardEvent) => {
    dispatchShortcut(event, registry, platform);
  };
  target.addEventListener('keydown', listener);
  return () => {
    target.removeEventListener('keydown', listener);
  };
}
