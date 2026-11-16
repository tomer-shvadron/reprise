import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { CHECKPOINT_MS, IDLE_MS } from './accrual';
import { startPracticeCapture, type PracticeCapture } from './capture';
import type { PracticeRepository } from './repository';
import type { PracticeSessionRow } from './row';

const SONG = 'SONGSONGSONG';
let capture: PracticeCapture | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(async () => {
  await capture?.stop();
  capture = undefined;
  vi.useRealTimers();
});

async function setup(options: { unimported?: boolean; song?: Score } = {}) {
  const services = createTestServices();
  mirrorAudio(services);
  const puts: PracticeSessionRow[] = [];
  const repo: PracticeRepository = {
    put: (row) => {
      puts.push(structuredClone(row));
      return Promise.resolve();
    },
    forSong: () => Promise.resolve([]),
  };
  const open = async (name: string, song: Score, unimported = false) => {
    const { bytes } = await write(song, 'reprise');
    await services.document.getState().openBytes(name, bytes, unimported ? {} : { songId: SONG });
  };
  await open('a.reprise', options.song ?? fourBars(), options.unimported);
  capture = startPracticeCapture(services, repo);
  const transport = (state: 'stopped' | 'counting-in' | 'playing' | 'paused') => {
    services.playback.setState({ transport: state });
  };
  const session = () => services.practice.getState().session;
  return { services, puts, open, transport, session };
}

const seconds = (n: number) => vi.advanceTimersByTime(n * 1000);

describe('starting a session', () => {
  it('does not start on open, and starts on the first play', async () => {
    const { session, transport } = await setup();
    expect(session()).toBeUndefined();
    transport('playing');
    expect(session()?.songId).toBe(SONG);
  });

  it('never logs the standalone metronome or the tuner, which have no song transport', async () => {
    const { services, session, puts } = await setup();
    services.playback.setState({
      click: { ...services.playback.getState().click, running: true },
    });
    seconds(60);
    await capture?.flush();
    expect(session()).toBeUndefined();
    expect(puts).toEqual([]);
  });
});

describe('played time', () => {
  it('counts only time spent playing, so the count-in and pauses are left out', async () => {
    const { transport, session } = await setup();
    transport('counting-in');
    seconds(5);
    transport('playing');
    seconds(20);
    transport('paused');
    seconds(100);
    transport('playing');
    seconds(4);
    transport('paused');
    expect(session()?.playedMs).toBe(24_000);
  });

  it('adds up at a checkpoint, and writes after the debounce', async () => {
    const { transport, session, puts } = await setup();
    transport('playing');
    seconds(CHECKPOINT_MS / 1000);
    expect(session()?.playedMs).toBe(CHECKPOINT_MS);
    expect(puts).toEqual([]);
    seconds(1);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ songId: SONG, playedMs: CHECKPOINT_MS });
  });

  it('does nothing on position ticks', async () => {
    const { services, transport, puts, session } = await setup();
    transport('playing');
    const before = session();
    for (let tick = 0; tick < 1000; tick += 1) {
      services.playback.setState({ position: undefined });
    }
    seconds(5);
    expect(session()).toBe(before);
    expect(puts).toEqual([]);
  });
});

describe('writing', () => {
  it('flushes at once on pagehide, with the time played so far', async () => {
    const { transport, puts } = await setup();
    transport('playing');
    seconds(12);
    dispatchEvent(new Event('pagehide'));
    expect(puts).toHaveLength(1);
    expect(puts[0]?.playedMs).toBe(12_000);
  });

  it('flushes when the window is hidden', async () => {
    const { transport, puts } = await setup();
    transport('playing');
    seconds(15);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    expect(puts).toHaveLength(1);
  });

  it('writes nothing for less than 10 s of play, and a completed step is enough', async () => {
    const { services, transport, puts, open } = await setup();
    transport('playing');
    seconds(3);
    transport('paused');
    await open('b.reprise', fourBars());
    expect(puts).toEqual([]);

    transport('playing');
    seconds(2);
    const [first] = services.document.getState().score?.masterBars ?? [];
    services.practice
      .getState()
      .recordStep({ startBar: first?.id ?? '', endBar: first?.id ?? '' }, 90);
    seconds(1);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.loops[0]).toMatchObject({ bestPercent: 90 });
  });

  it('stores a session that was ended by a document switch', async () => {
    const { transport, open, puts, session } = await setup();
    transport('playing');
    seconds(20);
    await open('b.reprise', fourBars());
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ songId: SONG, playedMs: 20_000 });
    expect(session()).toBeUndefined();
  });

  it('does not store a file the library does not hold, until it is imported mid-session', async () => {
    const { services, transport, puts } = await setup({ unimported: true });
    transport('playing');
    seconds(31);
    expect(puts).toEqual([]);
    services.document.getState().setSongId(SONG);
    dispatchEvent(new Event('pagehide'));
    expect(puts).toHaveLength(1);
    expect(puts[0]?.songId).toBe(SONG);
  });
});

describe('a song deleted mid-session', () => {
  it('stops writing once the document has no song, and keeps what was written', async () => {
    const { services, transport, puts } = await setup();
    transport('playing');
    seconds(CHECKPOINT_MS / 1000 + 1);
    expect(puts).toHaveLength(1);
    services.document.getState().setSongId(undefined);
    seconds(CHECKPOINT_MS / 1000);
    dispatchEvent(new Event('pagehide'));
    expect(puts).toHaveLength(1);
  });
});

describe('tempo samples', () => {
  it('are stamped with the time played when the tempo changed, not the last checkpoint', async () => {
    const { services, transport, session } = await setup();
    transport('playing');
    seconds(12);
    services.fakeAudio.setTempo('percent', 80);
    seconds(1);
    expect(session()?.tempoHistory.at(-1)).toMatchObject({ atPlayedMs: 12_500 });
  });
});

describe('ending after idle', () => {
  it('ends after 10 minutes without playing, and the next play is a new session', async () => {
    const { transport, puts, session } = await setup();
    transport('playing');
    seconds(20);
    transport('paused');
    vi.advanceTimersByTime(IDLE_MS);
    expect(session()).toBeUndefined();
    // Let the writes settle: the end is queued behind the debounced write of the same row.
    await vi.advanceTimersByTimeAsync(1);
    const first = puts.at(-1);
    expect(first).toMatchObject({ playedMs: 20_000 });
    // The row ends where play stopped, not when the timer fired.
    expect(first?.endedAt).toBe((first?.startedAt ?? 0) + 20_000);

    transport('playing');
    seconds(15);
    transport('paused');
    dispatchEvent(new Event('pagehide'));
    const second = puts.at(-1);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.playedMs).toBe(15_000);
    expect(new Set(puts.map((row) => row.id)).size).toBe(2);
  });

  it('ends a session whose timer never fired when play starts again', async () => {
    const { transport, puts, session } = await setup();
    transport('playing');
    seconds(20);
    transport('paused');
    vi.setSystemTime(Date.now() + IDLE_MS);
    transport('playing');
    await vi.advanceTimersByTimeAsync(1);
    expect(puts.at(-1)).toMatchObject({ playedMs: 20_000 });
    expect(session()?.playedMs).toBe(0);
  });
});

describe('loops and tempo', () => {
  it('notes the loop on play and on a change while playing, not one set while stopped', async () => {
    const { services, transport, session } = await setup();
    const [first, second, third] = services.document.getState().score?.masterBars ?? [];
    const bars = (a?: { id: string }, b?: { id: string }) => ({
      startBar: a?.id ?? '',
      endBar: b?.id ?? '',
    });
    services.fakeAudio.setLoop(bars(first, first));
    transport('playing');
    expect(session()?.loops).toHaveLength(1);
    services.fakeAudio.setLoop(bars(second, third));
    expect(session()?.loops).toHaveLength(2);
    transport('stopped');
    services.fakeAudio.setLoop(bars(third, third));
    expect(session()?.loops).toHaveLength(2);
  });

  it('notes a loop set while paused when play resumes, as the most recent', async () => {
    const { services, transport, session } = await setup();
    const [first, second, third] = services.document.getState().score?.masterBars ?? [];
    const bars = (a?: { id: string }, b?: { id: string }) => ({
      startBar: a?.id ?? '',
      endBar: b?.id ?? '',
    });
    services.fakeAudio.setLoop(bars(first, first));
    transport('playing');
    seconds(20);
    transport('paused');
    services.fakeAudio.setLoop(bars(second, third));
    expect(session()?.loops).toHaveLength(1);
    transport('playing');
    expect(session()?.loops.map((loop) => loop.startBar)).toEqual([first?.id, second?.id]);
    // Back to the first loop while paused: it becomes the last one, which is what Resume reads.
    transport('paused');
    services.fakeAudio.setLoop(bars(first, first));
    transport('playing');
    expect(session()?.loops.at(-1)?.startBar).toBe(first?.id);
  });

  it('records a tempo only once it has held', async () => {
    const { services, transport, session } = await setup();
    transport('playing');
    for (const value of [90, 92, 95]) {
      services.fakeAudio.setTempo('percent', value);
      seconds(0.1);
    }
    expect(session()?.tempoHistory.map((sample) => sample.tempo.value)).toEqual([100]);
    seconds(1);
    expect(session()?.tempoHistory.map((sample) => sample.tempo.value)).toEqual([100, 95]);
  });
});
