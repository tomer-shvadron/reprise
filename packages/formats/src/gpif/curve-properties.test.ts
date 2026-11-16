import { describe, expect, it } from 'vitest';

import { curveProperties } from './write-notes';

describe('curveProperties', () => {
  it('writes MiddleOffset2 for a bend held between two points', () => {
    const properties = curveProperties([
      { position: 0, value: 0 },
      { position: 20, value: 4 },
      { position: 40, value: 4 },
      { position: 60, value: 0 },
    ]);
    expect(properties?.has('MiddleOffset1')).toBe(true);
    expect(properties?.has('MiddleOffset2')).toBe(true);
    expect((properties?.get('MiddleOffset2') ?? 0) > (properties?.get('MiddleOffset1') ?? 0)).toBe(
      true,
    );
  });

  it('refuses a held bend whose two middle values differ', () => {
    expect(
      curveProperties([
        { position: 0, value: 0 },
        { position: 20, value: 4 },
        { position: 40, value: 2 },
        { position: 60, value: 0 },
      ]),
    ).toBeUndefined();
  });
});
