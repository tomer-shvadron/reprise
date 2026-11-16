import { write } from '@reprise/formats';
import { insertBar } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { editCommands } from './edit-commands';

describe('the Undo and Redo palette titles', () => {
  it('name the step they would replay, and are plain with nothing to replay', async () => {
    const services = createTestServices();
    const commands = editCommands(services);
    const title = (id: string) => commands.find((command) => command.id === id)?.title;
    expect(title('edit.undo')).toBe('Undo');
    expect(title('edit.redo')).toBe('Redo');
    const built = score().track('guitar');
    built.bar();
    await services.document
      .getState()
      .openBytes('t.reprise', (await write(built.build(), 'reprise')).bytes);
    services.document.getState().apply(insertBar({ index: 1 }));
    expect(title('edit.undo')).toBe('Undo Insert bar');
    expect(title('edit.redo')).toBe('Redo');
    services.document.getState().undo();
    expect(title('edit.undo')).toBe('Undo');
    expect(title('edit.redo')).toBe('Redo Insert bar');
    expect(title('edit.redoAlternate')).toBe('Redo Insert bar');
  });
});
