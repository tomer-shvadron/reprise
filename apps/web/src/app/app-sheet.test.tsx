import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { openLibraryDb } from '@/features/library/db/schema';
import { createLibrary, provideLibrary, type Library } from '@/features/library/library';
import { rowOf, uniqueDbName } from '@/features/library/test-support';
import { songBytes } from '@/features/library/test/songs';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices, fakePlatform } from '@/test/services';
import { packContents, zipOf } from '@/features/sounds/test/pack-fixtures';
import type { PickedFile } from '@/platform/platform';

import { App } from './app';

const files = new Map<string, Uint8Array>();
const libraries: Library[] = [];

afterEach(async () => {
  files.clear();
  for (const library of libraries.splice(0)) await library.dispose();
});

function setup() {
  const services = createTestServices({
    platform: fakePlatform({
      readFile: (path) => {
        const bytes = files.get(path);
        return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('ENOENT'));
      },
    }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
  libraries.push(library);
  provideLibrary(services, library);
  render(<App services={services} keyboard="mac" />);
  return { services, library, user: userEvent.setup() };
}

async function addSong(library: Library, title: string) {
  const row = rowOf({ title });
  files.set(row.nativePath, await songBytes(title));
  await library.repo.add(row);
  return row;
}

const sheet = (name: string) => screen.getByRole('dialog', { name });
const closed = (name: string) => {
  expect(screen.queryByRole('dialog', { name })).toBeNull();
};

describe('the Library sheet', () => {
  it('closes the practice page on the first Escape and the sheet on the second', async () => {
    const { services, library, user } = setup();
    await addSong(library, 'Alpha');
    act(() => {
      services.ui.getState().showSheet('library');
    });
    await user.click(await screen.findByRole('button', { name: 'Practice log for Alpha' }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(sheet('Library')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    closed('Library');
  });

  it('closes only the delete confirm on Escape', async () => {
    const { services, library, user } = setup();
    await addSong(library, 'Alpha');
    act(() => {
      services.ui.getState().showSheet('library');
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    expect(await screen.findByRole('dialog', { name: /^Delete/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /^Delete/ })).toBeNull();
    expect(sheet('Library')).toBeInTheDocument();
  });

  it('closes on a click outside it', async () => {
    const { services, user } = setup();
    act(() => {
      services.ui.getState().showSheet('library');
    });
    expect(sheet('Library')).toBeInTheDocument();
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    if (!overlay) throw new Error('no overlay');
    await user.click(overlay);
    closed('Library');
  });

  it('keeps an import running when the sheet closes, and shows its summary on reopening', async () => {
    const { services, library, user } = setup();
    act(() => {
      services.ui.getState().showSheet('library');
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bytes = await songBytes('Held');
    const batch = library.importSources([
      {
        name: 'held.reprise',
        size: bytes.byteLength,
        read: async () => {
          await gate;
          return bytes.slice();
        },
      },
    ]);
    await user.keyboard('{Escape}');
    closed('Library');
    expect(library.importer.store.getState().phase).toBe('running');
    expect(screen.getByRole('button', { name: /Importing 0 of 1/ })).toBeInTheDocument();
    release();
    await act(() => batch);
    act(() => {
      services.ui.getState().showSheet('library');
    });
    expect(await screen.findByText(/Imported 1/)).toBeInTheDocument();
    expect(sheet('Library')).not.toHaveTextContent(/cancelled/i);
  });

  it('opens a song from the list without handing focus back to the opener', async () => {
    const { services, library, user } = setup();
    const row = await addSong(library, 'Alpha');
    const crumb = within(screen.getByRole('banner')).getByRole('button', { name: 'Library' });
    crumb.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('option', { name: /Alpha/ });
    screen.getByRole('listbox').focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(services.document.getState().songId).toBe(row.id);
    });
    closed('Library');
    expect(crumb).not.toHaveFocus();
  });

  it('asks about unsaved changes over the sheet, and keeps the sheet on Cancel', async () => {
    const { services, library, user } = setup();
    await addSong(library, 'Alpha');
    const { bytes } = await write(score().title('Open').build(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('open.reprise', bytes);
    });
    act(() => {
      services.document.setState({ dirty: true });
      services.ui.getState().showSheet('library');
    });
    await screen.findByRole('option', { name: /Alpha/ });
    screen.getByRole('listbox').focus();
    await user.keyboard('{Enter}');
    const prompt = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    expect(sheet('Library')).toBeInTheDocument();
    screen.getByRole('listbox').focus();
    await user.keyboard('{Enter}');
    const again = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    await user.click(within(again).getByRole('button', { name: 'Don’t save' }));
    await waitFor(() => {
      closed('Library');
    });
    expect(services.document.getState().songId).not.toBeUndefined();
  });
});

describe('the Sounds sheet', () => {
  it('cancels a rename on Escape and closes the sheet on the next one', async () => {
    const { services, user } = setup();
    const bytes = await zipOf(packContents(), 'Pack/');
    const zip: PickedFile = {
      name: 'My bass.zip',
      relativePath: 'My bass.zip',
      size: bytes.length,
      read: (range) =>
        Promise.resolve(range ? bytes.slice(range.offset, range.offset + range.length) : bytes),
    };
    const installed = await services.sounds.installZip(zip);
    expect(installed).toBe(true);
    act(() => {
      services.ui.getState().showSheet('sounds');
    });
    await user.click(await screen.findByRole('button', { name: 'Rename My bass' }));
    expect(screen.getByRole('textbox', { name: 'Name of My bass' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Name of My bass' })).toBeNull();
    expect(sheet('Sounds')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    closed('Sounds');
  });

  it('keeps an install going when the sheet closes, says so in the status bar, and shows it again', async () => {
    const { services, user } = setup();
    act(() => {
      services.ui.getState().showSheet('sounds');
      services.sounds.api.setState({
        job: { packId: 'p', name: 'Big Piano', phase: 'downloading', done: 1, total: 4 },
      });
    });
    expect(within(sheet('Sounds')).getAllByText(/Big Piano/)[0]).toBeInTheDocument();
    await user.keyboard('{Escape}');
    closed('Sounds');
    expect(services.sounds.api.getState().job).toBeDefined();
    const segment = document.querySelector('[data-sound-status]');
    expect(segment).toHaveTextContent('Installing Big Piano · downloading 25%');
    await user.click(screen.getByRole('button', { name: /Installing Big Piano/ }));
    expect(within(sheet('Sounds')).getAllByText(/Big Piano/)[0]).toBeInTheDocument();
  });
});
