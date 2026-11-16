import { newId } from '@reprise/model';
import { Dexie } from 'dexie';

import type { PracticeTable } from './repository';
import type { PracticeSessionRow } from './row';

/** A valid row; tests override what they care about. */
export function rowOf(overrides: Partial<PracticeSessionRow> = {}): PracticeSessionRow {
  return {
    id: 'AAAAAAAAAAAA',
    songId: 'SONGSONGSONG',
    startedAt: 1000,
    endedAt: 61_000,
    playedMs: 60_000,
    loops: [],
    tempoHistory: [],
    ...overrides,
  };
}

let tables = 0;

/**
 * A `practiceSessions` table of its own, with the library schema's store string, so tests of this
 * feature need not reach into the library's internals. The library's schema test and the
 * acceptance test prove the real schema.
 */
export function practiceTable(): PracticeTable {
  tables += 1;
  const db = new Dexie(`practice-test-${String(tables)}-${newId()}`);
  db.version(1).stores({ practiceSessions: 'id, [songId+startedAt]' });
  // Dexie adds each declared table as a property; the cast is that structural fact.
  return (db as Dexie & { practiceSessions: PracticeTable }).practiceSessions;
}
