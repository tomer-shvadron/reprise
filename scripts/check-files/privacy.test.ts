/**
 * The privacy rule end to end: a local tab whose every text field and whose file name carry a
 * sentinel, run through `pnpm check:files`; the sentinel must reach no report and no output line.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { writeGp } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { ROOT_DIR } from './files.ts';

const SENTINEL = 'ZQ9SENTINEL';

function sentinelTab(): Uint8Array {
  const text = (field: string): string => `${SENTINEL} ${field} Café`;
  const built = score()
    .meta({
      title: text('title'),
      subtitle: text('subtitle'),
      artist: text('artist'),
      album: text('album'),
      words: text('words'),
      music: text('music'),
      copyright: text('copyright'),
      tab: text('tab'),
      instructions: text('instructions'),
      notices: [text('notice')],
    })
    .track('guitar', { name: text('track') })
    .bar()
    .section(text('section'))
    .beat('2', [note(1, 3)], {
      text: text('beat text'),
      chord: { name: text('chord') },
      lyrics: [text('lyric')],
    })
    .beat('2', [note(2, 5)])
    .build();
  const [track] = built.tracks;
  if (track) track.lyrics = [{ startBar: 0, text: text('lyrics') }];
  return writeGp(built).bytes;
}

/** Every text file under `dir`, with its path, except the exports, which are the tab itself. */
function texts(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !relative(dir, path).startsWith('exports'))
    .map((path) => ({ path: relative(dir, path), text: readFileSync(path, 'utf8') }));
}

let temp: string | undefined;
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});

describe('a local tab', () => {
  it('leaves no trace of its text or file name in any report or output line', () => {
    temp = mkdtempSync(join(tmpdir(), 'check-files-privacy-'));
    const out = join(temp, 'out');
    const tab = join(temp, `${SENTINEL} Song.gp`);
    writeFileSync(tab, sentinelTab());
    const run = spawnSync(
      process.execPath,
      ['scripts/check-files/run.ts', tab, '--only', 'formats'],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: { ...process.env, REPRISE_CHECK_OUT: out, INIT_CWD: ROOT_DIR, CI: '1' },
      },
    );
    const output = `${run.stdout}\n${run.stderr}`;
    expect(output).toContain('local-1 (sha256 ');
    expect(output).not.toContain(SENTINEL);
    const written = texts(out);
    expect(written.map((file) => file.path)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^local[/\\]local-1\.md$/), 'summary.md']),
    );
    for (const file of written) {
      expect(file.path).not.toContain(SENTINEL);
      expect(file.text, file.path).not.toContain(SENTINEL);
    }
  }, 120_000);
});
