/**
 * The record every `pnpm check:files` check emits through `task.meta`. Keep in step with
 * `scripts/check-files/meta.ts`: each package holds a byte-identical copy, since none may import
 * another's test code.
 */

export type CheckId = 'read' | 'oracle' | 'order' | 'tempo' | 'layout' | 'audio';

export const CHECK_IDS: readonly CheckId[] = [
  'read',
  'oracle',
  'order',
  'tempo',
  'layout',
  'audio',
];

/** One file the pass covers; `index` names its native document under `.check-files/natives/`. */
export interface CheckFile {
  /** A fixture's repo-relative POSIX path; `local-<n>` for any other file. */
  file: string;
  source: 'fixtures' | 'local';
  /** Only for reading the bytes: a local file's path names it, so it never reaches a report. */
  absolute: string;
  index: number;
  /** A local file's SHA-256, first 12 hex digits. */
  hash?: string;
  readError?: string;
}

export interface CheckViolation {
  /** Kebab-case, `outside-page`. */
  code: string;
  /** One line; never a file name or any text from a local file. */
  message: string;
  /** `bar 12 (pass 2), track 2 (fretted, program 30), beat 3`. */
  where?: string;
  /** `group`, when set, refines how drafts are grouped. */
  data?: Record<string, string | number | boolean>;
}

export interface CheckExplained {
  id: string;
  message: string;
  count: number;
}

/** A feature the listening sheet asks about, with its first written bars (1-based, at most 5). */
export interface ListeningFeature {
  key: string;
  bars: number[];
  detail?: string;
}

export interface CheckRecord {
  file: string;
  check: CheckId;
  /** Why the check did not run. */
  skipped?: string;
  summary: string;
  violations: CheckViolation[];
  explained: CheckExplained[];
  facts: Record<string, string | number | boolean>;
  sections: { title: string; markdown: string }[];
  features?: ListeningFeature[];
}

/** Set before a check starts, so the reporter can name a check that crashed. */
export interface CheckTarget {
  file: string;
  check: CheckId;
}

declare module 'vitest' {
  interface TaskMeta {
    check?: CheckRecord;
    checkTarget?: CheckTarget;
  }
  interface ProvidedContext {
    checkFiles: CheckFile[];
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isCheckRecord(value: unknown): value is CheckRecord {
  return (
    isObject(value) &&
    typeof value['file'] === 'string' &&
    typeof value['check'] === 'string' &&
    CHECK_IDS.some((id) => id === value['check']) &&
    typeof value['summary'] === 'string' &&
    Array.isArray(value['violations']) &&
    Array.isArray(value['explained']) &&
    isObject(value['facts']) &&
    Array.isArray(value['sections'])
  );
}

/** A record with the fields every check fills, ready for its own. */
export function emptyRecord(file: string, check: CheckId): CheckRecord {
  return { file, check, summary: '', violations: [], explained: [], facts: {}, sections: [] };
}
