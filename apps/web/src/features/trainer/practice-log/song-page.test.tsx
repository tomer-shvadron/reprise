import { write } from '@reprise/formats';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openLibraryDb } from '@/features/library/db/schema';
import { uniqueDbName } from '@/features/library/test-support';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { installPracticeLog } from './install';
import { SongPracticePage } from './song-page';
import { rowOf } from './test-support';

const SONG = 'SONGSONGSONG';
const song = { id: SONG, title: 'Blackbird', artist: 'The Beatles' };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function renderPage(rows = [rowOf()]) {
  const services = createTestServices();
  mirrorAudio(services);
  const db = openLibraryDb(uniqueDbName());
  await db.practiceSessions.bulkAdd(rows);
  cleanups.push(installPracticeLog(services, db.practiceSessions), () => {
    db.close();
  });
  const open = vi.fn(() => Promise.resolve());
  const onBack = vi.fn();
  renderWithServices(<SongPracticePage song={song} open={open} onBack={onBack} />, services);
  return { services, open, onBack };
}

describe('SongPracticePage', () => {
  it('shows the empty state, with Resume disabled', async () => {
    await renderPage([]);
    expect(await screen.findByText(/Nothing practised yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveProperty('disabled', true);
  });

  it('shows the total time, the loops with best tempos and the sessions', async () => {
    await renderPage([
      rowOf({
        id: 'ONEONEONEONE',
        startedAt: 1000,
        playedMs: 12 * 60_000,
        loops: [
          {
            startBar: 'AAAAAAAAAAAA',
            endBar: 'BBBBBBBBBBBB',
            bestPercent: 85,
            bestBpm: 102,
            label: { start: 5, end: 8 },
          },
        ],
        tempoHistory: [{ atPlayedMs: 0, tempo: { mode: 'percent', value: 85 } }],
      }),
      rowOf({ id: 'TWOTWOTWOTWO', startedAt: 90_000_000, playedMs: 53 * 60_000 }),
    ]);
    expect(await screen.findByText('1 h 05 min')).toBeTruthy();
    expect(screen.getByText('Best 85% (102 BPM)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Loops worked on' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(screen.getAllByText('12 min').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Resume bars 5–8 at 85%' })).toBeTruthy();
  });

  it('resumes by opening the song, setting the tempo and showing the player', async () => {
    const { services, open } = await renderPage([
      rowOf({ tempoHistory: [{ atPlayedMs: 0, tempo: { mode: 'percent', value: 85 } }] }),
    ]);
    services.ui.getState().setScreen('library');
    open.mockImplementation(async () => {
      const { bytes } = await write(fourBars(), 'reprise');
      await services.document.getState().openBytes('song.reprise', bytes, { songId: SONG });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Resume at 85%' }));
    await waitFor(() => {
      expect(services.ui.getState().screen).toBe('player');
    });
    expect(open).toHaveBeenCalledOnce();
    expect(services.playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 85 });
  });

  it('goes back', async () => {
    const { onBack } = await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
