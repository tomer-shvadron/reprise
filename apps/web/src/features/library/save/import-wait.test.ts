import { setTrackProperties } from '@reprise/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage } from '@/test/memory-storage';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices, fakePlatform } from '@/test/services';

import { openLibraryDb } from '../db/schema';
import { createLibrary, IMPORT_WAIT_MS, settleLibraryWrites, type Library } from '../library';
import type { Parser } from '../import/parser';
import { songBytes } from '../test/songs';
import { uniqueDbName } from '../test-support';

const libraries: Library[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const free of release.splice(0)) free();
  await settleLibraryWrites();
  for (const library of libraries.splice(0)) library.db.close();
});

// A parser whose native write does not answer until the test ends, as a wedged worker would; the
// shared teardown awaits every import, so it is let go then.
const release: (() => void)[] = [];
const wedged = (): Parser => ({
  parse: () => new Promise(() => undefined),
  native: () =>
    new Promise((resolve) => {
      release.push(() => {
        resolve({ ok: false, code: 'wedged', message: 'the worker never answered' });
      });
    }),
  dispose: () => undefined,
});

describe('Save while the file just opened is still being imported', () => {
  it('goes to Save As, with a notice, once the wait runs out, and Save As is not held up', async () => {
    const saveFile = vi.fn<() => Promise<string | undefined>>(() =>
      Promise.resolve('/m/Copy.reprise'),
    );
    const services = createTestServices({
      platform: fakePlatform({ ...createMemoryStorage().calls, saveFile }),
    });
    mirrorAudio(services);
    const library = createLibrary(services, {
      db: openLibraryDb(uniqueDbName()),
      createParser: wedged,
    });
    libraries.push(library);
    services.document.getState().setSaver(library.saver);

    void library.openAndImport({ name: 'a.reprise', bytes: await songBytes('A') });
    await vi.waitFor(() => {
      expect(services.document.getState().songId).toBeDefined();
    });
    const { document } = services;
    document
      .getState()
      .apply(
        setTrackProperties(
          { trackId: document.getState().score?.tracks[0]?.id ?? '' },
          { name: 'Edited' },
        ),
      );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const saving = document.getState().save();
    await vi.advanceTimersByTimeAsync(IMPORT_WAIT_MS + 10);
    await saving;
    expect(saveFile).toHaveBeenCalledOnce();
    expect(document.getState().dirty).toBe(false);
    expect(document.getState().file?.handle).toBe('/m/Copy.reprise');
  });
});
