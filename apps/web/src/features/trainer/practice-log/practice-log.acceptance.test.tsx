import { write } from '@reprise/formats';
import { insertBar } from '@reprise/model';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The one test that uses the library's real schema: it proves the table, its index and the row
// survive a restart as the app really opens them, which a trainer-local table could not.
import { openLibraryDb, type RepriseDb } from '@/features/library/db/schema';
import { uniqueDbName } from '@/features/library/test-support';
import { loopBarNumbers } from '@/features/transport';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { installPracticeLog, practiceLogFor } from './install';
import { resumePractice } from './resume';
import { SongPracticePage } from './song-page';
import { resumeTarget } from './summary';

const SONG = 'SONGSONGSONG';
const dbs: RepriseDb[] = [];
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
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
  it('survives a restart, and Resume follows the bar ids after an insert before the loop', async () => {
    const name = uniqueDbName();
    const { bytes } = await write(fourBars(), 'reprise');

    // First run: play, loop bars 3 and 4, finish a step, close the window.
    const first = launch(name);
    await first.services.document.getState().openBytes('song.reprise', bytes, { songId: SONG });
    const [, , third, fourth] = first.services.document.getState().score?.masterBars ?? [];
    const range = { startBar: third?.id ?? '', endBar: fourth?.id ?? '' };
    first.services.fakeAudio.setLoop(range);
    first.services.fakeAudio.setTempo('percent', 85);
    first.services.playback.setState({ transport: 'playing' });
    vi.advanceTimersByTime(25_000);
    first.services.practice.getState().recordStep(range, 85);
    first.services.playback.setState({ transport: 'paused' });
    dispatchEvent(new Event('pagehide'));
    cleanups.splice(0).forEach((cleanup) => {
      cleanup();
    });
    await first.db.practiceSessions.count();

    // The edit comes after the last write, so the row still says bars 3 to 4: only the ids can
    // lead Resume to the loop's new place. Saving writes the edited score as the song's bytes.
    first.services.document.getState().apply(insertBar({ index: 0 }));
    const edited = first.services.document.getState().score;
    if (!edited) throw new Error('no score');
    const saved = (await write(edited, 'reprise')).bytes;
    first.db.close();

    // Second run, a fresh connection: the session is there, with the loop by bar id.
    const second = launch(name);
    const rows = (await practiceLogFor(second.services)?.forSong(SONG)) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ songId: SONG, playedMs: 25_000 });
    expect(rows[0]?.loops).toEqual([
      expect.objectContaining({ ...range, bestPercent: 85, label: { start: 3, end: 4 } }),
    ]);

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

    // Testing Library's waits need real timers; nothing here depends on the clock any more.
    vi.useRealTimers();
    // With the song open, the page reads the labels live, so they follow the edit.
    renderWithServices(
      <SongPracticePage
        song={{ id: SONG, title: 'Four bars', artist: '' }}
        open={() => Promise.resolve()}
        onBack={() => undefined}
      />,
      second.services,
    );
    expect(await screen.findByRole('button', { name: 'Resume bars 4–5 at 85%' })).toBeTruthy();
    expect(screen.getAllByText('bars 4–5').length).toBeGreaterThan(0);
    expect(screen.queryByText('bars 3–4')).toBeNull();
  });
});
