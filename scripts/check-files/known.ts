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

const OVERFULL_FIXTURES = [
  'fixtures/gp3/effects.gp3',
  'fixtures/gp4/effects.gp4',
  'fixtures/gp5/effects.gp5',
  'fixtures/gpx/effects.gpx',
  'fixtures/gp3/notes.gp3',
  'fixtures/gp4/notes.gp4',
];

const num = (violation: CheckViolation, key: string): number => {
  const value = violation.data?.[key];
  return typeof value === 'number' ? value : 0;
};

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: 'bar-wider-than-page',
    issue: 107,
    check: 'layout',
    why: 'one over-full bar makes its system wider than the A4 page, so it overflows the right edge',
    fixtures: ['fixtures/gp3/notes.gp3', 'fixtures/gp4/notes.gp4'],
    applies: (violation) =>
      violation.code === 'outside-page' && num(violation, 'systemOverflowPx') > 0,
  },
  {
    id: 'overfull-voice-playback',
    issue: 118,
    check: 'audio',
    why: 'beats that start past the end of an over-full bar are never scheduled',
    fixtures: OVERFULL_FIXTURES,
    applies: (violation) => violation.code === 'beyond-bar-end',
  },
  {
    id: 'unison-anchors',
    issue: 110,
    check: 'layout',
    why: 'unison notes on two strings give overlapping note anchors on a standard staff',
    fixtures: [],
    applies: (violation) =>
      violation.code === 'overlapping-anchors' && violation.data?.['unison'] === true,
  },
];

export function knownFor(check: CheckId, violation: CheckViolation): KnownIssue | undefined {
  return KNOWN_ISSUES.find((entry) => entry.check === check && entry.applies(violation));
}
