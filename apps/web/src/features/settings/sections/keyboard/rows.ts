import {
  contextLabel,
  contextPhrase,
  contextRank,
  type Command,
  type ContextLabel,
} from '@/app/command-registry';
import { effectiveKeys, fixedReason, type ShortcutOverrides } from '@/app/keymap';
import {
  formatShortcut,
  shortcutOn,
  spokenShortcut,
  type KeyboardPlatform,
  type Shortcut,
} from '@/app/keyboard';
import {
  bindingGroup,
  categoryOf,
  categoryRank,
  searchText,
  filterWords,
} from '@/app/shortcut-table';

/** One key of a command: what it answers to now, what it would be by default, and why it is not the default. */
export interface Slot {
  command: Command;
  /** The key on this platform, if any. */
  shortcut: Shortcut | undefined;
  /** The Guitar Pro default on this platform, if any. */
  fallback: Shortcut | undefined;
  /** The user set it (an override is stored). */
  changed: boolean;
  /** The command that took this slot's default key. */
  displacedBy: Command | undefined;
  /** Set when the user cannot change it: the reason, shown in place of the buttons. */
  fixed: string | undefined;
}

export interface Row {
  id: string;
  title: string;
  category: string;
  context: ContextLabel;
  slots: Slot[];
}

/**
 * The commands as the Keyboard section lists them: grouped by category, context and title in
 * registry order, one slot per command that this platform shows. A command whose default is the
 * other platform's (a Windows twin on a Mac) is hidden.
 */
export function buildRows(
  commands: readonly Command[],
  overrides: ShortcutOverrides,
  platform: KeyboardPlatform,
): Row[] {
  const { keys, displacedBy } = effectiveKeys(commands, overrides, platform);
  const byId = new Map(commands.map((command) => [command.id, command]));
  const rows = new Map<string, Row>();
  const sorted = commands
    .map((command, index) => ({ command, index, category: categoryOf(command.id) }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.index - b.index);
  for (const { command, category } of sorted) {
    if (command.shortcut?.only !== undefined && command.shortcut.only !== platform) continue;
    const context = contextLabel(command.context);
    const id = bindingGroup(command);
    const row = rows.get(id) ?? { id, title: command.title, category, context, slots: [] };
    rows.set(id, row);
    const owner = displacedBy.get(command.id);
    row.slots.push({
      command,
      shortcut: shortcutOn(keys.get(command.id), platform),
      fallback: shortcutOn(command.shortcut, platform),
      changed: overrides[command.id] !== undefined && fixedReason(command) === undefined,
      displacedBy: owner === undefined ? undefined : byId.get(owner),
      fixed: fixedReason(command),
    });
  }
  return [...rows.values()];
}

/** Rows whose title, category or keys (printed or spoken) hold every word of the filter. */
export function filterRows(rows: readonly Row[], filter: string, platform: KeyboardPlatform) {
  const words = filterWords(filter);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const keys = row.slots
      .flatMap(({ shortcut }) =>
        shortcut ? [formatShortcut(shortcut, platform), spokenShortcut(shortcut, platform)] : [],
      )
      .join(' ');
    const haystack = searchText(`${row.title} ${row.category} ${row.context} ${keys}`);
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The sentence a rebind adds when the key is also held in another context: each command that
 * shares the key, with the context it wins or loses in, named as the user knows it.
 */
export function shadowNote(keyText: string, command: Command, others: readonly Command[]): string {
  return others
    .map((other) =>
      contextRank(command.context) < contextRank(other.context)
        ? `${contextPhrase(command.context)}, ${keyText} runs ${command.title} instead of ${other.title}.`
        : `${contextPhrase(other.context)}, ${keyText} runs ${other.title} instead.`,
    )
    .join(' ');
}
