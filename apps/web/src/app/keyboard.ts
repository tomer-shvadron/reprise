export type KeyboardPlatform = 'mac' | 'other';

export interface Shortcut {
  /** A letter or digit matches the physical key, so shortcuts survive non-Latin layouts. */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
>;

export function detectKeyboardPlatform(): KeyboardPlatform {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'mac' : 'other';
}

function physicalCode(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return undefined;
}

export function shortcutId(shortcut: Shortcut): string {
  const parts = [shortcut.mod && 'mod', shortcut.alt && 'alt', shortcut.shift && 'shift'];
  return [...parts.filter(Boolean), shortcut.key.toLowerCase()].join('+');
}

export function matchesShortcut(
  event: KeyEventLike,
  shortcut: Shortcut,
  platform: KeyboardPlatform,
): boolean {
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const otherModifier = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (otherModifier || mod !== Boolean(shortcut.mod)) return false;
  if (event.shiftKey !== Boolean(shortcut.shift) || event.altKey !== Boolean(shortcut.alt)) {
    return false;
  }
  const code = physicalCode(shortcut.key);
  return code === undefined
    ? event.key.toLowerCase() === shortcut.key.toLowerCase()
    : event.code === code;
}

export function formatShortcut(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  if (platform === 'mac') {
    return `${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.mod ? '⌘' : ''}${key}`;
  }
  return [shortcut.mod && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}
