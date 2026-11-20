import type { Command } from './command-registry';
import { formatShortcut, shortcutOn, type Shortcut, type KeyboardPlatform } from './keyboard';

const CATEGORIES: Record<string, string> = {
  app: 'App',
  file: 'File',
  edit: 'Edit',
  view: 'View',
  transport: 'Transport',
  track: 'Track',
  library: 'Library',
  trainer: 'Trainer',
  editor: 'Editor',
  sounds: 'Sounds',
};

const categoryOf = (id: string) => CATEGORIES[id.split('.')[0] ?? ''] ?? 'Other';
const cell = (text: string) => text.replaceAll('|', '\\|');

/** One line of the reference: every command of a title, with the keys each platform prints. */
export interface ShortcutEntry {
  title: string;
  category: string;
  context: 'Global' | 'Editing';
  mac: string[];
  other: string[];
}

/**
 * The commands grouped by category and listed once per title, in registry order within a
 * category. `shortcutOf` is the registry's `shortcutOf`, so the cheat sheet and the generated
 * reference show the keys a command answers to now, whatever overrides sit on the defaults.
 */
export function shortcutEntries(
  commands: readonly Command[],
  shortcutOf: (command: Command) => Shortcut | undefined,
): ShortcutEntry[] {
  const order = Object.values(CATEGORIES);
  const rows = new Map<string, ShortcutEntry>();
  const sorted = commands
    .map((command, index) => ({ command, index, category: categoryOf(command.id) }))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.index - b.index);
  for (const { command, category } of sorted) {
    const context = command.context === 'editing' ? 'Editing' : 'Global';
    const key = `${category}\n${context}\n${command.title}`;
    const row = rows.get(key) ?? { title: command.title, category, context, mac: [], other: [] };
    rows.set(key, row);
    const add = (keys: string[], platform: KeyboardPlatform) => {
      const shortcut = shortcutOn(shortcutOf(command), platform);
      if (shortcut) keys.push(formatShortcut(shortcut, platform));
    };
    add(row.mac, 'mac');
    add(row.other, 'other');
  }
  return [...rows.values()];
}

const DIGIT = /^\d$/;

/** Keys as one phrase: "Left or Right", with a run of digits written as a range ("0–9"). */
export function joinKeys(all: readonly string[]): string {
  // Two spellings can print alike (Shift+= is both `+` with Shift and `=` with Shift).
  const keys = [...new Set(all)];
  if (keys.length === 0) return '—';
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const first = keys[i] ?? '';
    let end = i;
    while (
      DIGIT.test(keys[end] ?? '') &&
      DIGIT.test(keys[end + 1] ?? '') &&
      Number(keys[end + 1]) === Number(keys[end]) + 1
    ) {
      end += 1;
    }
    // Two digits read better listed, three or more as a range.
    if (end - i >= 2) {
      parts.push(`${first}–${keys[end] ?? ''}`);
      i = end;
    } else {
      parts.push(first);
    }
  }
  return parts.join(' or ');
}

/** The keyboard-shortcuts reference table, from the registry's commands; one row per title. */
export function shortcutTable(
  commands: readonly Command[],
  shortcutOf: (command: Command) => Shortcut | undefined = (command) => command.shortcut,
): string {
  const lines = shortcutEntries(commands, shortcutOf).map(
    ({ title, category, context, mac, other }) =>
      `| ${cell(title)} | ${category} | ${context} | ${cell(joinKeys(mac))} | ${cell(joinKeys(other))} |`,
  );
  return [
    '| Command | Category | Context | macOS | Windows |',
    '| ------- | -------- | ------- | ----- | ------- |',
    ...lines,
  ].join('\n');
}
