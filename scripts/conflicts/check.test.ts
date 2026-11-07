import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { findMarkers, isAllowed, isBinary, staleEntries } from './check.ts';

// Built at run time, so no line of this file holds a marker and it passes the check itself.
const CLI = fileURLToPath(new URL('check.ts', import.meta.url));
const LT = '<'.repeat(7);
const EQ = '='.repeat(7);
const GT = '>'.repeat(7);
const BAR = '|'.repeat(7);
const QUOTES = Array.from({ length: 7 }, () => '>').join(' ');

const conflict = (diff3: boolean): string[] => [
  `${LT} HEAD`,
  'ours',
  ...(diff3 ? [`${BAR} base`, 'ancestor'] : []),
  EQ,
  'theirs',
  `${GT} branch`,
];

const rules = (path: string, lines: readonly string[], eol = '\n'): [number, string][] =>
  findMarkers(path, lines.join(eol)).map(({ line, rule }) => [line, rule]);

const EOLS: readonly (readonly [string, string])[] = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
];

describe('raw markers', () => {
  const paths = [
    'a.ts',
    'a.tsx',
    'a.js',
    'a.json',
    'a.md',
    'a.yml',
    'a.yaml',
    'a.css',
    'a.html',
    'a.txt',
    'a.sh',
    'src/__snapshots__/a.test.ts.snap',
    '.gitignore',
    '.husky/pre-commit',
    'docs/a.md',
  ];
  const cases = paths.flatMap((path) =>
    [false, true].flatMap((diff3) => EOLS.map(([name, eol]) => ({ path, diff3, name, eol }))),
  );

  it.each(cases)(
    'flags every marker in $path (diff3 $diff3, $name)',
    ({ path, diff3, name, eol }) => {
      expect(eol).toBe(name === 'CRLF' ? '\r\n' : '\n');
      const lines = ['before', ...conflict(diff3), 'after'];
      const expected = lines.flatMap((line, index): [number, string][] =>
        /^[<=>|]{7}/.test(line) ? [[index + 1, 'raw']] : [],
      );
      expect(rules(path, lines, eol)).toEqual(expected);
    },
  );
});

describe('forms Prettier wrote', () => {
  it('finds the shape of the packages/layout/README.md damage', () => {
    expect(
      rules('a.md', [
        `${LT} HEAD`,
        '',
        '| Decision | Why |',
        '| -------- | --- |',
        '| ours     | x   |',
        `| ${EQ}  |`,
        '| theirs   | y   |',
        '',
        `${QUOTES} origin/main`,
      ]),
    ).toEqual([
      [1, 'raw'],
      [6, 'markdown-nested'],
      [9, 'markdown-quote-run'],
    ]);
  });

  it('finds a rewritten table, and not the row the quote swallowed', () => {
    expect(
      rules('a.md', [
        '| a            | b   |',
        '| ------------ | --- |',
        `| ${LT} HEAD |`,
        '| ours         | y   |',
        `| ${EQ}      |`,
        '| theirs       | y   |',
        '',
        `${QUOTES} branch`,
        `${QUOTES} | 2 | z |`,
      ]),
    ).toEqual([
      [3, 'markdown-nested'],
      [5, 'markdown-nested'],
      [8, 'markdown-quote-run'],
    ]);
  });

  it('finds a diff3 base split into empty cells', () => {
    expect(
      rules('a.md', ['| ours | y |', '|  |     |     |     |     |     | base |', '| x | y |']),
    ).toEqual([[2, 'markdown-table-run']]);
  });

  it('finds markers in a bullet list', () => {
    expect(
      rules('a.md', ['- one', `  ${LT} HEAD`, '  ours', `  \\${EQ}`, '  theirs', `${QUOTES} b`]),
    ).toEqual([
      [2, 'markdown-nested'],
      [4, 'markdown-nested'],
      [6, 'markdown-quote-run'],
    ]);
  });

  it('finds markers in ordered and nested lists', () => {
    expect(
      rules('a.md', ['1. one', `   ${LT} HEAD`, `   \\${EQ}`, '   - two', `     ${BAR} base`]),
    ).toEqual([
      [2, 'markdown-nested'],
      [3, 'markdown-nested'],
      [5, 'markdown-nested'],
    ]);
  });

  it('finds markers in a diff3 blockquote', () => {
    expect(
      rules('a.md', [
        '> intro',
        `> ${LT} HEAD`,
        '> ours',
        `> ${BAR} base`,
        '> ancestor',
        `> \\${EQ}`,
        '>',
        '> theirs',
        '>',
        `> ${QUOTES} branch`,
      ]),
    ).toEqual([
      [2, 'markdown-nested'],
      [4, 'markdown-nested'],
      [6, 'markdown-nested'],
      [10, 'markdown-quote-run'],
    ]);
  });

  it('finds a marker behind a heading', () => {
    expect(rules('a.md', [`# ${LT} HEAD ours`])).toEqual([[1, 'markdown-nested']]);
  });

  it('finds the joined and the indented HTML lines', () => {
    expect(
      rules('a.html', [
        '<body>',
        `  <p>hello ${LT} HEAD ours ${BAR} base ancestor ${EQ} theirs ${GT} branch</p>`,
        `    ${LT} HEAD`,
        `    ${EQ}`,
        `    ${GT} branch`,
        '</body>',
      ]),
    ).toEqual([
      [2, 'html-inline'],
      [3, 'html-inline'],
      [4, 'html-inline'],
      [5, 'html-inline'],
    ]);
  });

  it('keeps the Markdown rules in Markdown', () => {
    expect(
      rules('a.ts', [
        `| ${LT} HEAD |`,
        `  \\${EQ}`,
        `> ${BAR} base`,
        `${QUOTES} branch`,
        '|  |  |  |  |  |  | base |',
      ]),
    ).toEqual([]);
  });

  it('flags a setext underline of exactly seven, by design', () => {
    expect(rules('a.md', ['Title', EQ])).toEqual([[2, 'raw']]);
  });

  it('flags a Markdown run of eight or more > or |, which the nesting prefix absorbs, by design', () => {
    expect(
      rules('a.md', ['>'.repeat(8) + ' x', '|'.repeat(8), '<'.repeat(8), '='.repeat(8)]),
    ).toEqual([
      [1, 'markdown-nested'],
      [2, 'markdown-nested'],
    ]);
  });
});

describe('the command line', () => {
  const run = (name: string, content: string | Uint8Array) => {
    const dir = mkdtempSync(join(tmpdir(), 'conflicts-'));
    const file = join(dir, name);
    writeFileSync(file, content);
    const result = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    return result;
  };

  it('exits non-zero on a file with a marker', () => {
    const { status, stderr } = run('a.txt', ['ours', EQ, 'theirs', ''].join('\n'));
    expect(status).toBe(1);
    expect(stderr).toMatch(/a\.txt:2: ={7} \(raw\)/);
  });

  it('skips a binary file', () => {
    const { status, stdout } = run('a.bin', Buffer.from(`\0${EQ}\n`));
    expect(status).toBe(0);
    expect(stdout).toContain('No conflict markers in 0 text files.');
  });

  it('passes a clean file', () => {
    const { status, stdout } = run('a.txt', 'clean\n');
    expect(status).toBe(0);
    expect(stdout).toContain('No conflict markers in 1 text files.');
  });
});

describe('look-alikes', () => {
  it.each([
    ['a.txt', ['='.repeat(34)]],
    ['a.md', ['Title', '='.repeat(6), 'Other', '='.repeat(8)]],
    ['a.txt', ['<'.repeat(6), '<'.repeat(8), '>'.repeat(8)]],
    ['a.txt', [`${LT}HEAD`, `${EQ}>`]],
    ['a.md', [`Git writes \`${LT}\` and \`${EQ}\`.`, `| \`${GT}\` | end |`, `- \`${BAR}\` base`]],
    ['a.md', ['> > two', `${Array.from({ length: 6 }, () => '>').join(' ')} six`]],
    ['a.md', ['| a |  |  | b |', '|  |  |  |  |  | x |', '| --- | --- |']],
    ['a.ts', ['a >>> 2', 'type T = Map<string, Array<Set<number>>>;', `  // ${EQ} section`]],
    ['a.html', ['<!-- ====== -->', '<p>&lt;&lt;</p>']],
  ])('passes %s %j', (path, lines) => {
    expect(rules(path, lines)).toEqual([]);
  });
});

describe('every marker Prettier rewrites is still found', () => {
  const md = {
    table: (lines: string[]) => [
      '| a | b |',
      '| - | - |',
      '| 1 | x |',
      ...lines.map((line) => (/^[<=>|]{7}/.test(line) ? line : `| ${line} | y |`)),
      '| 2 | z |',
    ],
    'bullet list': (lines: string[]) => ['- one', ...lines.map((line) => `  ${line}`), '- two'],
    'ordered list': (lines: string[]) => ['1. one', ...lines.map((line) => `   ${line}`), '2. two'],
    quote: (lines: string[]) => ['> intro', ...lines.map((line) => `> ${line}`)],
    paragraph: (lines: string[]) => ['Some text', ...lines, 'more text'],
    'own paragraph': (lines: string[]) => ['Some text', '', ...lines, '', 'more text'],
  };
  const html = {
    'inside a p': (lines: string[]) => ['<body>', '<p>hello', ...lines, '</p>', '</body>'],
    'between body children': (lines: string[]) => [
      '<body>',
      '<p>a</p>',
      ...lines.map((line) => (/^[<=>|]{7}/.test(line) ? line : `<p>${line}</p>`)),
      '<p>b</p>',
      '</body>',
    ],
    'inside head': (lines: string[]) => [
      '<html>',
      '<head>',
      ...lines.map((line) => (/^[<=>|]{7}/.test(line) ? line : `<title>${line}</title>`)),
      '</head>',
      '</html>',
    ],
  };
  const cases = [
    ...Object.entries(md).map(([name, wrap]) => ({ name, wrap, filepath: 'a.md' })),
    ...Object.entries(html).map(([name, wrap]) => ({ name, wrap, filepath: 'a.html' })),
  ].flatMap((context) => [false, true].map((diff3) => ({ ...context, diff3 })));

  it.each(cases)('$filepath $name (diff3 $diff3)', async ({ wrap, filepath, diff3 }) => {
    const raw = `${wrap(conflict(diff3)).join('\n')}\n`;
    expect(findMarkers(filepath, raw)).toHaveLength(diff3 ? 4 : 3);
    const config = (await resolveConfig(import.meta.filename)) ?? {};
    const formatted = await format(raw, { ...config, filepath });
    const texts = findMarkers(filepath, formatted).map(({ text }) => text);
    for (const label of ['HEAD', ...(diff3 ? ['base'] : []), EQ, 'branch']) {
      expect(texts.some((text) => text.includes(label))).toBe(true);
    }
  });
});

describe('isBinary', () => {
  it('counts a NUL in the first 8000 bytes as binary', () => {
    const content = new Uint8Array(9000).fill(65);
    content[7999] = 0;
    expect(isBinary(content)).toBe(true);
  });

  it('ignores a NUL after the first 8000 bytes', () => {
    const content = new Uint8Array(9000).fill(65);
    content[8000] = 0;
    expect(isBinary(content)).toBe(false);
  });
});

describe('the allow-list', () => {
  it('matches an exact path and a directory prefix', () => {
    expect(isAllowed('a/b.md', ['a/b.md'])).toBe(true);
    expect(isAllowed('docs/x/y.md', ['docs/'])).toBe(true);
  });

  it('matches no false prefix and nothing when empty', () => {
    expect(isAllowed('docsx/y.md', ['docs/'])).toBe(false);
    expect(isAllowed('a/b.md.bak', ['a/b.md'])).toBe(false);
    expect(isAllowed('a.md', [])).toBe(false);
  });

  it('reports entries that match no tracked file', () => {
    expect(staleEntries(['a/b.md', 'c.md'], ['a/', 'c.md', 'gone.md', 'old/'])).toEqual([
      'gone.md',
      'old/',
    ]);
  });
});
