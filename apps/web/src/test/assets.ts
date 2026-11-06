// Vite resolves `new URL(file, import.meta.url)` to a URL its browser server serves, outside the
// project root too; it does not resolve a directory, so fixtures resolve against the manifest.
const MANIFEST = new URL('../../../../fixtures/manifest.json', import.meta.url);
const SYNTHETIC_SF2 = new URL(
  '../../../../packages/audio/test-fixtures/synthetic.sf2',
  import.meta.url,
);
const GENERAL_USER = new URL('../../public/sounds/gm/GeneralUser-GS.sf2', import.meta.url);

export async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.href}: ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

export const fixtureUrl = (path: string): URL => new URL(path, MANIFEST);

export const fetchFixture = (path: string): Promise<Uint8Array> => fetchBytes(fixtureUrl(path));

export const fetchSyntheticSf2 = (): Promise<Uint8Array> => fetchBytes(SYNTHETIC_SF2);

export async function fixturePaths(): Promise<string[]> {
  const response = await fetch(MANIFEST);
  const manifest: unknown = await response.json();
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('fixtures' in manifest) ||
    !Array.isArray(manifest.fixtures)
  ) {
    throw new Error('fixtures/manifest.json has no fixtures list');
  }
  return manifest.fixtures.flatMap((entry: unknown) =>
    typeof entry === 'object' && entry !== null && 'path' in entry && typeof entry.path === 'string'
      ? [entry.path]
      : [],
  );
}

/** GeneralUser GS, or undefined until `pnpm sounds:fetch` has run. */
export async function fetchGeneralUser(): Promise<Uint8Array | undefined> {
  try {
    const bytes = await fetchBytes(GENERAL_USER);
    return String.fromCodePoint(...bytes.subarray(0, 4)) === 'RIFF' ? bytes : undefined;
  } catch {
    return undefined;
  }
}
