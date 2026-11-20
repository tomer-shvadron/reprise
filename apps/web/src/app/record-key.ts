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
const BRACKETS: Readonly<Record<string, string>> = { BracketLeft: '[', BracketRight: ']' };

/**
 * The key the matcher (`matchesKey` in keyboard.ts) would match for this keypress: a bracket by
 * its physical key, a Latin character as printed, a letter or digit by its physical key when the
 * layout printed something else (Hebrew, an Option symbol), any other printable character as
 * printed, a named key by its name.
 */
function characterOf(
  event: KeyEventInfo,
  platform: KeyboardPlatform,
): { key: string } | { reason: RefuseReason } {
  const bracket = BRACKETS[event.code];
  if (bracket !== undefined) return { key: bracket };
  if (LATIN.test(event.key)) return { key: event.key.toLowerCase() };
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter?.[1]) return { key: letter[1].toLowerCase() };
  const digit = /^Digit(\d)$/.exec(event.code);
  if (digit?.[1]) return { key: digit[1] };
  if (isShortcutCharacter(event.key)) {
    // An Option-symbol (⌥; gives "…") would print as a key nobody can find.
    if (platform === 'mac' && event.altKey) return { reason: 'option-symbol' };
    return { key: event.key.toLowerCase() };
  }
  return isShortcutKey(event.key) ? { key: event.key } : { reason: 'unsupported' };
}

function reservedFor(
  key: string,
  mod: boolean,
  shift: boolean,
  alt: boolean,
  platform: KeyboardPlatform,
): boolean {
  if (platform === 'mac') {
    if (mod && !shift && !alt) return ['q', 'w', 'h', 'm', ' ', '`'].includes(key);
    return mod && alt && !shift && key === 'h';
  }
  if (alt && !mod && !shift) return key === 'F4' || key === ' ';
  if (mod && !alt && !shift) return key === 'w' || key === 'F4';
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
 * the recorder refuses. A key in the recorded binding keeps `event.code` for #242.
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
