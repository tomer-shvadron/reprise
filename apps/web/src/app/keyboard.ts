export type KeyboardPlatform = 'mac' | 'other';

export interface Shortcut {
  /**
   * A key matches the character the layout prints. A digit and a bracket always match their
   * physical key (AZERTY prints `&` where a 1 is, Hebrew swaps the brackets), and on macOS with
   * Option held a letter does too, since Option rewrites the character. When nothing matches by
   * character (see `KeyMatch`), a letter or a punctuation mark falls back to the physical key if
   * the layout printed something else (a Hebrew letter). `' '` is Space; named keys (`Enter`,
   * `F9`) are spelled as `KeyboardEvent.key` spells them.
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
// A letter of another script (Hebrew, Cyrillic, Greek). A Latin letter with a mark (ß, ù) is the
// key's own character, and a symbol (§, £, ¡) is not a letter a layout swapped in for punctuation.
const NON_LATIN_CHARACTER = /^(?![\p{Script=Latin}\p{ASCII}])\p{L}$/u;

// On the Hebrew layout the physical `[` key types `]`, which would swap the pair by character.
const BRACKETS: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight' };

// The US-layout key that types each punctuation character, split by Shift: a layout that prints
// a letter on the key (Hebrew, Russian) must not run the shifted spelling's bare twin.
const BASE_PUNCTUATION: Readonly<Record<string, string>> = {
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
};
const SHIFTED_PUNCTUATION: Readonly<Record<string, string>> = {
  ':': 'Semicolon',
  '"': 'Quote',
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash',
  '+': 'Equal',
};

// A layout without bracket keys of its own (Dvorak types `[` and `]` on the minus and equal
// keys) still prints the character, with no modifier a bracket shortcut would not take. A digit
// key printing one is a Mac's Option layer (German ⌥5 prints `[`), which stays the digit's.
function onOtherKey(event: KeyEventLike, key: string): boolean {
  return event.key === key && !/^(Bracket|Digit|Numpad)/.test(event.code);
}

// The dead Quote key of US-International: `'` bare and `"` with Shift (true).
const DEAD_QUOTE: Readonly<Record<string, boolean>> = { "'": false, '"': true };

/**
 * `character` is the pass that decides first: what the key prints. `physical` runs only when no
 * command matched by character, so a printed `/` stays the triplet while a Hebrew W key, which
 * prints `'` that nothing uses, still reaches W.
 */
export type KeyMatch = 'character' | 'relaxed' | 'physical';

// Keys the pass between the two rescues, by what the layout prints:
// - a punctuation character that a layout types with Shift (German `=` is Shift+0, `;` is
//   Shift+comma) still runs the binding that names no Shift, since no US key types that
//   character shifted, so no shifted binding can own the key;
// - a bracket typed with Option on a Mac that has no bracket key of its own to put it on
//   (Spanish ⌥+ prints `]`), on the bracket's own physical key.
function relaxedModifiers(
  event: KeyEventLike,
  shortcut: Shortcut,
  platform: KeyboardPlatform,
): boolean {
  const { key } = shortcut;
  if (!shortcut.shift && event.shiftKey && !event.altKey) {
    return BASE_PUNCTUATION[key] !== undefined && event.key === key;
  }
  if (!shortcut.alt && event.altKey && !event.shiftKey && platform === 'mac') {
    const bracket = BRACKETS[key];
    return bracket !== undefined && event.code === bracket && event.key === key;
  }
  return false;
}

function matchesKey(
  event: KeyEventLike,
  key: string,
  platform: KeyboardPlatform,
  by: KeyMatch,
): boolean {
  if (by === 'relaxed') return matchesKey(event, key, platform, 'character');
  if (by === 'character') {
    const bracket = BRACKETS[key];
    if (bracket !== undefined) return event.code === bracket || onOtherKey(event, key);
    // The printed digit still counts, for the numpad.
    if (/^\d$/.test(key)) return event.code === `Digit${key}` || event.key === key;
    // Option rewrites the character on a Mac, and types ASCII on German, Nordic and Spanish.
    if (/^[a-z]$/i.test(key) && platform === 'mac' && event.altKey) {
      return event.code === `Key${key.toUpperCase()}`;
    }
    return event.key.toLowerCase() === key.toLowerCase();
  }
  if (event.key === 'Process' || event.key === 'Unidentified') return false;
  // US-International types `"` and `'` with a dead key, which prints no character to compare.
  if (event.key === 'Dead' && DEAD_QUOTE[key] !== undefined) {
    return event.code === 'Quote' && DEAD_QUOTE[key] === event.shiftKey;
  }
  if (/^[a-z]$/i.test(key)) {
    return !LATIN_KEY.test(event.key) && event.code === `Key${key.toUpperCase()}`;
  }
  // Only a single letter of another script: a named or dead key printed
  // nothing to compare.
  if (!NON_LATIN_CHARACTER.test(event.key)) return false;
  const code = (event.shiftKey ? SHIFTED_PUNCTUATION : BASE_PUNCTUATION)[key];
  return code !== undefined && event.code === code;
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

/**
 * Whether the event is the shortcut. Without `by`, either match counts, for the callers that match
 * one key against one shortcut; the dispatcher runs the two passes apart.
 */
export function matchesShortcut(
  event: KeyEventLike,
  shortcut: Shortcut,
  platform: KeyboardPlatform,
  by?: KeyMatch,
): boolean {
  if (!shortcutOn(shortcut, platform)) return false;
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const otherModifier = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (otherModifier || mod !== Boolean(shortcut.mod)) return false;
  const exact =
    event.shiftKey === Boolean(shortcut.shift) && event.altKey === Boolean(shortcut.alt);
  if (by === 'relaxed') {
    return (
      relaxedModifiers(event, shortcut, platform) && matchesKey(event, shortcut.key, platform, by)
    );
  }
  if (by !== undefined) return exact && matchesKey(event, shortcut.key, platform, by);
  return (
    (exact && matchesKey(event, shortcut.key, platform, 'character')) ||
    (exact && matchesKey(event, shortcut.key, platform, 'physical')) ||
    (relaxedModifiers(event, shortcut, platform) &&
      matchesKey(event, shortcut.key, platform, 'relaxed'))
  );
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
