import { act, screen, waitFor } from '@testing-library/react';
import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { renderWithServices } from '@/test/render';

import { libraryOf } from '@/features/library';

import { DropZone } from './drop-zone';

function dragEvent(
  type: string,
  files: File[],
  types: string[] = ['Files'],
  handle?: () => Promise<unknown>,
  modifiers: { altKey?: boolean; entry?: (file: File) => unknown } = {},
) {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    altKey: modifiers.altKey === true,
  });
  const items = files.map((file) => ({
    kind: 'file',
    getAsFileSystemHandle: handle,
    getAsFile: () => file,
    webkitGetAsEntry: () => modifiers.entry?.(file) ?? null,
  }));
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, items } });
  return event;
}

async function riff(title = 'Riff'): Promise<File> {
  const { bytes } = await write(score().title(title).build(), 'reprise');
  return new File([bytes.slice()], `${title.toLowerCase()}.reprise`);
}

/**
 * A single drop imports into the library in the background after the file opens. The shared
 * teardown settles such writes anyway; this is the explicit check that the import finished, so a
 * test that drops one file does not end before its row exists.
 */
async function importLanded(services: ReturnType<typeof renderWithServices>['services']) {
  await waitFor(() => {
    expect(libraryOf(services).store.getState().entries).toHaveLength(1);
  });
  expect(services.document.getState().dirty).toBe(false);
}

describe('DropZone', () => {
  it('cancels the drop but opens and imports nothing while the Sounds screen shows', async () => {
    const { services } = renderWithServices(<DropZone />);
    services.ui.getState().setScreen('sounds');
    const file = await riff();

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [file]));
    });
    expect(screen.queryByText('Drop to open')).not.toBeInTheDocument();
    const over = dragEvent('dragover', [file]);
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = dragEvent('drop', [file]);
    act(() => {
      window.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(services.document.getState().score).toBeUndefined();
    expect(libraryOf(services).store.getState().entries).toHaveLength(0);
    expect(services.ui.getState().screen).toBe('sounds');
  });

  it('shows the overlay while files are dragged over, and opens the dropped file', async () => {
    const { services } = renderWithServices(<DropZone />);
    const file = await riff();

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [file]));
    });
    expect(screen.getByText('Drop to open')).toBeInTheDocument();
    const over = dragEvent('dragover', [file]);
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dragEvent('drop', [file]);
    act(() => {
      window.dispatchEvent(drop);
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByText('Drop to open')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(services.document.getState().score?.meta.title).toBe('Riff');
    });
    expect(services.document.getState().file?.name).toBe('riff.reprise');
    await importLanded(services);
  });

  it('ignores a drop while a dialog is open', async () => {
    const { services } = renderWithServices(
      <>
        <DropZone />
        <div role="dialog" data-state="open" />
      </>,
    );
    const file = await riff();
    const drop = dragEvent('drop', [file]);
    act(() => {
      window.dispatchEvent(drop);
    });
    // Nothing replaced the document behind the dialog, and no question opened over it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(services.document.getState().score).toBeUndefined();
  });

  it('imports a single dropped file into the library after opening it', async () => {
    const { services } = renderWithServices(<DropZone />);
    const file = await riff();
    act(() => {
      window.dispatchEvent(dragEvent('drop', [file]));
    });
    await waitFor(() => {
      expect(services.document.getState().songId).toBeDefined();
    });
    await importLanded(services);
  });

  it('opens without importing while Alt is held', async () => {
    const { services } = renderWithServices(<DropZone />);
    const file = await riff();
    act(() => {
      window.dispatchEvent(dragEvent('drop', [file], ['Files'], undefined, { altKey: true }));
    });
    await waitFor(() => {
      expect(services.document.getState().score?.meta.title).toBe('Riff');
    });
    expect(services.document.getState().songId).toBeUndefined();
    expect(await libraryOf(services).repo.all()).toEqual([]);
  });

  it('imports several dropped files as a batch on the library screen', async () => {
    const { services } = renderWithServices(<DropZone />);
    const one = await riff('One');
    const two = await riff('Two');
    act(() => {
      window.dispatchEvent(dragEvent('drop', [one, two]));
    });
    expect(services.ui.getState().screen).toBe('library');
    const library = libraryOf(services);
    await waitFor(() => {
      expect(library.importer.store.getState()).toMatchObject({ phase: 'done', imported: 2 });
    });
    expect(services.document.getState().score).toBeUndefined();
  });

  it('imports a single dropped file as a batch while the library screen is up', async () => {
    const { services } = renderWithServices(<DropZone />);
    services.ui.getState().setScreen('library');
    const file = await riff();
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [file]));
    });
    expect(screen.getByText('Drop to import')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(dragEvent('drop', [file]));
    });
    const library = libraryOf(services);
    await waitFor(() => {
      expect(library.importer.store.getState()).toMatchObject({ phase: 'done', imported: 1 });
    });
    expect(services.document.getState().score).toBeUndefined();
  });

  it('walks a dropped folder and imports what it holds', async () => {
    const { services } = renderWithServices(<DropZone />);
    const inside = await riff('Inside');
    let served = false;
    const folder = {
      isDirectory: true,
      isFile: false,
      name: 'tabs',
      createReader: () => ({
        readEntries: (done: (entries: unknown[]) => void) => {
          const entries = served
            ? []
            : [
                {
                  isDirectory: false,
                  isFile: true,
                  name: inside.name,
                  file: (ok: (file: File) => void) => {
                    ok(inside);
                  },
                },
              ];
          served = true;
          done(entries);
        },
      }),
    };
    act(() => {
      window.dispatchEvent(
        dragEvent('drop', [new File([], 'tabs')], ['Files'], undefined, { entry: () => folder }),
      );
    });
    const library = libraryOf(services);
    await waitFor(() => {
      expect(library.importer.store.getState()).toMatchObject({ phase: 'done', imported: 1 });
    });
    expect(library.store.getState().entries[0]?.row.originalName).toBe('inside.reprise');
  });

  it('keeps the dropped file handle so Save can write back to it', async () => {
    const { services } = renderWithServices(<DropZone />);
    const handle = { kind: 'file', name: 'riff.reprise' };
    const getHandle = vi.fn(() => Promise.resolve(handle));
    const file = await riff();

    act(() => {
      window.dispatchEvent(dragEvent('drop', [file], ['Files'], getHandle));
    });

    expect(getHandle).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(services.document.getState().file?.handle).toBe(handle);
    });
    await importLanded(services);
  });

  it('ignores drags that carry no files', () => {
    renderWithServices(<DropZone />);

    const over = dragEvent('dragover', [], ['text/plain']);
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [], ['text/plain']));
      window.dispatchEvent(over);
    });

    expect(over.defaultPrevented).toBe(false);
    expect(screen.queryByText('Drop to open')).not.toBeInTheDocument();
  });

  it('refuses a file over the size limit before reading it', () => {
    const { services } = renderWithServices(<DropZone />);
    const huge = new File(['x'], 'huge.gp5');
    Object.defineProperty(huge, 'size', { value: 300_000_000 });

    act(() => {
      window.dispatchEvent(dragEvent('drop', [huge]));
    });

    expect(services.document.getState().error).toMatchObject({
      action: 'open',
      fileName: 'huge.gp5',
      code: 'too-large',
      message: 'The file is 287 MB; the limit is 256 MB',
    });
  });
});
