import { write } from '@reprise/formats';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { runCommand } from './command-registry';

describe('view.toggleViewMode', () => {
  it('flips between page and continuous view, and the layout follows', async () => {
    const services = createTestServices();
    const { ui, layout, document } = services;
    const command = createAppRegistry(services).get('view.toggleViewMode');
    if (!command) throw new Error('view.toggleViewMode is not registered');
    expect(command.shortcut).toEqual({ key: 'F4' });
    await document
      .getState()
      .openBytes('song.reprise', (await write(largeScore(1, 16), 'reprise')).bytes);
    // Continuous view lays every system out on one line; pages stack them.
    const rows = () => new Set(layout.getState().result?.systems.map(({ bbox }) => bbox.y)).size;
    expect(rows()).toBeGreaterThan(1);

    runCommand(command);
    expect(ui.getState().view.mode).toBe('continuous');
    expect(rows()).toBe(1);

    runCommand(command);
    expect(ui.getState().view.mode).toBe('paged');
    expect(rows()).toBeGreaterThan(1);
  });
});
