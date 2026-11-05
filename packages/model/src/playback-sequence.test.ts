import { describe, expect, it } from 'vitest';

import { createMasterBar } from './factories';
import type { DirectionTarget, JumpKind, MasterBar } from './master-bar';
import { PLAYBACK_LENGTH_FACTOR, expandPlaybackSequence } from './playback-sequence';
import type { PlaybackWarningCode } from './playback-sequence';

interface BarSpec {
  start?: boolean;
  end?: number;
  volta?: number[];
  jumps?: JumpKind[];
  targets?: DirectionTarget[];
}

function bar(spec: BarSpec = {}): MasterBar {
  return createMasterBar({
    repeat: { start: spec.start ?? false, endCount: spec.end ?? 0 },
    alternateEndings: spec.volta ?? [],
    jumps: (spec.jumps ?? []).map((kind) => ({ kind })),
    targets: spec.targets ?? [],
  });
}

function expand(...specs: BarSpec[]) {
  return expandPlaybackSequence({ masterBars: specs.map(bar) });
}

function order(...specs: BarSpec[]): number[] {
  return expand(...specs).sequence.map((pass) => pass.masterBarIndex);
}

function warningCodes(...specs: BarSpec[]): PlaybackWarningCode[] {
  return expand(...specs).warnings.map((warning) => warning.code);
}

describe('expandPlaybackSequence: repeats', () => {
  it('plays written order when there is nothing to expand', () => {
    const { sequence, warnings } = expand({}, {}, {});
    expect(sequence).toEqual([
      { masterBarIndex: 0, passIndex: 0 },
      { masterBarIndex: 1, passIndex: 0 },
      { masterBarIndex: 2, passIndex: 0 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('plays a repeated section endCount times and numbers the passes', () => {
    const { sequence } = expand({ start: true }, { end: 2 }, {});
    expect(sequence).toEqual([
      { masterBarIndex: 0, passIndex: 0 },
      { masterBarIndex: 1, passIndex: 0 },
      { masterBarIndex: 0, passIndex: 1 },
      { masterBarIndex: 1, passIndex: 1 },
      { masterBarIndex: 2, passIndex: 0 },
    ]);
    expect(order({}, { start: true }, { end: 3 }, {})).toEqual([0, 1, 2, 1, 2, 1, 2, 3]);
  });

  it('treats endCount 1 as no repeat', () => {
    expect(order({ start: true }, { end: 1 }, {})).toEqual([0, 1, 2]);
  });

  it('plays consecutive sections in turn', () => {
    expect(order({ start: true, end: 2 }, { start: true, end: 2 })).toEqual([0, 0, 1, 1]);
  });

  it('repeats an unmatched repeat end from the start of the song, with a warning', () => {
    expect(order({}, { end: 2 }, {})).toEqual([0, 1, 0, 1, 2]);
    expect(warningCodes({}, { end: 2 }, {})).toEqual(['repeat-end-without-start']);
  });

  it('sends a second repeat end back to the same start, replaying the first (as alphaTab does)', () => {
    expect(order({ start: true }, { end: 2 }, { end: 2 }, {})).toEqual([
      0, 1, 0, 1, 2, 0, 1, 0, 1, 2, 3,
    ]);
  });
});

describe('expandPlaybackSequence: alternate endings', () => {
  it('plays each volta on its pass', () => {
    expect(order({ start: true }, { volta: [1], end: 2 }, { volta: [2] }, {})).toEqual([
      0, 1, 0, 2, 3,
    ]);
  });

  it('plays a volta shared by several passes', () => {
    expect(order({ start: true }, { volta: [1, 2], end: 3 }, { volta: [3] }, {})).toEqual([
      0, 1, 0, 1, 0, 2, 3,
    ]);
  });

  it('plays a multi-bar volta bar by bar', () => {
    expect(
      order({ start: true }, { volta: [1] }, { volta: [1], end: 2 }, { volta: [2] }, {}),
    ).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it('ends on a final volta that is the last bar', () => {
    expect(order({ start: true }, { volta: [1], end: 2 }, { volta: [2] })).toEqual([0, 1, 0, 2]);
  });

  it('repeats a volta that is the last bar and closes the repeat itself', () => {
    expect(order({ start: true }, { volta: [1, 2], end: 2 })).toEqual([0, 1, 0, 1]);
  });

  it('skips a volta with no matching pass', () => {
    expect(order({ start: true }, { volta: [3] }, { end: 2 }, {})).toEqual([0, 2, 0, 2, 3]);
  });

  it('reads the repeat end of a skipped volta bar, as fixtures/gp5/repeat-close-alternate-endings.gp5 needs', () => {
    // |: A | [1,3. B | [2. C | D :|x4 | E, the repeat close inside the "2." bracket; alphaTab's order.
    expect(
      order({ start: true }, { volta: [1, 3] }, { volta: [2] }, { volta: [2], end: 4 }, {}),
    ).toEqual([0, 1, 0, 2, 3, 0, 1, 0, 4]);
  });

  it('plays a volta bar with no repeat end ahead of it', () => {
    expect(order({ start: true }, { end: 2 }, { volta: [1] }, {})).toEqual([0, 1, 0, 1, 2, 3]);
    expect(warningCodes({ start: true }, { end: 2 }, { volta: [1] }, {})).toEqual([]);
  });

  it('plays a volta bar with no repeat around it, with a warning', () => {
    expect(order({}, { volta: [2] }, {})).toEqual([0, 1, 2]);
    expect(warningCodes({}, { volta: [2] }, {})).toEqual(['volta-without-repeat']);
    const coda: BarSpec[] = [
      { jumps: ['toCoda'] },
      { jumps: ['dcAlCoda'] },
      { targets: ['coda'] },
      { volta: [2] },
      {},
    ];
    expect(order(...coda)).toEqual([0, 1, 0, 2, 3, 4]);
    expect(warningCodes(...coda)).toEqual(['volta-without-repeat']);
  });
});

describe('expandPlaybackSequence: jumps', () => {
  it('D.C. plays from the start to the end', () => {
    expect(order({}, {}, { jumps: ['daCapo'] })).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('D.C. al Fine stops at the fine on the return only', () => {
    expect(order({}, { targets: ['fine'] }, { jumps: ['dcAlFine'] })).toEqual([0, 1, 2, 0, 1]);
    expect(order({}, { targets: ['fine'] }, {})).toEqual([0, 1, 2]);
  });

  it('D.C. al Coda takes To Coda on the return only', () => {
    expect(
      order({}, { jumps: ['toCoda'] }, { jumps: ['dcAlCoda'] }, { targets: ['coda'] }, {}),
    ).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  it('D.C. al Double Coda takes To Double Coda and ignores To Coda', () => {
    const specs: BarSpec[] = [
      { jumps: ['toCoda'] },
      { jumps: ['toDoubleCoda'] },
      { jumps: ['dcAlDoubleCoda'] },
      { targets: ['coda'] },
      { targets: ['doubleCoda'] },
    ];
    expect(order(...specs)).toEqual([0, 1, 2, 0, 1, 4]);
  });

  it('D.S. plays from the segno to the end', () => {
    expect(order({}, { targets: ['segno'] }, { jumps: ['dalSegno'] }, {})).toEqual([
      0, 1, 2, 1, 2, 3,
    ]);
  });

  it('D.S. al Fine', () => {
    expect(
      order({}, { targets: ['segno'] }, { targets: ['fine'] }, { jumps: ['dsAlFine'] }, {}),
    ).toEqual([0, 1, 2, 3, 1, 2]);
  });

  it('D.S. al Coda', () => {
    expect(
      order(
        {},
        { targets: ['segno'] },
        { jumps: ['toCoda'] },
        { jumps: ['dsAlCoda'] },
        { targets: ['coda'] },
        {},
      ),
    ).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it('D.S. al Double Coda', () => {
    expect(
      order(
        { targets: ['segno'] },
        { jumps: ['toCoda'] },
        { jumps: ['toDoubleCoda'] },
        { jumps: ['dsAlDoubleCoda'] },
        { targets: ['coda'] },
        { targets: ['doubleCoda'] },
      ),
    ).toEqual([0, 1, 2, 3, 0, 1, 2, 5]);
  });

  it('D.S.S. and its al Coda, al Double Coda and al Fine forms land on the segno segno', () => {
    const lead: BarSpec[] = [{ targets: ['segno'] }, {}, { targets: ['segnoSegno'] }];
    expect(order(...lead, { jumps: ['dalSegnoSegno'] }, {})).toEqual([0, 1, 2, 3, 2, 3, 4]);
    expect(
      order(...lead, { jumps: ['toCoda'] }, { jumps: ['dssAlCoda'] }, { targets: ['coda'] }),
    ).toEqual([0, 1, 2, 3, 4, 2, 3, 5]);
    expect(
      order(
        ...lead,
        { jumps: ['toDoubleCoda'] },
        { jumps: ['dssAlDoubleCoda'] },
        { targets: ['doubleCoda'] },
      ),
    ).toEqual([0, 1, 2, 3, 4, 2, 3, 5]);
    expect(order(...lead, { targets: ['fine'] }, { jumps: ['dssAlFine'] }, {})).toEqual([
      0, 1, 2, 3, 4, 2, 3,
    ]);
  });

  it('plays fixtures/gp5/directions.gp5 as alphaTab does: nothing fires after a plain D.C.', () => {
    const kinds: JumpKind[] = [
      'daCapo',
      'dcAlCoda',
      'dcAlDoubleCoda',
      'dcAlFine',
      'dalSegno',
      'dalSegnoSegno',
      'dsAlCoda',
      'dsAlDoubleCoda',
      'dssAlCoda',
      'dssAlDoubleCoda',
      'dsAlFine',
      'dssAlFine',
      'toCoda',
      'toDoubleCoda',
    ];
    const specs: BarSpec[] = [
      { targets: ['coda'] },
      { targets: ['doubleCoda'] },
      { targets: ['segno'] },
      { targets: ['segnoSegno'] },
      { targets: ['fine'] },
      ...kinds.map((kind): BarSpec => ({ jumps: [kind] })),
    ];
    const written = specs.map((_, index) => index);
    expect(order(...specs)).toEqual([0, 1, 2, 3, 4, 5, ...written]);
    expect(warningCodes(...specs)).toEqual([]);
  });

  it('applies a bar’s jumps in order, taking the first that applies', () => {
    expect(
      order({ targets: ['segno'] }, {}, { jumps: ['toCoda', 'dsAlCoda'] }, { targets: ['coda'] }),
    ).toEqual([0, 1, 2, 0, 1, 2, 3]);
  });

  it('honours repeats again once playback reaches the coda', () => {
    expect(
      order(
        {},
        { jumps: ['toCoda'] },
        { jumps: ['dcAlCoda'] },
        { targets: ['coda'], start: true },
        { end: 2 },
      ),
    ).toEqual([0, 1, 2, 0, 1, 3, 4, 3, 4]);
  });

  it('repeats an unmatched repeat end in the coda from the coda', () => {
    const specs: BarSpec[] = [
      { jumps: ['toCoda'] },
      { jumps: ['dcAlCoda'] },
      { targets: ['coda'] },
      { end: 2 },
    ];
    expect(order(...specs)).toEqual([0, 1, 0, 2, 3, 2, 3]);
    expect(warningCodes(...specs)).toEqual(['repeat-end-without-start']);
  });
});

describe('expandPlaybackSequence: nested-looking cases', () => {
  it('plays a repeat inside a D.S. section once on the return', () => {
    expect(
      order({}, { targets: ['segno'], start: true }, { end: 2 }, { jumps: ['dalSegno'] }, {}),
    ).toEqual([0, 1, 2, 1, 2, 3, 1, 2, 3, 4]);
  });

  it('takes only the final volta of a repeat inside a D.S. section on the return', () => {
    expect(
      order(
        { targets: ['segno'] },
        { start: true },
        { volta: [1], end: 2 },
        { volta: [2] },
        { jumps: ['dalSegno'] },
        {},
      ),
    ).toEqual([0, 1, 2, 1, 3, 4, 0, 1, 3, 4, 5]);
  });

  it('reads a D.S. on a repeat end after the last pass of the repeat', () => {
    expect(
      order({ targets: ['segno'] }, { start: true }, { end: 2, jumps: ['dalSegno'] }, {}),
    ).toEqual([0, 1, 2, 1, 2, 0, 1, 2, 3]);
  });

  it('ignores the jumps of a skipped volta', () => {
    expect(
      order({ start: true }, { volta: [1], end: 2, jumps: ['daCapo'] }, { volta: [2] }, {}),
    ).toEqual([0, 1, 0, 2, 3]);
  });

  it('stays finite when a D.S. al Coda’s coda precedes the segno', () => {
    const { sequence, warnings } = expand(
      { targets: ['coda'] },
      { targets: ['segno'] },
      { jumps: ['toCoda'] },
      { jumps: ['dsAlCoda'] },
    );
    expect(sequence.map((pass) => pass.masterBarIndex)).toEqual([0, 1, 2, 3, 1, 2, 0, 1, 2, 3]);
    expect(warnings).toEqual([]);
  });

  it('fires each jump at most once, so a D.C. on every bar is finite', () => {
    expect(order({ jumps: ['daCapo'] }, { jumps: ['daCapo'] })).toEqual([0, 0, 1]);
  });
});

describe('expandPlaybackSequence: malformed input', () => {
  it('ignores a jump with no target, with a warning', () => {
    expect(order({}, { jumps: ['dalSegno'] }, {})).toEqual([0, 1, 2]);
    expect(warningCodes({}, { jumps: ['dalSegno'] }, {})).toEqual(['jump-target-missing']);
  });

  it('ignores a To Coda with no coda on the return, with a warning', () => {
    const specs: BarSpec[] = [{}, { jumps: ['toCoda'] }, { jumps: ['dcAlCoda'] }, {}];
    expect(order(...specs)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    expect(warningCodes(...specs)).toEqual(['jump-target-missing']);
  });

  it('plays a D.C. al Fine with no fine to the end, with a warning', () => {
    expect(order({}, { jumps: ['dcAlFine'] })).toEqual([0, 1, 0, 1]);
    expect(warningCodes({}, { jumps: ['dcAlFine'] })).toEqual(['jump-target-missing']);
  });

  it('truncates a runaway repeat count with a warning', () => {
    const { sequence, warnings } = expand({ start: true, end: 1000 }, {});
    expect(sequence).toHaveLength(2 * PLAYBACK_LENGTH_FACTOR);
    expect(warnings.map((warning) => warning.code)).toEqual(['sequence-truncated']);
  });

  it('returns an empty sequence for a score with no master bars', () => {
    expect(expandPlaybackSequence({ masterBars: [] })).toEqual({ sequence: [], warnings: [] });
  });
});
