import { describe, expect, it } from 'vitest';

import { loadBundle } from './fetch-gm.ts';

describe('gm.json', () => {
  it('pins a commit and a SHA-256 for every file', async () => {
    const bundle = await loadBundle();
    expect(bundle.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(bundle.files.map((file) => file.name)).toEqual(['GeneralUser-GS.sf2', 'LICENSE.txt']);
    for (const file of bundle.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
