export type KeyboardPlatform = 'mac' | 'other';

export interface Shortcut {
  /**
   * A key matches the ASCII character the layout prints; when the layout prints something else
   * (Hebrew letters, an Option symbol on macOS) the physical key stands in, so a letter, digit or
   * punctuation shortcut stays reachable. A bracket always matches its physical key. `' '` is Space; named keys (`Enter`, `F9`) are
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

// Any printable ASCII character, punctuation included: on the Hebrew layout the physical Q key
// prints `/`, and that `/` is the triplet key, not a Q.
const ASCII_KEY = /^[\x20-\x7e]$/;

// The US-layout key that types each punctuation character, shifted or not. Used only when the
// layout printed a non-ASCII character, so AZERTY's `$` (physical `]`) and `"` (physical `3`)
// keep resolving by character and never collide with the bracket and digit keys.
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ';': 'Semicolon',
  ':': 'Semicolon',
  "'": 'Quote',
  '"': 'Quote',
  ',': 'Comma',
  '<': 'Comma',
  '.': 'Period',
  '>': 'Period',
  '/': 'Slash',
  '?': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '+': 'Equal',
  '!': 'Digit1',
  ')': 'Digit0',
  $: 'Digit4',
};

function physicalCode(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return PUNCTUATION_CODES[key];
}

// On the Hebrew layout the physical `[` key types `]`, which would swap the pair by character.
const BRACKETS: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight' };

function matchesKey(event: KeyEventLike, key: string): boolean {
  const bracket = BRACKETS[key];
  if (bracket !== undefined) return event.code === bracket;
  // An ASCII character is what the keycap shows (QWERTZ, Dvorak); only when the layout printed
  // something else (Hebrew, an Option symbol on macOS) does the physical key stand in for it.
  if (!ASCII_KEY.test(event.key)) {
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

// As Guitar Pro prints them on macOS; elsewhere the key's own name without "Arrow".
const MAC_KEYS: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Home: '↖',
  End: '↘',
};

function keyName(key: string, platform: KeyboardPlatform): string {
  if (key === ' ') return 'Space';
  if (key === 'Enter') return platform === 'mac' ? '↩' : 'Enter';
  const mac = MAC_KEYS[key];
  if (mac !== undefined) return platform === 'mac' ? mac : key.replace(/^Arrow/, '');
  return key.length === 1 ? key.toUpperCase() : key;
}

/** One string per key cap, in the order and spelling `formatShortcut` prints them. */
export function shortcutParts(shortcut: Shortcut, platform: KeyboardPlatform): string[] {
  // A punctuation character already implies Shift where the layout needs it (`?`, `+`, `:`), and
  // is what the user types, so its Shift is not printed.
  const shift = shortcut.shift && (/^[a-z\d ]$/i.test(shortcut.key) || shortcut.key.length > 1);
  const key = keyName(shortcut.key, platform);
  const parts =
    platform === 'mac'
      ? [shortcut.alt && '⌥', shift && '⇧', shortcut.mod && '⌘']
      : [shortcut.mod && 'Ctrl', shortcut.alt && 'Alt', shift && 'Shift'];
  return [...parts.filter((part): part is string => typeof part === 'string'), key];
}

export function formatShortcut(shortcut: Shortcut, platform: KeyboardPlatform): string {
  return shortcutParts(shortcut, platform).join(platform === 'mac' ? '' : '+');
}

// The key that types a shifted punctuation character on a US layout. WAI-ARIA 1.2 asks for the
// key that makes the character ("Shift+/"), never the character itself ("?" or "Shift+?").
const SHIFTED_BASE: Readonly<Record<string, string>> = {
  '?': '/',
  ':': ';',
  '!': '1',
  '"': "'",
  ')': '0',
  $: '4',
  '<': ',',
  '>': '.',
};

/**
 * The shortcut in `aria-keyshortcuts` syntax, which names keys as `KeyboardEvent.key` does, with
 * WAI-ARIA's own spellings: `Plus` for a plus sign, which `+` as a separator could not carry.
 */
export function ariaKeyShortcuts(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const punctuation = shortcut.key.length === 1 && !/^[a-z\d ]$/i.test(shortcut.key);
  const based = punctuation ? SHIFTED_BASE[shortcut.key] : undefined;
  const key =
    shortcut.key === ' '
      ? 'Space'
      : shortcut.key === '+'
        ? 'Plus'
        : based !== undefined
          ? based
          : shortcut.key.length === 1
            ? shortcut.key.toUpperCase()
            : shortcut.key;
  // Punctuation that has no mapped base key already implies its Shift, as in `shortcutParts`.
  const shift = based !== undefined || !punctuation ? shortcut.shift : false;
  const mod = platform === 'mac' ? 'Meta' : 'Control';
  return [shortcut.mod && mod, shortcut.alt && 'Alt', shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}

const SPOKEN_KEYS: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
  '/': 'slash',
  '?': 'question mark',
  '.': 'period',
  ',': 'comma',
  '[': 'left bracket',
  ']': 'right bracket',
};

/** The shortcut spelled out for a screen reader and for the cheat sheet's filter: "Command+Shift+S". */
export function spokenShortcut(shortcut: Shortcut, platform: KeyboardPlatform): string {
  const key = SPOKEN_KEYS[shortcut.key] ?? keyName(shortcut.key, 'other');
  const mod = platform === 'mac' ? 'Command' : 'Ctrl';
  const alt = platform === 'mac' ? 'Option' : 'Alt';
  return [shortcut.mod && mod, shortcut.alt && alt, shortcut.shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}
