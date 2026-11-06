import { describe, expect, inject, it } from 'vitest';

import { parseSf2 } from './parse';
import { PERCUSSION_BANK, Sf2Soundfont } from './soundfont';

declare module 'vitest' {
  export interface ProvidedContext {
    syntheticSf2: Uint8Array;
  }
}

// The browser suite (`sf2.test.ts`) pins the values; this proves the parser needs no DOM.
describe('the SF2 parser under Node', () => {
  it('parses, resolves a preset and its drum kit, and reads a sample', async () => {
    const file = parseSf2(new Uint8Array(inject('syntheticSf2')));
    expect(file.presets).toHaveLength(6);

    const font = new Sf2Soundfont(file);
    const region = font.regionMapFor(0, 25)?.resolve(60, 100);
    expect(region).toBeDefined();
    expect(font.regionMapFor(8, 25)).toBeDefined();
    expect(font.regionMapFor(PERCUSSION_BANK, 0)).toBeDefined();
    if (!region) return;

    expect(font.instrumentsOf(region.sample)).toContain('gm:0:25');
    const raw = await font.fetch(region.sample);
    expect(raw.channels).toHaveLength(1);
    expect(raw.channels[0]?.some((value) => value !== 0)).toBe(true);
    expect(raw.byteLength).toBe(font.byteLength(region.sample));
  });
});
