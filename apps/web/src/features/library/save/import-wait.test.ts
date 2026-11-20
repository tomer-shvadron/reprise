import { setTrackProperties } from '@reprise/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  letGo();
  await settleLibraryWrites();
  for (const library of libraries.splice(0)) library.db.close();
});

// A parser whose native write does not answer until the test ends, as a wedged worker would; the
// shared teardown awaits every import, so it is let go then. The import reaches `native` some time
// after the test body, so a call after the release answers at once, or the teardown would wait
// on a write nobody lets go.
let released = false;
const waiting: (() => void)[] = [];
const letGo = () => {
  released = true;
  for (const resolve of waiting.splice(0)) resolve();
};
const wedged = (): Parser => ({
  parse: () => new Promise(() => undefined),
  native: () =>
    new Promise((resolve) => {
      const answer = () => {
        resolve({ ok: false, code: 'wedged', message: 'the worker never answered' });
      };
      if (released) answer();
      else waiting.push(answer);
    }),
  dispose: () => undefined,
});

beforeEach(() => {
  released = false;
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
    // The import is wedged in its native write: the first paint and the duplicate lookup are
    // behind it, so the only timer left to fake is the wait's own.
    await vi.waitFor(() => {
      expect(waiting).toHaveLength(1);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const saving = document.getState().save();
    // Save reads the song's row (real IndexedDB) before it starts the wait; advancing before the
    // wait's timer exists would leave it to run on real time, past the test's timeout.
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(IMPORT_WAIT_MS + 10);
    await saving;
    expect(saveFile).toHaveBeenCalledOnce();
    expect(document.getState().dirty).toBe(false);
    expect(document.getState().file?.handle).toBe('/m/Copy.reprise');
  });
});
