import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

import { buildRows, filterRows } from './rows';

const registry = createAppRegistry(createTestServices(), 'mac');
const rows = buildRows(registry.list(), {}, 'mac');

describe('buildRows', () => {
  it('groups the commands of one title into one row with a slot each', () => {
    const insert = rows.find((row) => row.title === 'Insert bar before');
    expect(insert?.slots.length).toBeGreaterThan(1);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('hides the twins of the other platform', () => {
    const ids = rows.flatMap((row) => row.slots.map((slot) => slot.command.id));
    expect(ids).toContain('editor.insertBarBeforeMac');
    expect(ids).not.toContain('editor.insertBarBeforeWindows');
  });

  it('marks fixed commands and lists commands without a key', () => {
    const slots = rows.flatMap((row) => row.slots);
    expect(slots.find((slot) => slot.command.id === 'editor.copy')?.fixed).toBe(
      'Set by the system',
    );
    expect(slots.find((slot) => slot.command.id === 'editor.fret3')?.fixed).toBeDefined();
    expect(slots.some((slot) => slot.shortcut === undefined && slot.fixed === undefined)).toBe(
      true,
    );
  });

  it('marks a changed slot and the one it displaced', () => {
    const changed = buildRows(
      registry.list(),
      { 'view.toggleViewMode': { key: 'F8' } },
      'mac',
    ).flatMap((row) => row.slots);
    expect(changed.find((s) => s.command.id === 'view.toggleViewMode')).toMatchObject({
      changed: true,
      shortcut: { key: 'F8' },
    });
    expect(changed.find((s) => s.command.id === 'view.togglePanel')).toMatchObject({
      displacedBy: { id: 'view.toggleViewMode' },
      shortcut: undefined,
    });
  });
});

describe('filterRows', () => {
  it('matches the title, the printed key and the spoken name', () => {
    expect(filterRows(rows, 'mixer', 'mac').map((r) => r.title)).toContain('Toggle mixer');
    expect(filterRows(rows, 'F8', 'mac').map((r) => r.title)).toContain('Toggle mixer');
    expect(filterRows(rows, 'cmd s', 'mac').map((r) => r.title)).toContain('Save');
    expect(filterRows(rows, 'zzzz', 'mac')).toEqual([]);
  });
});
