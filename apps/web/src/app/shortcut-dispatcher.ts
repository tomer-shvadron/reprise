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

/** Whether Space presses this element, which is why a menu must not leave focus on one. */
export function activatesOnSpace(element: Element): boolean {
  return element.closest(ACTIVATES_ON_SPACE) !== null;
}

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
 * The commands an open modal lets through: each maps to the attribute marking the content of the
 * modal it passes, and it passes only when every open modal carries that attribute. A dialog's own
 * toggle (the palette, the cheat sheet) is the sole modal; the app sheets (the Library and
 * Sounds, `data-app-sheet`) are browsing surfaces, not forms, so a drop onto them imports, and
 * Space still plays and pauses (a text field keeps its own Space, see `leavesKeyToTarget`).
 *
 * `app.contextMenu` (Shift+F10) passes for the library and sound rows. Its fallback with focus on
 * the body would be the score behind the sheet, so `openFocusedMenu` and the body fallback do
 * nothing while a modal is open.
 */
const PASSES_MODAL: Readonly<Record<string, string>> = {
  'app.commandPalette': 'data-command-palette',
  'app.goToBar': 'data-command-palette',
  'app.shortcuts': 'data-shortcut-sheet',
  'app.shortcutsAlt': 'data-shortcut-sheet',
  'app.drop': 'data-app-sheet',
  'transport.playPause': 'data-app-sheet',
  'app.contextMenu': 'data-app-sheet',
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

/** Whether a modal dialog is open anywhere, a sheet included. */
export function modalOpen(): boolean {
  return openModals().length > 0;
}

/**
 * Whether an open modal stops this command, for a shortcut and for the desktop menu alike (the
 * menu accelerator fires when the dispatcher lets a keydown through). Only the commands in
 * `PASSES_MODAL` pass, and only when every open modal is the kind they name, so Cmd+K closes the
 * palette but opens no second one over another dialog.
 */
export function modalBlocksCommand(id: string): boolean {
  const modals = openModals();
  if (modals.length === 0) return false;
  const marker = PASSES_MODAL[id];
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

/** A bare key the focused element handles itself: text in a field, Space or Enter on a control, a character typed to an open menu. */
function leavesKeyToTarget(event: KeyboardEvent): boolean {
  const { target } = event;
  if (isEditable(target)) return true;
  // An open menu types to its items (typeahead) and Radix leaves the key to bubble to the window:
  // a printable bare key there is the menu's, not a command's. A closing menu (still holding
  // focus until the close-focus handler runs) has no typeahead, so the key stays a command's.
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
  if (
    bare &&
    event.key.length === 1 &&
    target instanceof Element &&
    target.closest('[role="menu"][data-state="open"]')
  ) {
    return true;
  }
  const activates = event.key === ' ' || event.key === 'Enter';
  return activates && target instanceof Element && activatesOnSpace(target);
}

/**
 * Runs the registered command whose shortcut matches the event; returns whether one ran.
 *
 * What never runs a command (the one place these rules live; the keyboard-shortcuts reference
 * summarises them for users):
 * - Any shortcut while a modal dialog is open, except a dialog's own toggle (Cmd/Ctrl+K for the
 *   palette, Cmd/Ctrl+G to switch the open palette to a bar number, ? or Cmd/Ctrl+/ for the cheat
 *   sheet) when that dialog is the only modal, and Space for play and pause (`transport.playPause`)
 *   when every open modal is an app sheet (the Library or Sounds), outside a text field and off a
 *   control that takes Space itself, and Shift+F10 (`app.contextMenu`) when every open modal is
 *   an app sheet, for the row menus; with nothing focused it opens no menu while a modal is open. Escape and the rest stay with the dialog. The desktop menu
 *   obeys the same rule through `menuCommandAllowed`, so its Play/Pause also runs over a sheet.
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
