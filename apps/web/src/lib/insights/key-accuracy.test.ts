import { describe, expect, it } from 'vitest';

import { ALL_FACTORS, type HistogramOptions } from './histogram';
import { detectKey } from './key';
import { PROFILE_SETS } from './key-profiles';
import { noteTableOf } from './note-table';
import { formOf, generatedCorpus, type Group, type Piece } from './test/corpus';
import { isExact, mirexScore } from './test/mirex';
import { TUNES } from './test/tunes';

const corpus = generatedCorpus();
const tables = new Map<Piece, ReturnType<typeof noteTableOf>>(
  corpus.map((piece) => [piece, noteTableOf(piece.score)]),
);

/**
 * Forms the engine gets wrong, with what it says. They stay in the accuracy table; the test below
 * pins each miss so that a change in either direction shows. The weights were not tuned on them.
 * Leaving this one is a choice for v1, not a verdict that the engine is right: at "medium"
 * confidence, with the minor key as the runner-up, the card shows both readings.
 */
const KNOWN_MISSES: Record<string, string> = {
  // A loop that starts on i and stops on bVII is also III-VII-i-VI: the relative major reads as
  // well as the minor, and the bass evidence (the first note and a quarter of the downbeats) is
  // not enough to turn it. The engine says the relative major.
  'i-bVI-bIII-bVII loop ending on bVII': 'relative major',
};

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
  const forms = new Set(corpus.map(formOf));

  it('prints the accuracy per profile set and per factor', () => {
    const lines = [
      '',
      `corpus: ${String(corpus.length)} pieces, ${String(forms.size)} forms, each voiced differently in 12 tonics`,
    ];
    lines.push('| profile set | factors | exact | MIREX |', '| --- | --- | --- | --- |');
    for (const set of PROFILE_SETS) {
      const cued = tally(corpus, set.id);
      lines.push(
        `| ${set.name} | default factors and bass evidence | ${percent(cued.exact, cued.count)} | ${percent(cued.mirex, cued.count)} |`,
      );
      // Without the bass evidence, the table shows what each factor does to the correlation alone.
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

  it('gets every form right except the documented misses', () => {
    for (const form of forms) {
      const pieces = corpus.filter((piece) => formOf(piece) === form);
      const t = tally(pieces, 'krumhanslKessler');
      if (form in KNOWN_MISSES) expect(t.exact, `${form} should still miss`).toBe(0);
      else expect(t.exact, form).toBe(t.count);
    }
  });

  it('pins the known misses to what the engine says', () => {
    for (const piece of corpus.filter((p) => formOf(p) in KNOWN_MISSES)) {
      const key = detectKey(tables.get(piece) ?? noteTableOf(piece.score));
      // The relative major of the expected minor key.
      expect(key.found && [key.tonic, key.quality]).toEqual([
        (piece.expected.tonic + 3) % 12,
        'major',
      ]);
      expect(key.found && key.confidence).not.toBe('high');
      expect(key.found && [key.runnerUp.tonic, key.runnerUp.quality]).toEqual([
        piece.expected.tonic,
        'minor',
      ]);
    }
  });

  it('names the scale of every piece that has one', () => {
    for (const piece of corpus) {
      if (!piece.expected.scale) continue;
      const key = detectKey(tables.get(piece) ?? noteTableOf(piece.score));
      expect(key.found && key.scale?.scale, piece.name).toBe(piece.expected.scale);
    }
  });

  it('notices the mixed thirds of a blues', () => {
    for (const piece of corpus.filter((p) => p.expected.mixedThirds)) {
      const key = detectKey(tables.get(piece) ?? noteTableOf(piece.score));
      expect(key.found && key.scale?.mixedThirds, piece.name).toBe(true);
    }
  });

  it('keeps the defaults ahead of their ablations and of the other profile sets', () => {
    const base = tally(corpus, 'krumhanslKessler', {}, false);
    for (const [label, factors] of FACTORS.filter(([name]) => name.startsWith('no '))) {
      const ablated = tally(corpus, 'krumhanslKessler', factors, false);
      expect(base.exact, label).toBeGreaterThanOrEqual(ablated.exact);
      expect(base.mirex, label).toBeGreaterThanOrEqual(ablated.mirex);
    }
    const full = tally(corpus, 'krumhanslKessler');
    for (const set of PROFILE_SETS) {
      const other = tally(corpus, set.id);
      expect(full.exact, set.name).toBeGreaterThanOrEqual(other.exact);
      expect(full.mirex, set.name).toBeGreaterThanOrEqual(other.mirex);
    }
  });
});

describe('the weight of the bass evidence', () => {
  // The weights sit on a plateau: this range changes no answer on the corpus or the tunes.
  const answers = (scale: number) =>
    [
      ...corpus.map((p) => tables.get(p) ?? noteTableOf(p.score)),
      ...TUNES.map((t) => noteTableOf(t.score)),
    ].map((table) => {
      const key = detectKey(table, { cueScale: scale });
      return key.found ? [key.tonic, key.quality] : undefined;
    });

  it.each([0.75, 1.25, 1.5])('gives the same answers at x%s', (scale) => {
    expect(answers(scale)).toEqual(answers(1));
  });
});

describe('key of public-domain tunes', () => {
  it.each(TUNES)('$name', ({ expected, known, score }) => {
    const key = detectKey(noteTableOf(score));
    expect(key.found).toBe(true);
    if (!key.found) return;
    const wanted = known ?? expected;
    expect({ tonic: key.tonic, quality: key.quality }).toEqual({
      tonic: wanted.tonic,
      quality: wanted.quality,
    });
    const scale = known?.scale ?? expected.scale;
    if (scale) expect(key.scale?.scale).toBe(scale);
  });
});
