import { describe, expect, it } from 'vitest';

import { ALL_FACTORS, type HistogramOptions } from './histogram';
import { detectKey } from './key';
import { PROFILE_SETS } from './key-profiles';
import { noteTableOf } from './note-table';
import { fitScale } from './scale-fit';
import { generatedCorpus, type Group, type Piece } from './test/corpus';
import { isExact, mirexScore } from './test/mirex';
import { TUNES } from './test/tunes';

const corpus = generatedCorpus();
const tables = new Map<Piece, ReturnType<typeof noteTableOf>>(
  corpus.map((piece) => [piece, noteTableOf(piece.score)]),
);

interface Tally {
  exact: number;
  mirex: number;
  count: number;
}

function tally(
  pieces: readonly Piece[],
  profiles: (typeof PROFILE_SETS)[number]['id'],
  factors: Partial<HistogramOptions> = {},
  cues = true,
): Tally {
  const result = { exact: 0, mirex: 0, count: 0 };
  for (const piece of pieces) {
    const table = tables.get(piece);
    if (!table) continue;
    const key = detectKey(table, { profiles, factors, cues });
    const detected = key.found ? { tonic: key.tonic, quality: key.quality } : undefined;
    result.count++;
    result.mirex += mirexScore(piece.expected, detected);
    if (isExact(piece.expected, detected)) result.exact++;
  }
  return result;
}

const percent = (value: number, count: number): string => `${((100 * value) / count).toFixed(1)}%`;
const GROUPS: Group[] = [
  'scale',
  'cadence',
  'progression',
  'vamp',
  'solo',
  'power chord',
  'ornamented',
];

const FACTORS: [string, Partial<HistogramOptions>][] = [
  ['default factors (no metric accent)', {}],
  ['with metric accent', { metric: true }],
  ['no duration', { duration: false }],
  ['no bass factor', { bass: false }],
  ['no track normalisation', { normaliseTracks: false }],
];

describe('key accuracy on the generated corpus', () => {
  it('prints the accuracy per profile set and per factor', () => {
    const lines = ['', `corpus: ${String(corpus.length)} pieces in 12 tonics`];
    lines.push('| profile set | factors | exact | MIREX |', '| --- | --- | --- | --- |');
    for (const set of PROFILE_SETS) {
      const cued = tally(corpus, set.id);
      lines.push(
        `| ${set.name} | default factors and tonic cues | ${percent(cued.exact, cued.count)} | ${percent(cued.mirex, cued.count)} |`,
      );
      // Without the cues, the table shows what each factor does to the correlation alone.
      for (const [label, factors] of FACTORS) {
        const t = tally(corpus, set.id, factors, false);
        lines.push(
          `| ${set.name} | ${label}, correlation only | ${percent(t.exact, t.count)} | ${percent(t.mirex, t.count)} |`,
        );
      }
    }
    lines.push(
      '',
      '| profile set | ' + GROUPS.join(' | ') + ' |',
      `| --- |${' --- |'.repeat(GROUPS.length)}`,
    );
    for (const set of PROFILE_SETS) {
      const cells = GROUPS.map((group) => {
        const t = tally(
          corpus.filter((piece) => piece.group === group),
          set.id,
        );
        return `${percent(t.exact, t.count)} / ${percent(t.mirex, t.count)}`;
      });
      lines.push(`| ${set.name} | ${cells.join(' | ')} |`);
    }
    // The table is the issue's accuracy report; the PR body pastes it.
    console.info(lines.join('\n'));
    expect(ALL_FACTORS.metric).toBe(true);
  });

  it.each(['scale', 'cadence'] as const)(
    'gets every %s piece right with the default profiles',
    (group) => {
      const pieces = corpus.filter((piece) => piece.group === group);
      const t = tally(pieces, 'krumhanslKessler');
      expect(t.exact, `${String(t.exact)} of ${String(t.count)}`).toBe(t.count);
    },
  );

  it('gets 95% of the progressions, vamps, solos and riffs with the default profiles', () => {
    const pieces = corpus.filter((piece) => !['scale', 'cadence'].includes(piece.group));
    const t = tally(pieces, 'krumhanslKessler');
    expect(t.exact / t.count, `${String(t.exact)} of ${String(t.count)}`).toBeGreaterThanOrEqual(
      0.95,
    );
  });

  it('names the scale of every vamp and solo', () => {
    for (const piece of corpus) {
      if (!piece.expected.scale) continue;
      const key = detectKey(tables.get(piece) ?? noteTableOf(piece.score));
      expect(key.found && key.scale?.scale, piece.name).toBe(piece.expected.scale);
    }
  });
});

describe('key of public-domain tunes', () => {
  it.each(TUNES)('$name', ({ expected, score }) => {
    const key = detectKey(noteTableOf(score));
    expect(key.found).toBe(true);
    if (!key.found) return;
    expect({ tonic: key.tonic, quality: key.quality }).toEqual({
      tonic: expected.tonic,
      quality: expected.quality,
    });
    if (expected.scale) expect(key.scale?.scale).toBe(expected.scale);
  });

  it('fits a scale to a histogram directly', () => {
    const key = detectKey(noteTableOf(TUNES[0]?.score ?? corpus[0]?.score ?? ({} as never)));
    expect(key.found && fitScale(key.histogram, key.tonic)).toBeTruthy();
  });
});
