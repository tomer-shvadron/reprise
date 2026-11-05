import { createMasterBar } from '@reprise/model';
import type { MasterBar } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { propagateEndings } from './master-bars';

function bars(...specs: { endings?: number[]; start?: boolean; end?: number }[]): MasterBar[] {
  return specs.map(({ endings = [], start = false, end = 0 }) =>
    createMasterBar({ alternateEndings: endings, repeat: { start, endCount: end } }),
  );
}

describe('propagateEndings', () => {
  it('fills a bracket through the bar that closes the repeat', () => {
    const masterBars = bars(
      { start: true },
      { endings: [1] },
      {},
      { end: 2 },
      { endings: [2] },
      {},
    );
    propagateEndings(masterBars);
    expect(masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1], [1], [1], [2], []]);
  });

  it('stops at the next bracket or repeat start', () => {
    const masterBars = bars(
      { start: true },
      { endings: [1] },
      { endings: [2] },
      { end: 2 },
      { start: true },
    );
    propagateEndings(masterBars);
    expect(masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1], [2], [2], []]);
  });

  it('keeps a final bracket with no repeat end ahead to its own bar', () => {
    const masterBars = bars({ start: true }, { endings: [1], end: 2 }, { endings: [2] }, {}, {});
    propagateEndings(masterBars);
    expect(masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1], [2], [], []]);
  });
});
