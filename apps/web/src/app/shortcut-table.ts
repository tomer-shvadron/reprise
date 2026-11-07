import type { Command } from './command-registry';
import { formatShortcut, shortcutOn, type KeyboardPlatform } from './keyboard';

const CATEGORIES: Record<string, string> = {
  app: 'App',
  file: 'File',
  edit: 'Edit',
  view: 'View',
  transport: 'Transport',
  track: 'Track',
};

const categoryOf = (id: string) => CATEGORIES[id.split('.')[0] ?? ''] ?? 'Other';
const cell = (text: string) => text.replaceAll('|', '\\|');

/** The keyboard-shortcuts reference table, from the registry's commands; one row per title. */
export function shortcutTable(commands: readonly Command[]): string {
  const order = Object.values(CATEGORIES);
  const rows = new Map<
    string,
    { title: string; category: string; mac: string[]; other: string[] }
  >();
  const sorted = commands
    .map((command, index) => ({ command, index, category: categoryOf(command.id) }))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.index - b.index);
  for (const { command, category } of sorted) {
    const key = `${category}\n${command.title}`;
    const row = rows.get(key) ?? { title: command.title, category, mac: [], other: [] };
    rows.set(key, row);
    const add = (keys: string[], platform: KeyboardPlatform) => {
      const shortcut = shortcutOn(command.shortcut, platform);
      if (shortcut) keys.push(formatShortcut(shortcut, platform));
    };
    add(row.mac, 'mac');
    add(row.other, 'other');
  }
  const keys = (list: string[]) => cell(list.length > 0 ? list.join(' or ') : '—');
  const lines = [...rows.values()].map(
    ({ title, category, mac, other }) =>
      `| ${cell(title)} | ${category} | Global | ${keys(mac)} | ${keys(other)} |`,
  );
  return [
    '| Command | Category | Context | macOS | Windows |',
    '| ------- | -------- | ------- | ----- | ------- |',
    ...lines,
  ].join('\n');
}
