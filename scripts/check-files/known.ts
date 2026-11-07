/**
 * Known failures of `pnpm check:files`, each tied to its open issue. A violation an entry
 * accepts makes the check `known` rather than `fail`. Each entry names the fixtures it must fire
 * on: when a run covers one of them and the entry does not fire there, the run fails as stale.
 * The PR that fixes an issue deletes its entry; a stale entry fails the run.
 */
import type { CheckId, CheckViolation } from './meta.ts';

export interface KnownIssue {
  id: string;
  issue: number;
  check: CheckId;
  why: string;
  /** Must fire on each of these whenever the run includes it. */
  fixtures: readonly string[];
  applies: (violation: CheckViolation) => boolean;
}

const num = (violation: CheckViolation, key: string): number => {
  const value = violation.data?.[key];
  return typeof value === 'number' ? value : 0;
};

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: 'bar-wider-than-page',
    issue: 107,
    check: 'layout',
    why: 'a bar wider than the content width is never squeezed or wrapped, so its system, which holds only that bar, runs off the right edge of the page',
    fixtures: ['fixtures/gp3/notes.gp3', 'fixtures/gp4/notes.gp4'],
    // Only #107's symptom: a system of several bars past the margin is a line-breaking bug.
    applies: (violation) =>
      violation.code === 'outside-page' &&
      num(violation, 'systemBars') === 1 &&
      num(violation, 'systemOverflowPx') > 0,
  },
  {
    id: 'unison-anchors',
    issue: 110,
    check: 'layout',
    why: 'unison notes on two strings give overlapping note anchors on a standard staff',
    // No fixture holds a unison, so this entry cannot go stale; #110 carries the reminder.
    fixtures: [],
    applies: (violation) =>
      violation.code === 'overlapping-anchors' && violation.data?.['unison'] === true,
  },
];

export function knownFor(check: CheckId, violation: CheckViolation): KnownIssue | undefined {
  return KNOWN_ISSUES.find((entry) => entry.check === check && entry.applies(violation));
}
