export type KeyboardPlatform = 'mac' | 'other';

export interface Shortcut {
  /** A letter or digit matches its printed character, or the physical key on a non-Latin layout. */
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

const LATIN_KEY = /^[a-z\d]$/i;

function physicalCode(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return undefined;
}

function matchesKey(event: KeyEventLike, key: string): boolean {
  // A Latin character is what the keycap shows (QWERTZ, Dvorak); only when the layout printed
  // something else (Hebrew, an Option symbol on macOS) does the physical key stand in for it.
  if (!LATIN_KEY.test(event.key)) {
    const code = physicalCode(key);
    if (code !== undefined) return event.code === code;
  }
  return event.key.toLowerCase() === key.toLowerCase();
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
  return matchesKey(event, shortcut.key);
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
