import { midiNote } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { Sampler } from '../sampler/sampler';
import { offline } from '../sampler/test/offline';
import { ManagedSampleSource, bufferBytes } from './managed-sample-source';
import type { MemoryStats } from './managed-sample-source';
import { SyntheticProvider } from './test/synthetic';
import type { SyntheticOptions } from './test/synthetic';
import type { SampleProvider } from './types';

const factory = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
/** Four zones of 32 keys, 4,000 decoded bytes each. */
const ZONE = 4000;

function small(options: SyntheticOptions = {}): SyntheticProvider {
  return new SyntheticProvider({ zoneWidth: 32, instrumentBytes: () => 4 * ZONE, ...options });
}

function manualFrames(): { schedule: (callback: () => void) => void; flush: () => void } {
  const queue: (() => void)[] = [];
  return {
    schedule: (callback) => queue.push(callback),
    flush: () => {
      for (const callback of queue.splice(0)) callback();
    },
  };
}

const songA = score()
  .track('guitar')
  .bar()
  .beat('1', [note(1, 0)])
  .track('bass')
  .bar()
  .beat('1', [note(4, 0)])
  .build();
const songB = score()
  .track('guitar')
  .bar()
  .beat('1', [note(1, 0)])
  .track('piano', { program: 0 })
  .bar()
  .beat('1', [midi(60)])
  .build();

describe('ManagedSampleSource accounting', () => {
  it('counts channels by length by four bytes for every resident buffer', async () => {
    const provider = small({ channels: 2, sampleRate: 22_050 });
    const source = new ManagedSampleSource(provider, factory);
    const buffers = await Promise.all(
      ['gm:0:25#0', 'gm:0:25#1', 'gm:0:33#2'].map((ref) => source.getBuffer(ref)),
    );

    for (const buffer of buffers) {
      expect(buffer.numberOfChannels).toBe(2);
      expect(buffer.sampleRate).toBe(22_050);
      expect(bufferBytes(buffer)).toBe(2 * buffer.length * 4);
    }
    const total = buffers.reduce((sum, buffer) => sum + bufferBytes(buffer), 0);
    expect(total).toBe(3 * ZONE);
    expect(source.memory()).toEqual({
      decodedBytes: total,
      budgetBytes: source.budgetBytes,
      residents: ['gm:0:25', 'gm:0:33'],
    });
  });

  it('copies the raw channels into the buffer', async () => {
    const provider: SampleProvider = {
      instrumentOf: () => 'gm:0:0',
      byteLength: () => 24,
      fetch: () =>
        Promise.resolve({
          sampleRate: 48_000,
          channels: [Float32Array.of(0.5, -0.5, 0.25), Float32Array.of(0, 1, -1)],
          loop: { start: 1, end: 2 },
          byteLength: 12,
        }),
    };
    const buffer = await new ManagedSampleSource(provider, factory).getBuffer('x');
    expect([...buffer.getChannelData(0)]).toEqual([0.5, -0.5, 0.25]);
    expect([...buffer.getChannelData(1)]).toEqual([0, 1, -1]);
    expect(buffer.sampleRate).toBe(48_000);
  });

  it('fetches a sample once however many ask for it at the same time', async () => {
    const provider = small({ deferred: true });
    const source = new ManagedSampleSource(provider, factory);
    const loads = [source.getBuffer('gm:0:25#1'), source.getBuffer('gm:0:25#1')];
    loads.push(source.getBuffer('gm:0:25#1'));
    expect(source.peekBuffer('gm:0:25#1')).toBeUndefined();
    provider.release();
    const [first, ...rest] = await Promise.all(loads);

    expect(provider.fetched).toEqual(['gm:0:25#1']);
    for (const buffer of rest) expect(buffer).toBe(first);
    expect(source.peekBuffer('gm:0:25#1')).toBe(first);
    await source.getBuffer('gm:0:25#1');
    expect(source.counters.fetches).toBe(1);
  });

  it('rejects a failed fetch, accounts nothing for it and retries on the next request', async () => {
    const provider = small();
    provider.failing.add('gm:0:25#0');
    const source = new ManagedSampleSource(provider, factory);
    await expect(source.getBuffer('gm:0:25#0')).rejects.toThrow('Cannot read');
    expect(source.memory().decodedBytes).toBe(0);

    provider.failing.clear();
    await source.getBuffer('gm:0:25#0');
    expect(source.memory().decodedBytes).toBe(ZONE);
    expect(source.counters.fetches).toBe(2);
  });
});

describe('ManagedSampleSource eviction', () => {
  it('evicts the least recently peeked instrument', async () => {
    const provider = small();
    const untouched = new ManagedSampleSource(provider, factory, { budgetBytes: 2 * ZONE });
    await untouched.getBuffer('a#0');
    await untouched.getBuffer('b#0');
    await untouched.getBuffer('c#0');
    expect(untouched.memory().residents).toEqual(['b', 'c']);

    const touched = new ManagedSampleSource(provider, factory, { budgetBytes: 2 * ZONE });
    await touched.getBuffer('a#0');
    await touched.getBuffer('b#0');
    expect(touched.peekBuffer('a#0')).toBeDefined();
    await touched.getBuffer('c#0');
    expect(touched.memory().residents).toEqual(['a', 'c']);
    expect(touched.peekBuffer('b#0')).toBeUndefined();
  });

  it('evicts whole instruments, every sample of one at a time', async () => {
    const source = new ManagedSampleSource(small(), factory, { budgetBytes: 3 * ZONE });
    for (const ref of ['a#0', 'a#1', 'b#0', 'c#0']) await source.getBuffer(ref);

    expect(source.memory()).toMatchObject({ decodedBytes: 2 * ZONE, residents: ['b', 'c'] });
    expect(source.peekBuffer('a#0')).toBeUndefined();
    expect(source.peekBuffer('a#1')).toBeUndefined();
    expect(source.counters.evictions).toBe(1);
  });

  it('reserves room for loads in flight, so a burst cannot overshoot the budget', async () => {
    const provider = small({ deferred: true });
    const source = new ManagedSampleSource(provider, factory, { budgetBytes: 2 * ZONE });
    const first = Promise.all([source.getBuffer('a#0'), source.getBuffer('b#0')]);
    provider.release();
    await first;

    const burst = Promise.all([source.getBuffer('c#0'), source.getBuffer('d#0')]);
    expect(source.memory().residents).toEqual([]);
    provider.release();
    await burst;
    expect(source.memory()).toMatchObject({ decodedBytes: 2 * ZONE, residents: ['c', 'd'] });
  });

  it("evicts song A's instruments that song B does not share on a song switch", async () => {
    const provider = small();
    const source = new ManagedSampleSource(provider, factory);
    await source.load(songA, provider.regionMap);
    expect(source.memory().residents).toEqual(['gm:0:25', 'gm:0:33']);
    const shared = source.peekBuffer(provider.ref('gm:0:25', 64));

    await source.load(songB, provider.regionMap);
    expect(source.memory().residents).toEqual(['gm:0:0', 'gm:0:25']);
    expect(source.peekBuffer(provider.ref('gm:0:25', 64))).toBe(shared);
    expect(provider.fetched.filter((ref) => ref.startsWith('gm:0:25#'))).toHaveLength(1);
    expect(source.counters.pinnedEvictions).toBe(0);
  });

  it("prefers a leftover over the current song's instruments, however recent", async () => {
    const provider = small();
    const source = new ManagedSampleSource(provider, factory);
    await source.load(songA, provider.regionMap);
    await source.getBuffer('gm:0:80#2');
    source.peekBuffer('gm:0:80#2');

    source.budgetBytes = source.memory().decodedBytes - 1;
    expect(source.memory().residents).toEqual(['gm:0:25', 'gm:0:33']);
    expect(source.counters.pinnedEvictions).toBe(0);
  });

  it('degrades below the needs of the song: skips, reloads on demand, never throws', async () => {
    const provider = small();
    const source = new ManagedSampleSource(provider, factory, { budgetBytes: ZONE });
    const [guitar, bass] = songA.tracks;
    if (!guitar || !bass) throw new Error('song A has two tracks');
    await expect(source.load(songA, provider.regionMap)).resolves.toBeDefined();
    expect(source.memory().decodedBytes).toBeLessThanOrEqual(ZONE);

    const misses: string[] = [];
    const sampler = new Sampler(offline(1), { onMiss: (_, sample) => misses.push(sample) });
    sampler.addTrack(guitar, { regions: provider.regionMap('gm:0:25'), source });
    sampler.addTrack(bass, { regions: provider.regionMap('gm:0:33'), source });
    const notes = [
      { track: guitar, key: midiNote(guitar, note(1, 0)) },
      { track: bass, key: midiNote(bass, note(4, 0)) },
    ];
    const guitarResident = source.peekBuffer(provider.ref('gm:0:25', 64)) !== undefined;
    const resident = notes[guitarResident ? 0 : 1];
    const evicted = notes[guitarResident ? 1 : 0];
    if (!resident || !evicted) throw new Error('two notes');
    const play = ({ track, key }: typeof resident) =>
      sampler.noteOn(track.id, { key, velocity: 96, when: 0 });

    expect(play(resident)).toBeDefined();
    expect(play(evicted)).toBeUndefined();
    expect(misses).toHaveLength(1);

    await source.getBuffer(misses[0] ?? '');
    expect(play(evicted)).toBeDefined();
    expect(play(resident)).toBeUndefined();
    expect(source.memory().decodedBytes).toBeLessThanOrEqual(ZONE);
    expect(source.counters.pinnedEvictions).toBeGreaterThan(0);
  });

  it('keeps the instrument being loaded when it alone exceeds the budget', async () => {
    const source = new ManagedSampleSource(small(), factory, { budgetBytes: ZONE - 1 });
    const buffer = await source.getBuffer('a#0');
    expect(source.peekBuffer('a#0')).toBe(buffer);
    await source.getBuffer('b#0');
    expect(source.memory().residents).toEqual(['b']);
  });
});

describe('ManagedSampleSource budget and events', () => {
  it('reads and sets the budget at runtime, evicting down at once', async () => {
    const source = new ManagedSampleSource(small(), factory, { budgetBytes: 10 * ZONE });
    for (const ref of ['a#0', 'b#0', 'c#0']) await source.getBuffer(ref);
    expect(source.budgetBytes).toBe(10 * ZONE);

    source.budgetBytes = ZONE;
    expect(source.memory()).toEqual({ decodedBytes: ZONE, budgetBytes: ZONE, residents: ['c'] });
    expect(() => {
      source.budgetBytes = -1;
    }).toThrow(RangeError);
  });

  it('coalesces changes into one memory event per frame, and none for a touch', async () => {
    const frames = manualFrames();
    const source = new ManagedSampleSource(small(), factory, { schedule: frames.schedule });
    const events: MemoryStats[] = [];
    const unsubscribe = source.on('memory', (stats) => events.push(stats));

    await Promise.all(['a#0', 'a#1', 'b#0'].map((ref) => source.getBuffer(ref)));
    frames.flush();
    expect(events).toEqual([source.memory()]);
    expect(events[0]?.decodedBytes).toBe(3 * ZONE);

    source.peekBuffer('a#0');
    frames.flush();
    expect(events).toHaveLength(1);

    source.budgetBytes = 2 * ZONE;
    frames.flush();
    expect(events.at(-1)).toEqual({
      decodedBytes: 2 * ZONE,
      budgetBytes: 2 * ZONE,
      residents: ['a'],
    });

    unsubscribe();
    source.budgetBytes = 0;
    frames.flush();
    expect(events).toHaveLength(2);
  });

  it('fires on the next animation frame by default', async () => {
    const source = new ManagedSampleSource(small(), factory);
    const event = new Promise<MemoryStats>((resolve) => {
      source.on('memory', resolve);
    });
    await source.getBuffer('a#0');
    expect((await event).decodedBytes).toBe(ZONE);
  });

  it('accounts nothing for a load that lands after dispose', async () => {
    const provider = small({ deferred: true });
    const source = new ManagedSampleSource(provider, factory);
    const load = source.getBuffer('a#0');
    source.dispose();
    provider.release();
    await load;
    expect(source.memory()).toMatchObject({ decodedBytes: 0, residents: [] });
  });
});

describe('ManagedSampleSource.load', () => {
  it('decodes only what the opening bars need, so they play without a miss', async () => {
    const provider = small({ zoneWidth: 16 });
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [note(6, 0)])
      .beat('2', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 24)])
      .build();
    const [guitar] = song.tracks;
    if (!guitar) throw new Error('one track');
    const source = new ManagedSampleSource(provider, factory);
    const plan = await source.load(song, provider.regionMap, { bars: 1, warm: false });

    expect(plan.tracks[0]?.uses[0]?.keys).toEqual([40, 64, 88]);
    expect(provider.fetched.sort()).toEqual(['gm:0:25#2', 'gm:0:25#4']);
    const misses: string[] = [];
    const sampler = new Sampler(offline(1), { onMiss: (_, sample) => misses.push(sample) });
    sampler.addTrack(guitar, { regions: provider.regionMap('gm:0:25'), source });
    for (const key of [40, 64]) sampler.noteOn(guitar.id, { key, velocity: 96, when: 0 });
    expect(misses).toEqual([]);
    sampler.noteOn(guitar.id, { key: 88, velocity: 96, when: 0 });
    expect(misses).toEqual(['gm:0:25#5']);
  });

  it('warms the rest of the song in the background', async () => {
    const provider = small({ zoneWidth: 16 });
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(6, 0)])
      .bar()
      .beat('1', [note(1, 24)])
      .build();
    const source = new ManagedSampleSource(provider, factory);
    await source.load(song, provider.regionMap, { bars: 1 });
    await source.settled();
    expect(provider.fetched.sort()).toEqual(['gm:0:25#2', 'gm:0:25#5']);
    expect(source.peekBuffer('gm:0:25#5')).toBeDefined();
  });
});
