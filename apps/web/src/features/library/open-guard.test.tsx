import { setTrackProperties } from '@reprise/model';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { UnsavedChangesHost } from '@/app/unsaved-dialog';
import { createMemoryStorage } from '@/test/memory-storage';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { openLibraryDb } from './db/schema';
import { createLibrary, provideLibrary, settleLibraryWrites, type Library } from './library';
import { songBytes } from './test/songs';
import { uniqueDbName } from './test-support';

const libraries: Library[] = [];
afterEach(async () => {
  for (const library of libraries.splice(0)) await library.dispose();
});

async function setup() {
  const services = createTestServices({
    platform: fakePlatform({ ...createMemoryStorage().calls }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
  libraries.push(library);
  provideLibrary(services, library);
  renderWithServices(<UnsavedChangesHost />, services);
  await library.openAndImport({ name: 'a.reprise', bytes: await songBytes('A') });
  await library.openAndImport({ name: 'b.reprise', bytes: await songBytes('B') });
  await settleLibraryWrites();
  const [a] = (await library.repo.all()).filter((row) => row.title === 'A');
  const edit = () => {
    act(() => {
      const { document } = services;
      document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: document.getState().score?.tracks[0]?.id ?? '' },
            { name: 'Edited' },
          ),
        );
    });
  };
  return { services, library, edit, target: a?.id ?? '', user: userEvent.setup() };
}

describe('opening a song from the library', () => {
  it('asks first when the document is modified; Cancel resolves and keeps the document', async () => {
    const { services, library, edit, target, user } = await setup();
    edit();
    const before = services.document.getState().id;
    const asked = library.requestOpenSong(target);
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toHaveTextContent(
      'before opening another song?',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await asked;
    expect(services.document.getState().id).toBe(before);
    expect(services.document.getState().dirty).toBe(true);
  });

  it('opens the song after Don’t save', async () => {
    const { services, library, edit, target, user } = await setup();
    edit();
    const asked = library.requestOpenSong(target);
    await user.click(await screen.findByRole('button', { name: 'Don’t save' }));
    await asked;
    expect(services.document.getState().songId).toBe(target);
    expect(services.document.getState().dirty).toBe(false);
  });

  it('opens at once when nothing is modified', async () => {
    const { services, library, target } = await setup();
    await library.requestOpenSong(target);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.document.getState().songId).toBe(target);
  });
});
