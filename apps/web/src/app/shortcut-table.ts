import type { Command } from './command-registry';
import { formatShortcut } from './keyboard';

const CATEGORIES: Record<string, string> = {
  app: 'App',
  file: 'File',
  view: 'View',
  transport: 'Transport',
};

const categoryOf = (id: string) => CATEGORIES[id.split('.')[0] ?? ''] ?? 'Other';
const cell = (text: string) => text.replaceAll('|', '\\|');

/** The keyboard-shortcuts reference table, from the registry's commands. */
export function shortcutTable(commands: readonly Command[]): string {
  const order = Object.values(CATEGORIES);
  const rows = commands
    .map((command, index) => ({ command, index, category: categoryOf(command.id) }))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.index - b.index)
    .map(({ command, category }) => {
      const { shortcut } = command;
      const mac = shortcut ? formatShortcut(shortcut, 'mac') : '—';
      const other = shortcut ? formatShortcut(shortcut, 'other') : '—';
      return `| ${cell(command.title)} | ${category} | Global | ${cell(mac)} | ${cell(other)} |`;
    });
  return [
    '| Command | Category | Context | macOS | Windows |',
    '| ------- | -------- | ------- | ----- | ------- |',
    ...rows,
  ].join('\n');
}
