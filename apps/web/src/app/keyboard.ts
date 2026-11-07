export type KeyboardPlatform = 'mac' | 'other';

export interface Shortcut {
  /**
   * A letter or digit matches its printed character, or the physical key on a non-Latin layout;
   * a bracket always matches its physical key. `' '` is Space; named keys (`Enter`, `F9`) are
   * spelled as `KeyboardEvent.key` spells them.
   */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Bound on this platform only, such as Ctrl+Y for redo off macOS. */
  only?: KeyboardPlatform;
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

// On the Hebrew layout the physical `[` key types `]`, which would swap the pair by character.
const BRACKETS: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight' };

function matchesKey(event: KeyEventLike, key: string): boolean {
  const bracket = BRACKETS[key];
  if (bracket !== undefined) return event.code === bracket;
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

/** The shortcut if it is bound on `platform`, for every place that matches, prints or lists it. */
export function shortcutOn(
  shortcut: Shortcut | undefined,
  platform: KeyboardPlatform,
): Shortcut | undefined {
  return shortcut && (shortcut.only ?? platform) === platform ? shortcut : undefined;
}

export function matchesShortcut(
  event: KeyEventLike,
  shortcut: Shortcut,
  platform: KeyboardPlatform,
): boolean {
  if (!shortcutOn(shortcut, platform)) return false;
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const otherModifier = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (otherModifier || mod !== Boolean(shortcut.mod)) return false;
  if (event.shiftKey !== Boolean(shortcut.shift) || event.altKey !== Boolean(shortcut.alt)) {
    return false;
  }
  return matchesKey(event, shortcut.key);
}

function keyName(key: string, platform: KeyboardPlatform): string {
  if (key === ' ') return 'Space';
  if (key === 'Enter') return platform === 'mac' ? '↩' : 'Enter';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function formatShortcut(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key = keyName(shortcut.key, platform);
  if (platform === 'mac') {
    return `${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${shortcut.mod ? '⌘' : ''}${key}`;
  }
  return [shortcut.mod && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}

/** The shortcut in `aria-keyshortcuts` syntax, which names keys as `KeyboardEvent.key` does. */
export function ariaKeyShortcuts(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key =
    shortcut.key === ' '
      ? 'Space'
      : shortcut.key.length === 1
        ? shortcut.key.toUpperCase()
        : shortcut.key;
  const mod = platform === 'mac' ? 'Meta' : 'Control';
  return [shortcut.mod && mod, shortcut.alt && 'Alt', shortcut.shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}
