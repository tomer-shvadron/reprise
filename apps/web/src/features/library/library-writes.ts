/**
 * Every library's background writes, for `settleLibraryWrites`. A leaf module with no imports:
 * `test/setup.ts` loads it before each test file, and anything it imported would already be in
 * the module cache when a test's `vi.mock` runs, so the mock would not apply. `library.ts` is
 * the root of a large graph and must stay out of the setup file.
 */
const allWrites = new Set<Promise<void>>();

/** Adds a write to the set until it settles. */
export function trackWrite(write: Promise<void>): void {
  allWrites.add(write);
  const done = () => {
    allWrites.delete(write);
  };
  write.then(done, done);
}

/**
 * Resolves once every import running now, in any library, has finished: `openAndImport`,
 * `importOpenDocument` and the batch imports. They write after the call that started them has
 * returned, so a test teardown that deletes the databases awaits this first, or a late write
 * lands in the next database opened under the same name. `Library.dispose()` awaits its own
 * library's share. Nothing calls `dispose()` when the window closes and no hook could await it
 * there, so a close mid-import can leave files in the library folder with no row; see the
 * library README.
 */
export async function settleLibraryWrites(): Promise<void> {
  await Promise.allSettled([...allWrites]);
}
