import { bindingId, isShortcutCharacter, isShortcutKey, type KeyBinding } from './keymap';
import { shortcutId, type KeyboardPlatform, type Shortcut } from './keyboard';

export type KeyEventInfo = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'isComposing'
>;

export type RefuseReason =
  | 'native'
  | 'select-all'
  | 'reserved'
  | 'control'
  | 'windows-key'
  | 'option-symbol'
  | 'unsupported';

export type KeyRead =
  | { kind: 'wait' }
  | { kind: 'cancel' }
  | { kind: 'leave' }
  | { kind: 'refuse'; reason: RefuseReason }
  | { kind: 'key'; binding: KeyBinding };

const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Fn',
  'FnLock',
  'OS',
]);

/** The modifiers held, as the platform prints them, for the live "Press a key" text. */
export function heldModifiers(
  event: Pick<KeyEventInfo, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  platform: KeyboardPlatform,
): string {
  if (platform === 'mac') {
    return `${event.ctrlKey ? '⌃' : ''}${event.altKey ? '⌥' : ''}${event.shiftKey ? '⇧' : ''}${event.metaKey ? '⌘' : ''}`;
  }
  return [
    event.metaKey && 'Win',
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
  ]
    .filter(Boolean)
    .join('+');
}

const LATIN = /^[a-z\d]$/i;
const ASCII_PRINTABLE = /^[\x20-\x7e]$/;
const BRACKETS: Readonly<Record<string, string>> = { BracketLeft: '[', BracketRight: ']' };

/**
 * The key the matcher (`matchesKey` in keyboard.ts) matches for this keypress, so a recorded key
 * fires when pressed: a bracket or a digit by its physical key (AZERTY's `&` records 1), a letter
 * by its physical key under Option on a Mac, any other ASCII character as printed (Hebrew's W
 * key, which prints `'`, records `'`), a letter by its physical key when the layout printed
 * something else, any other printable character as printed, a named key by its name.
 */
function characterOf(
  event: KeyEventInfo,
  platform: KeyboardPlatform,
): { key: string } | { reason: RefuseReason } {
  const bracket = BRACKETS[event.code];
  if (bracket !== undefined) return { key: bracket };
  const digit = /^Digit(\d)$/.exec(event.code);
  if (digit?.[1]) return { key: digit[1] };
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase();
  const optionOnMac = platform === 'mac' && event.altKey;
  if (letter !== undefined && optionOnMac) return { key: letter };
  if (LATIN.test(event.key)) return { key: event.key.toLowerCase() };
  // An Option-symbol (⌥; gives "…") would print as a key nobody can find.
  if (optionOnMac && isShortcutCharacter(event.key)) return { reason: 'option-symbol' };
  // Here the key is not a bracket key, and a bracket shortcut fires only from one (Dvorak's `[`).
  if (event.key === '[' || event.key === ']') return { reason: 'unsupported' };
  if (ASCII_PRINTABLE.test(event.key)) return { key: event.key.toLowerCase() };
  if (letter !== undefined) return { key: letter };
  if (isShortcutCharacter(event.key)) return { key: event.key.toLowerCase() };
  return isShortcutKey(event.key) ? { key: event.key } : { reason: 'unsupported' };
}

// The first rule is main's ROLE_KEYS (apps/desktop/src/main/validate.ts), the keys its menu keeps
// for its own roles on every platform: a menu item given one would silently show no key. A test
// in the desktop package pins the two lists together.
export const ROLE_KEY_RULES: readonly (readonly [string, boolean, boolean, boolean])[] = [
  ['q', true, false, false],
  ['w', true, false, false],
  ['h', true, false, false],
  ['h', true, false, true],
  ['m', true, false, false],
];

function reservedFor(
  key: string,
  mod: boolean,
  shift: boolean,
  alt: boolean,
  platform: KeyboardPlatform,
): boolean {
  if (ROLE_KEY_RULES.some(([k, m, s, a]) => k === key && m === mod && s === shift && a === alt)) {
    return true;
  }
  if (platform === 'mac') return mod && !shift && !alt && (key === ' ' || key === '`');
  if (alt && !mod && !shift) return key === 'F4' || key === ' ';
  if (mod && !alt && !shift) return key === 'F4';
  return !mod && !alt && !shift && key === 'F10';
}

/** Why a binding cannot be recorded, if it cannot. `natives` are the keys of the `native` commands. */
export function refusalOf(
  binding: KeyBinding,
  platform: KeyboardPlatform,
  natives: readonly Shortcut[],
): RefuseReason | undefined {
  const mod = Boolean(binding.mod);
  const shift = Boolean(binding.shift);
  const alt = Boolean(binding.alt);
  const id = bindingId(binding);
  if (natives.some((native) => shortcutId(native) === id)) return 'native';
  if (mod && !shift && !alt && binding.key === 'a') return 'select-all';
  if (reservedFor(binding.key, mod, shift, alt, platform)) return 'reserved';
  return undefined;
}

/**
 * One keydown while recording. `natives` are the keys of the commands the browser owns, which
 * the recorder refuses. The binding keeps `event.code` beside the key for reference; the matcher
 * does not read it.
 */
export function readKeyEvent(
  event: KeyEventInfo,
  platform: KeyboardPlatform,
  natives: readonly Shortcut[] = [],
): KeyRead {
  if (
    event.isComposing ||
    event.repeat ||
    event.key === 'Process' ||
    event.key === 'Unidentified' ||
    MODIFIER_KEYS.has(event.key)
  ) {
    return { kind: 'wait' };
  }
  if (event.key === 'Escape') return { kind: 'cancel' };
  if (event.key === 'Tab') return { kind: 'leave' };
  const mac = platform === 'mac';
  if (mac ? event.ctrlKey : event.metaKey) {
    return { kind: 'refuse', reason: mac ? 'control' : 'windows-key' };
  }
  const character = characterOf(event, platform);
  if ('reason' in character) return { kind: 'refuse', reason: character.reason };
  const { key } = character;
  const mod = mac ? event.metaKey : event.ctrlKey;
  const binding: KeyBinding = {
    key,
    ...(mod && { mod: true }),
    ...(event.shiftKey && { shift: true }),
    ...(event.altKey && { alt: true }),
    ...(event.code && { code: event.code.slice(0, 32) }),
  };
  const reason = refusalOf(binding, platform, natives);
  return reason ? { kind: 'refuse', reason } : { kind: 'key', binding };
}
