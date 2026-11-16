import { write } from '@reprise/formats';
import { fullScore, score } from '@reprise/model/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { createMemoryStorage } from '@/test/memory-storage';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { createLibrary, provideLibrary, type Library } from '../library';
import { openLibraryDb } from '../db/schema';
import { uniqueDbName } from '../test-support';
import { ExportDialog } from './export-dialog';

const libraries: Library[] = [];
afterEach(async () => {
  for (const library of libraries.splice(0)) await library.dispose();
});

function setup() {
  const storage = createMemoryStorage();
  const saveFile = vi.fn<() => Promise<string | undefined>>(() => Promise.resolve('/m/out.gp'));
  const services = createTestServices({
    platform: fakePlatform({ ...storage.calls, saveFile }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
  libraries.push(library);
  provideLibrary(services, library);
  renderWithServices(<ExportDialog />, services);
  const inLibrary = async () => {
    const { bytes } = await write(fullScore(), 'reprise');
    await library.openAndImport({ name: 'full.reprise', bytes });
    await waitFor(async () => {
      expect(await library.repo.all()).toHaveLength(1);
    });
  };
  const run = () => library.exportGuitarPro();
  return { services, library, saveFile, inLibrary, run, user: userEvent.setup() };
}

const lossCount = () =>
  within(screen.getByRole('list', { name: 'What will be lost' })).getAllByRole('listitem').length;

describe('Export as Guitar Pro', () => {
  it('lists what the writer drops, writes after Export, and never moves the document', async () => {
    const { services, library, saveFile, inLibrary, run, user } = setup();
    await inLibrary();
    const before = services.document.getState();
    const { dropped } = await write(before.score ?? fullScore(), 'gp');
    expect(dropped.length).toBeGreaterThan(0);
    let done = Promise.resolve();
    act(() => {
      done = run();
    });
    const dialog = await screen.findByRole('dialog', { name: /^Export .*\.gp\?$/ });
    expect(lossCount()).toBe(dropped.length);
    expect(saveFile).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await done;
    expect(saveFile).toHaveBeenCalledOnce();
    const after = services.document.getState();
    expect([after.dirty, after.file, after.songId]).toEqual([
      before.dirty,
      before.file,
      before.songId,
    ]);
    expect((await library.repo.all())[0]?.exportAcknowledged).toBeUndefined();
  });

  it('Cancel writes nothing', async () => {
    const { saveFile, inLibrary, run, user } = setup();
    await inLibrary();
    let done = Promise.resolve();
    act(() => {
      done = run();
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await done;
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('remembers the accepted codes on the row, so the same loss does not ask again', async () => {
    const { library, saveFile, inLibrary, run, user } = setup();
    await inLibrary();
    let done = Promise.resolve();
    act(() => {
      done = run();
    });
    await user.click(
      await screen.findByRole('checkbox', { name: 'Don’t warn again for this song' }),
    );
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await done;
    const [row] = await library.repo.all();
    expect(row?.exportAcknowledged?.length).toBeGreaterThan(0);
    await act(async () => {
      await run();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saveFile).toHaveBeenCalledTimes(2);
  });

  it('asks again when a kind of loss is new', async () => {
    const { library, saveFile, inLibrary, run, user } = setup();
    await inLibrary();
    const [row] = await library.repo.all();
    const codes = [
      ...new Set((await write(fullScore(), 'gp')).dropped.map((warning) => warning.code)),
    ];
    // One kind of loss short of what this score drops.
    await library.repo.update(row?.id ?? '', { exportAcknowledged: codes.slice(1) });
    let done = Promise.resolve();
    act(() => {
      done = run();
    });
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await done;
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('has no checkbox for a document outside the library', async () => {
    const { services, saveFile, run, user } = setup();
    act(() => {
      services.document.getState().newDocument(fullScore());
    });
    let done = Promise.resolve();
    act(() => {
      done = run();
    });
    await screen.findByRole('dialog');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await done;
    expect(saveFile).toHaveBeenCalledOnce();
  });

  it('writes straight away when nothing is dropped', async () => {
    const { services, saveFile, run } = setup();
    act(() => {
      services.document.getState().newDocument(score().title('Plain').track('guitar').build());
    });
    await act(async () => {
      await run();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saveFile).toHaveBeenCalledWith('Plain.gp', expect.anything(), expect.anything());
  });

  it('shows a notice when the write fails', async () => {
    const { services, library, saveFile, run } = setup();
    saveFile.mockRejectedValueOnce(new Error('denied'));
    act(() => {
      services.document.getState().newDocument(score().title('Plain').track('guitar').build());
    });
    await act(async () => {
      await run();
    });
    expect(library.store.getState().notice).toEqual({
      kind: 'error',
      message: 'Could not export Plain.gp: denied',
    });
  });
});
