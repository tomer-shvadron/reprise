import { describe, expect, it } from 'vitest';

import { engraving, fitText, glyphMetrics, textWidth } from './metrics';

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

  it('cuts text that does not fit with an ellipsis', () => {
    const name = 'Bass Program - Standard Tuning';
    const width = textWidth(name, 16);
    expect(fitText(name, 16, width + 10)).toBe(name);
    expect(fitText(name, 16, width)).toBe(name);
    const cut = fitText(name, 16, width / 2);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 16)).toBeLessThanOrEqual(width / 2);
    expect(name.startsWith(cut.slice(0, -1))).toBe(true);
    expect(fitText(name, 16, textWidth('…', 16) - 0.1)).toBe('');
  });
});
