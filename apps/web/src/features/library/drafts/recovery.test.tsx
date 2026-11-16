import { write } from '@reprise/formats';
import { newId, setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { UnsavedChangesHost } from '@/app/unsaved-dialog';
import { createMemoryStorage } from '@/test/memory-storage';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { openLibraryDb } from '../db/schema';
import { createLibrary, provideLibrary, settleLibraryWrites, type Library } from '../library';
import { songBytes } from '../test/songs';
import { uniqueDbName } from '../test-support';
import { DraftRecoveryDialog } from './draft-recovery-dialog';
import { draftNativePath, draftSidecarPath, type DraftSidecar } from './draft-paths';
import { findDraftOffers } from './recovery';

const libraries: Library[] = [];
afterEach(async () => {
  for (const library of libraries.splice(0)) await library.dispose();
});

const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

async function setup() {
  const storage = createMemoryStorage();
  const services = createTestServices({ platform: fakePlatform({ ...storage.calls }) });
  mirrorAudio(services);
  const library = createLibrary(services, {
    db: openLibraryDb(uniqueDbName()),
    now: () => 1000,
  });
  libraries.push(library);
  provideLibrary(services, library);
  await library.openAndImport({ name: 'a.reprise', bytes: await songBytes('A') });
  await settleLibraryWrites();
  const [row] = await library.repo.all();
  if (!row) throw new Error('no row');
  services.document.getState().close();
  await library.load();
  const draftOf = async (
    key: string,
    sidecar: Partial<DraftSidecar>,
    title = 'Edited',
    bytes?: Uint8Array,
  ) => {
    const built = score().title(title).track('guitar').build();
    await services.platform.writeFile(
      draftNativePath(key),
      bytes ?? (await write(built, 'reprise')).bytes,
    );
    await services.platform.writeFile(
      draftSidecarPath(key),
      enc({ version: 1, key, name: title, title, updatedAt: 5000, ...sidecar }),
    );
  };
  return { storage, services, library, row, draftOf };
}

describe('finding drafts to offer', () => {
  it('offers a draft newer than its song’s import, and removes one that is not', async () => {
    const { storage, services, library, row, draftOf } = await setup();
    await draftOf(row.id, { songId: row.id, updatedAt: row.importedAt + 1 });
    expect(await findDraftOffers(services.platform, library.repo)).toHaveLength(1);
    // Saved after the draft was written.
    await library.repo.update(row.id, { savedAt: row.importedAt + 10 });
    expect(await findDraftOffers(services.platform, library.repo)).toEqual([]);
    expect(storage.paths().filter((path) => path.includes('drafts/'))).toEqual([]);
  });

  it('removes a draft whose song is gone, and offers a never-saved document’s', async () => {
    const { storage, services, library, draftOf } = await setup();
    const gone = newId();
    await draftOf(gone, { songId: gone });
    await draftOf('doc-abc', {});
    const offers = await findDraftOffers(services.platform, library.repo);
    expect(offers.map((offer) => offer.key)).toEqual(['doc-abc']);
    expect(storage.bytes(draftNativePath(gone))).toBeUndefined();
  });

  it('removes unpaired files and a sidecar that does not parse', async () => {
    const { storage, services, library } = await setup();
    await services.platform.writeFile(draftNativePath('doc-lonely'), new Uint8Array([1]));
    await services.platform.writeFile(draftSidecarPath('doc-bad'), enc({ nope: true }));
    await services.platform.writeFile(draftNativePath('doc-bad'), new Uint8Array([1]));
    expect(await findDraftOffers(services.platform, library.repo)).toEqual([]);
    expect(storage.paths().filter((path) => path.includes('drafts/'))).toEqual([]);
  });

  it('lists the newest first', async () => {
    const { services, library, draftOf } = await setup();
    await draftOf('doc-old', { updatedAt: 10 });
    await draftOf('doc-new', { updatedAt: 20 });
    const offers = await findDraftOffers(services.platform, library.repo);
    expect(offers.map((offer) => offer.key)).toEqual(['doc-new', 'doc-old']);
  });
});

describe('recovering a draft', () => {
  it('opens a library song’s draft as modified, then keeps it under the same key', async () => {
    const { services, library, row, draftOf } = await setup();
    const edited = score().title('A').track('guitar', { name: 'Recovered' }).build();
    await draftOf(
      row.id,
      { songId: row.id, updatedAt: 5000 },
      'A',
      (await write(edited, 'reprise')).bytes,
    );
    const keeper = library.drafts.start();
    await library.drafts.recovery.scan();
    expect(library.drafts.recovery.store.getState().offers).toHaveLength(1);
    await library.drafts.recovery.recover(row.id);
    const state = services.document.getState();
    expect(state.songId).toBe(row.id);
    expect(state.dirty).toBe(true);
    expect(state.score?.tracks[0]?.name).toBe('Recovered');
    expect(library.drafts.recovery.store.getState().offers).toEqual([]);
    expect(await services.platform.readFile(draftNativePath(row.id))).toBeDefined();
    keeper();
  });

  it('opens a never-saved document’s draft as an untitled, modified document', async () => {
    const { services, library, draftOf, storage } = await setup();
    await draftOf('doc-xyz', {}, 'Fresh');
    const keeper = library.drafts.start();
    await library.drafts.recovery.scan();
    await library.drafts.recovery.recover('doc-xyz');
    const state = services.document.getState();
    expect(state.songId).toBeUndefined();
    expect(state.file).toBeUndefined();
    expect(state.dirty).toBe(true);
    expect(state.score?.meta.title).toBe('Fresh');
    // Moved to the new document's own key before the old files went.
    const drafts = storage
      .paths()
      .filter((path) => path.endsWith('.reprise') && path.includes('drafts/'));
    expect(drafts).toEqual([draftNativePath(`doc-${state.id ?? ''}`)]);
    keeper();
  });

  it('asks before replacing a modified document, and Cancel keeps both', async () => {
    const { services, library, draftOf } = await setup();
    renderWithServices(
      <>
        <DraftRecoveryDialog />
        <UnsavedChangesHost />
      </>,
      services,
    );
    await draftOf('doc-xyz', {});
    await library.openAndImport({ name: 'b.reprise', bytes: await songBytes('B') });
    await settleLibraryWrites();
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
    await act(() => library.drafts.recovery.scan());
    expect(library.drafts.recovery.store.getState().offers).toHaveLength(1);
    expect(await screen.findByRole('dialog', { name: /closed with unsaved/i })).toBeVisible();
    const before = services.document.getState().id;
    void library.drafts.recovery.recover('doc-xyz');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(services.document.getState().id).toBe(before);
    expect(library.drafts.recovery.store.getState().offers).toHaveLength(1);
  });

  it('Later keeps the drafts and Discard all removes them', async () => {
    const { services, library, draftOf, storage } = await setup();
    renderWithServices(<DraftRecoveryDialog />, services);
    await draftOf('doc-one', {});
    await draftOf('doc-two', {});
    await act(() => library.drafts.recovery.scan());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storage.paths().filter((path) => path.includes('drafts/'))).toHaveLength(4);
    await act(() => library.drafts.recovery.scan());
    await user.click(await screen.findByRole('button', { name: 'Discard all' }));
    expect(storage.paths().filter((path) => path.includes('drafts/'))).toEqual([]);
  });

  it('removes a draft that cannot be read as a score, and says so', async () => {
    const { library, draftOf, storage } = await setup();
    await draftOf('doc-broken', {}, 'Broken', new Uint8Array([1, 2, 3]));
    await library.drafts.recovery.scan();
    await library.drafts.recovery.recover('doc-broken');
    expect(library.store.getState().notice?.kind).toBe('error');
    expect(storage.paths().filter((path) => path.includes('doc-broken'))).toEqual([]);
  });
});
