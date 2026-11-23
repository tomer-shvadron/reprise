import { contextLabel, type Command, type ContextLabel } from './command-registry';
import {
  formatShortcut,
  shortcutOn,
  spokenShortcut,
  type Shortcut,
  type KeyboardPlatform,
} from './keyboard';

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

/** The position of a category in the listing order. */
export const categoryRank = (category: string): number =>
  Object.values(CATEGORIES).indexOf(category);

export const categoryOf = (id: string) => CATEGORIES[id.split('.')[0] ?? ''] ?? 'Other';

/**
 * What makes commands one control's aliases: the same category, context and title. That suits
 * the cheat sheet; a tooltip assumes the commands of a group are one action's alternate keys, so
 * it is wrong for a family such as `editor.fret0` to `fret9` ("Type fret digit"), which no
 * control binds as a whole.
 */
export const bindingGroup = (command: Command): string =>
  `${categoryOf(command.id)}\n${contextLabel(command.context)}\n${command.title}`;
const cell = (text: string) => text.replaceAll('|', '\\|');

/** One line of the reference: every command of a title, with the keys each platform prints. */
export interface ShortcutEntry {
  title: string;
  category: string;
  context: ContextLabel;
  mac: string[];
  other: string[];
  /** The same keys spelled out, per platform, for screen readers and the filter. */
  spoken: Record<KeyboardPlatform, string[]>;
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
    const context = contextLabel(command.context);
    const key = bindingGroup(command);
    const row = rows.get(key) ?? {
      title: command.title,
      category,
      context,
      mac: [],
      other: [],
      spoken: { mac: [], other: [] },
    };
    rows.set(key, row);
    const add = (keys: string[], platform: KeyboardPlatform) => {
      const shortcut = shortcutOn(shortcutOf(command), platform);
      if (!shortcut) return;
      keys.push(formatShortcut(shortcut, platform));
      row.spoken[platform].push(spokenShortcut(shortcut, platform));
    };
    add(row.mac, 'mac');
    add(row.other, 'other');
  }
  return [...rows.values()];
}

/** A bare digit, or a letter with at most a Shift: the keys that read as a run. */
const RUN_KEY = /^(\d|(?:⇧|Shift\+)?[A-Z])$/;

/** The kind and prefix of a run key, so "⇧A" and "A" never join and a digit never joins a letter. */
const runOf = (key: string | undefined): { group: string; code: number } | undefined => {
  if (key === undefined || !RUN_KEY.test(key)) return undefined;
  const last = key.slice(-1);
  return { group: key.slice(0, -1) + (/\d/.test(last) ? '#' : 'a'), code: last.charCodeAt(0) };
};

/** Keys as one phrase: "Left or Right", with a run of digits or letters written as a range ("0–9", "⇧A–G"). */
export function joinKeys(all: readonly string[]): string {
  // Two spellings can print alike (Shift+= is both `+` with Shift and `=` with Shift).
  const keys = [...new Set(all)];
  if (keys.length === 0) return '—';
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const first = keys[i] ?? '';
    let end = i;
    for (;;) {
      const here = runOf(keys[end]);
      const next = runOf(keys[end + 1]);
      if (!here || !next || here.group !== next.group || next.code !== here.code + 1) break;
      end += 1;
    }
    // Two keys read better listed, three or more as a range.
    if (end - i >= 2) {
      parts.push(`${first}–${(keys[end] ?? '').slice(-1)}`);
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

/** Spelled-out names a user types for the symbols the Mac prints. */
const ALIASES: readonly (readonly [string, string])[] = [
  ['command', 'cmd command'],
  ['option', 'option opt alt'],
];

/** Lower-cased search text with the spoken names of Mac symbols widened ("command" also finds "cmd"). */
export const searchText = (text: string): string =>
  ALIASES.reduce((all, [name, aliases]) => all.replaceAll(name, aliases), text.toLowerCase());

/** Every word of a filter must appear: "cmd+s" or "shift p" narrow down, not just one phrase. */
export const filterWords = (filter: string): string[] =>
  filter
    .toLowerCase()
    .split(/[\s+]+/)
    .filter(Boolean);
