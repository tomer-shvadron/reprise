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

export const KNOWN_ISSUES: readonly KnownIssue[] = [];
