import { write } from '@reprise/formats';
import { insertBar } from '@reprise/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openLibraryDb, type RepriseDb } from '@/features/library/db/schema';
import { uniqueDbName } from '@/features/library/test-support';
import { loopBarNumbers } from '@/features/transport';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { installPracticeLog, practiceLogFor } from './install';
import { resumePractice } from './resume';
import { resumeTarget } from './summary';

const SONG = 'SONGSONGSONG';
const dbs: RepriseDb[] = [];
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const db of dbs.splice(0)) db.close();
  vi.useRealTimers();
});

function launch(name: string) {
  const services = createTestServices();
  mirrorAudio(services);
  const db = openLibraryDb(name);
  dbs.push(db);
  cleanups.push(installPracticeLog(services, db.practiceSessions));
  return { services, db };
}

describe('the practice log', () => {
  it('survives a restart, and Resume follows the bars after an insert before the loop', async () => {
    const name = uniqueDbName();
    const { bytes } = await write(fourBars(), 'reprise');

    // First run: play, loop bars 3 and 4, finish a step, edit, save, close the window.
    const first = launch(name);
    await first.services.document.getState().openBytes('song.reprise', bytes, { songId: SONG });
    const original = first.services.document.getState().score;
    const [, , third, fourth] = original?.masterBars ?? [];
    const range = { startBar: third?.id ?? '', endBar: fourth?.id ?? '' };
    first.services.fakeAudio.setLoop(range);
    first.services.fakeAudio.setTempo('percent', 85);
    first.services.playback.setState({ transport: 'playing' });
    vi.advanceTimersByTime(25_000);
    first.services.practice.getState().recordStep(range, 85);
    first.services.document.getState().apply(insertBar({ index: 0 }));
    vi.advanceTimersByTime(600);
    first.services.playback.setState({ transport: 'paused' });
    const edited = first.services.document.getState().score;
    if (!edited) throw new Error('no score');
    dispatchEvent(new Event('pagehide'));
    await first.db.practiceSessions.count();
    cleanups.splice(0).forEach((cleanup) => {
      cleanup();
    });
    first.db.close();

    // Second run, a fresh connection: the session is there, with the loop by bar id.
    const second = launch(name);
    const repo = practiceLogFor(second.services);
    const rows = (await repo?.forSong(SONG)) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ songId: SONG, playedMs: 25_600 });
    expect(rows[0]?.loops).toEqual([
      expect.objectContaining({ ...range, bestPercent: 85, label: { start: 4, end: 5 } }),
    ]);

    // The saved file holds the edited score; Resume restores the same bar ids at shifted numbers.
    const saved = (await write(edited, 'reprise')).bytes;
    const target = resumeTarget(rows);
    if (!target) throw new Error('no target');
    await resumePractice(second.services, SONG, target, async () => {
      await second.services.document.getState().openBytes('song.reprise', saved, { songId: SONG });
    });
    const { settings } = second.services.playback.getState();
    expect(settings.loop).toEqual(range);
    expect(settings.tempo).toEqual({ mode: 'percent', value: 85 });
    expect(loopBarNumbers(second.services.document.getState().score, range)).toEqual({
      start: 4,
      end: 5,
    });
  });
});
