import { SCORE_VERSION } from './score';

/**
 * Turns the `score` of a document written at version `n - 1` into its version-`n` shape. It
 * works on parsed JSON, not on `Score`, because older shapes are not the current type.
 */
export type Migration = (score: unknown) => unknown;

export type MigrationTable = Readonly<Record<number, Migration>>;

/** Keyed by the version each step produces; version 1 is the identity so the table is total. */
export const MIGRATIONS: MigrationTable = {
  1: (score) => score,
};

/** Applies the steps after `fromVersion` up to `toVersion`, in order. */
export function migrate(
  score: unknown,
  fromVersion: number,
  toVersion: number = SCORE_VERSION,
  table: MigrationTable = MIGRATIONS,
): unknown {
  let current = score;
  for (let version = fromVersion + 1; version <= toVersion; version++) {
    const step = table[version];
    if (!step) throw new Error(`No migration produces .reprise version ${String(version)}`);
    current = step(current);
  }
  return current;
}
