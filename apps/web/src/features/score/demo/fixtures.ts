import { read } from '@reprise/formats';
import type { Score } from '@reprise/model';

const PREFIX = '../../../../../../fixtures/';

const urls = import.meta.glob<string>('../../../../../../fixtures/**/*.{gp,gp3,gp4,gp5,gpx}', {
  query: '?url',
  import: 'default',
});

/** Fixture names relative to fixtures/, e.g. `gp5/staves.gp5`. */
export const FIXTURES: readonly string[] = Object.keys(urls)
  .map((path) => path.slice(PREFIX.length))
  .sort();

export async function loadFixture(name: string): Promise<Score> {
  const url = urls[PREFIX + name];
  if (!url) throw new Error(`no fixture ${name}`);
  const response = await fetch(await url());
  if (!response.ok) throw new Error(`fetching ${name} failed with ${String(response.status)}`);
  const { score } = await read(new Uint8Array(await response.arrayBuffer()));
  return score;
}
