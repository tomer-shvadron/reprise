import { describe, expect, it } from 'vitest';

import { read } from '../../src/index';
import { fixtureBytes } from '../corpus';
import { loadWithAlphaTab } from '../oracle/project-alphatab';

/** A GP5 file whose empty title (an int length, a byte length, no characters) becomes `title`. */
function withTitle(bytes: Uint8Array, title: Uint8Array): Uint8Array {
  const at = 31;
  const out = new Uint8Array(bytes.length + title.length);
  out.set(bytes.subarray(0, at));
  new DataView(out.buffer).setInt32(at, title.length + 1, true);
  out[at + 4] = title.length;
  out.set(title, at + 5);
  out.set(bytes.subarray(at + 5), at + 5 + title.length);
  return out;
}

describe('alphaTab with the GP3 to GP5 encoding', () => {
  it('reads a windows-1252 title as our reader does', async () => {
    // "Café – Bänd": é, the en dash and ä are single windows-1252 bytes.
    const title = new Uint8Array([
      0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x42, 0xe4, 0x6e, 0x64,
    ]);
    const bytes = withTitle(fixtureBytes('gp5/chords.gp5'), title);
    const ours = (await read(bytes)).score.meta.title;
    expect(ours).toBe('Café – Bänd');
    expect(loadWithAlphaTab(bytes).title).not.toBe(ours);
    expect(loadWithAlphaTab(bytes, { encoding: 'windows-1252' }).title).toBe(ours);
  });
});
