import { PICKED_FOLDER_LIMITS } from '@/platform/platform';
import { describe, expect, it } from 'vitest';

import { resolveDrop } from './sources';

// Fake entries, in the shape the browser's directory API hands over.
interface FakeDir {
  name: string;
  children: Fake[];
}
type Fake = FakeDir | { name: string; file: true };

function dir(name: string, ...children: Fake[]): FakeDir {
  return { name, children };
}
const file = (name: string): Fake => ({ name, file: true });

function entryOf(fake: Fake, fetched: string[]): unknown {
  if ('file' in fake) {
    return {
      isDirectory: false,
      isFile: true,
      name: fake.name,
      file: (ok: (value: File) => void) => {
        fetched.push(fake.name);
        ok(new File(['x'], fake.name));
      },
    };
  }
  return {
    isDirectory: true,
    isFile: false,
    name: fake.name,
    createReader: () => {
      let served = false;
      return {
        readEntries: (done: (entries: unknown[]) => void) => {
          const entries = served ? [] : fake.children.map((child) => entryOf(child, fetched));
          served = true;
          done(entries);
        },
      };
    },
  };
}

async function walk(roots: FakeDir[], fetched: string[] = []) {
  return resolveDrop({
    files: [],
    // The fakes carry exactly the members `resolveDrop` calls.
    directories: roots.map((root) => entryOf(root, fetched) as FileSystemDirectoryEntry),
  });
}

describe('resolveDrop', () => {
  it('walks several dropped folders, nested, with paths from each folder', async () => {
    const { sources, truncated } = await walk([
      dir('a', file('one.gp5'), dir('deep', file('two.gp4'))),
      dir('b', file('three.gp3')),
    ]);
    expect(sources.map((source) => source.name)).toEqual([
      'a/one.gp5',
      'a/deep/two.gp4',
      'b/three.gp3',
    ]);
    expect(truncated).toBe(false);
  });

  it('never fetches a file that is not a score, or a dot entry', async () => {
    const fetched: string[] = [];
    const { sources } = await walk(
      [dir('a', file('cover.png'), file('.hidden.gp5'), file('notes.pdf'), file('song.gp5'))],
      fetched,
    );
    expect(fetched).toEqual(['song.gp5']);
    expect(sources).toHaveLength(1);
  });

  it('cuts a folder that is too deep and still lists its siblings and the next folder', async () => {
    let deep: FakeDir = dir('bottom', file('lost.gp5'));
    for (let level = 0; level < PICKED_FOLDER_LIMITS.maxDepth; level += 1)
      deep = dir(`l${String(level)}`, deep);
    const { sources, truncated } = await walk([
      dir('a', deep, file('sibling.gp5')),
      dir('b', file('next.gp5')),
    ]);
    const names = sources.map((source) => source.name);
    expect(names).toContain('a/sibling.gp5');
    expect(names).toContain('b/next.gp5');
    expect(names.some((name) => name.endsWith('lost.gp5'))).toBe(false);
    expect(truncated).toBe(true);
  });

  it('counts only score files toward the cap', async () => {
    const images = Array.from({ length: PICKED_FOLDER_LIMITS.maxFiles + 5 }, (_, n) =>
      file(`image-${String(n)}.png`),
    );
    const { sources, truncated } = await walk([dir('a', ...images, file('last.gp5'))]);
    expect(sources.map((source) => source.name)).toEqual(['a/last.gp5']);
    expect(truncated).toBe(false);
  });

  it('stops at the file cap and says so', async () => {
    const songs = Array.from({ length: PICKED_FOLDER_LIMITS.maxFiles + 3 }, (_, n) =>
      file(`s-${String(n)}.gp5`),
    );
    const { sources, truncated } = await walk([dir('a', ...songs)]);
    expect(sources).toHaveLength(PICKED_FOLDER_LIMITS.maxFiles);
    expect(truncated).toBe(true);
  });
});
