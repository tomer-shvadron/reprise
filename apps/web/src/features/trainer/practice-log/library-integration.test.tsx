import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryScreen } from '@/features/library';
import { createLibrary, provideLibrary, type Library } from '@/features/library/library';
import { openLibraryDb } from '@/features/library/db/schema';
import { rowOf as songRowOf, uniqueDbName } from '@/features/library/test-support';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { installPracticeLog } from './install';
import { rowOf } from './test-support';

const libraries: Library[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const library of libraries.splice(0)) await library.dispose();
});

describe('the practice log in the library screen', () => {
  it('opens a song’s page from its row, and Escape returns to the list', async () => {
    const services = createTestServices();
    const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
    libraries.push(library);
    provideLibrary(services, library);
    const song = songRowOf({ title: 'Alpha' });
    await library.repo.add(song);
    await library.db.practiceSessions.add(rowOf({ songId: song.id, playedMs: 5 * 60_000 }));
    cleanups.push(installPracticeLog(services, library.db.practiceSessions));

    renderWithServices(<LibraryScreen />, services);
    await userEvent.click(await screen.findByRole('button', { name: 'Practice log for Alpha' }));
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeTruthy();
    expect((await screen.findAllByText('5 min')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('listbox', { name: 'Songs' })).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('listbox', { name: 'Songs' })).toBeTruthy();
  });
});
