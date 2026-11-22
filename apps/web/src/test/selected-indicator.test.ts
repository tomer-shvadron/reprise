/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// #472: the three selected states that were only a faint fill draw a solid `--primary` bar on their
// leading edge (3:1, pinned in theme-contrast.test.ts). The palette's row is its keyboard focus.
const BAR = 'shadow-[inset_3px_0_0_var(--color-primary)]';

const SITES: [string, string, string][] = [
  ['the palette selected row', 'components/ui/command.tsx', `data-selected:${BAR}`],
  ['History current row', 'features/editor/history-panel.tsx', BAR],
  ['the active rail button', 'app/right-panel/right-panel.tsx', BAR],
];

describe('selected indicator', () => {
  it.each(SITES)('%s draws the bar', (_name, file, expected) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8');
    expect(source).toContain(expected);
  });

  it('keeps the active rail button selected under the pointer', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../app/right-panel/right-panel.tsx'),
      'utf8',
    );
    expect(source).toContain('hover:bg-accent dark:hover:bg-accent');
  });
});
