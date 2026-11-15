import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createMemoryStorage } from '@/test/memory-storage';
import { fetchFixture, fixturePaths } from '@/test/assets';

import { createSongsRepository } from '../db/repository';
import { openLibraryDb } from '../db/schema';
import { createLibraryFiles } from '../files';
import { uniqueDbName } from '../test-support';
import { sourceOf } from '../test/songs';
import { createImporter } from './importer';
import { createParser, type Parser } from './parser';

interface FrameStats {
  /** The longest gap between two animation frames, in ms. */
  longestFrame: number;
  /** The longest main-thread task the browser reported, in ms. */
  longestTask: number;
  stop(): void;
}

function watchFrames(): FrameStats {
  const stats: FrameStats = { longestFrame: 0, longestTask: 0, stop: () => undefined };
  let last = performance.now();
  let running = true;
  const tick = (now: number) => {
    if (!running) return;
    stats.longestFrame = Math.max(stats.longestFrame, now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      stats.longestTask = Math.max(stats.longestTask, entry.duration);
    }
  });
  observer.observe({ entryTypes: ['longtask'] });
  stats.stop = () => {
    running = false;
    observer.disconnect();
  };
  return stats;
}

describe('batch import through the real worker', () => {
  it('imports the 27 fixtures and 23 generated songs without blocking the frame loop', async () => {
    const paths = await fixturePaths();
    const sources = await Promise.all(
      paths.map(async (path) => sourceOf(path, await fetchFixture(path))),
    );
    for (let n = 0; sources.length < 50; n += 1) {
      const built = score()
        .title(`Generated ${String(n)}`)
        .track('guitar')
        .build();
      sources.push(
        sourceOf(`generated-${String(n)}.reprise`, (await write(built, 'reprise')).bytes),
      );
    }

    const db = openLibraryDb(uniqueDbName());
    const storage = createMemoryStorage();
    let parses = 0;
    // Every parse goes through the worker client: the importer has no other way to parse.
    const counting = (): Parser => {
      const parser = createParser();
      return {
        ...parser,
        parse: (bytes, title) => {
          parses += 1;
          return parser.parse(bytes, title);
        },
      };
    };
    const importer = createImporter({
      repo: createSongsRepository(db),
      files: createLibraryFiles(storage.calls),
      createParser: counting,
      now: Date.now,
      onAdded: () => undefined,
    });

    const frames = watchFrames();
    const started = performance.now();
    await importer.add(sources);
    const elapsed = performance.now() - started;
    frames.stop();

    const state = importer.store.getState();
    console.info(
      `import: ${String(sources.length)} files in ${elapsed.toFixed(0)} ms, ` +
        `${String(state.imported)} imported, ${String(state.duplicates)} duplicates, ` +
        `${String(state.failed.length)} failed; longest frame gap ${frames.longestFrame.toFixed(1)} ms, ` +
        `longest task ${frames.longestTask.toFixed(1)} ms`,
    );
    expect(parses).toBe(50);
    expect(state.failed).toEqual([]);
    expect(state.imported + state.duplicates).toBe(50);
    // A sanity bound well above what a worker-based import measures; a parse on the main thread
    // of a real song alone is one 87 ms block.
    expect(frames.longestFrame).toBeLessThan(500);
    db.close();
  }, 120_000);
});
