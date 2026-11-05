import { describe, expect, it } from 'vitest';

import { engraving, glyphMetrics, textWidth } from './metrics';

describe('metrics', () => {
  it('reads Bravura glyph metrics in staff spaces', () => {
    const clef = glyphMetrics('gClef');
    expect(clef.codepoint).toBe(0xe050);
    expect(clef.advance).toBeGreaterThan(2);
    expect(clef.bbox.top).toBeGreaterThan(clef.bbox.bottom);
    expect(engraving.staffLineThickness).toBeGreaterThan(0);
  });

  it('measures UI text from the advance table, linear in size', () => {
    expect(textWidth('', 12)).toBe(0);
    expect(textWidth('12', 20)).toBeCloseTo(textWidth('12', 10) * 2, 9);
    expect(textWidth('WW', 10)).toBeGreaterThan(textWidth('ii', 10));
    expect(textWidth('\u{1F3B8}', 10)).toBe(textWidth('0', 10));
  });
});
