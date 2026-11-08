import { describe, expect, it } from 'vitest';

import { formatDifference } from './compare';
import { HAND_BUILT, type HandBuilt } from './hand-built';
import { TOLERANCES, toleranceFor, type Tolerance } from './tolerances';

const tolerance = (id: string): Tolerance => {
  const found = TOLERANCES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no tolerance ${id}`);
  return found;
};

/** The ids that accept each difference, by path; an unexplained one is `[]`. */
const accepted = ({ differences, projections, format }: HandBuilt): Record<string, string[]> =>
  Object.fromEntries(
    differences.map((difference) => [
      difference.path,
      TOLERANCES.filter(
        (candidate) =>
          candidate.formats.includes(format) && candidate.applies(difference, projections),
      ).map((candidate) => candidate.id),
    ]),
  );

const unexplained = (build: HandBuilt): string[] =>
  build.differences
    .filter((difference) => toleranceFor(difference, build.format, build.projections) === undefined)
    .map(formatDifference);

describe('stroke-length-rounded', () => {
  it('accepts a length that is not a note value, rounded on our side', () => {
    const build = HAND_BUILT.strokeLength74();
    expect(accepted(build)).toEqual({
      'tracks[0].bars[0].voices[0].beats[0].brush': ['stroke-length-rounded'],
    });
    expect(unexplained(build)).toEqual([]);
  });

  it('has nothing to accept for an exact note value', () => {
    expect(HAND_BUILT.strokeLength480().differences).toEqual([]);
  });

  it('does not accept a different direction or a different note value', () => {
    const { differences, projections } = HAND_BUILT.strokeLength74();
    const [difference] = differences;
    if (!difference) throw new Error('no stroke difference');
    const applies = (ours: unknown): boolean =>
      tolerance('stroke-length-rounded').applies({ ...difference, ours }, projections);
    expect(applies('down 64')).toBe(true);
    expect(applies('up 64')).toBe(false);
    expect(applies('down 32')).toBe(false);
    expect(applies(undefined)).toBe(false);
  });

  it('does not accept an exact alphaTab note value that differs from ours', () => {
    const { differences, projections } = HAND_BUILT.strokeLength74();
    const [difference] = differences;
    if (!difference) throw new Error('no stroke difference');
    expect(
      tolerance('stroke-length-rounded').applies(
        { ...difference, ours: 'down 16', alphaTab: 'down 8' },
        projections,
      ),
    ).toBe(false);
  });

  it.each([
    [256, 128],
    [2, 4],
    [1, 4],
  ])('accepts a clamped length: alphaTab 1/%i against our 1/%i', (theirs, ours) => {
    const { differences, projections } = HAND_BUILT.strokeLength74();
    const [difference] = differences;
    if (!difference) throw new Error('no stroke difference');
    expect(
      tolerance('stroke-length-rounded').applies(
        { ...difference, ours: `down ${String(ours)}`, alphaTab: `down ${String(theirs)}` },
        projections,
      ),
    ).toBe(true);
  });
});

describe('whammy-points-kept', () => {
  it('accepts the monotonic curve whose middle points alphaTab removes', () => {
    const build = HAND_BUILT.whammyMonotonic();
    expect(accepted(build)).toEqual({
      'tracks[0].bars[0].voices[0].beats[0].whammyPoints': ['whammy-points-kept'],
    });
    expect(build.differences[0]).toMatchObject({ ours: 4, alphaTab: 2 });
  });

  it('accepts the dip whose middle points share an offset', () => {
    const build = HAND_BUILT.whammyDip();
    expect(accepted(build)).toEqual({
      'tracks[0].bars[0].voices[0].beats[0].whammyPoints': ['whammy-points-kept'],
    });
    expect(build.differences[0]).toMatchObject({ ours: 4, alphaTab: 3 });
  });

  it('has nothing to accept when alphaTab keeps all four points', () => {
    expect(HAND_BUILT.whammyDipApart().differences).toEqual([]);
  });

  it('does not accept a curve whose ends, highest or lowest value differ', () => {
    const { differences, projections, format } = HAND_BUILT.whammyMonotonic();
    const [difference] = differences;
    if (!difference?.beat) throw new Error('no whammy difference');
    for (const field of ['whammyFrom', 'whammyTo', 'whammyMax', 'whammyMin'] as const) {
      const beat = structuredClone(difference.beat);
      beat.ours[field] = (beat.ours[field] ?? 0) + 1;
      expect(tolerance('whammy-points-kept').applies({ ...difference, beat }, projections)).toBe(
        false,
      );
    }
    expect(format).toBe('gpx');
  });

  it('does not accept other point counts', () => {
    const { differences, projections } = HAND_BUILT.whammyMonotonic();
    const [difference] = differences;
    if (!difference) throw new Error('no whammy difference');
    for (const [ours, alphaTab] of [
      [3, 2],
      [4, 1],
      [4, 4],
      [2, 4],
    ] as const) {
      expect(
        tolerance('whammy-points-kept').applies({ ...difference, ours, alphaTab }, projections),
      ).toBe(false);
    }
  });
});

describe('chromatic-transposition', () => {
  it('accepts the chromatic part alphaTab adds to the octave shift', () => {
    const build = HAND_BUILT.chromatic();
    expect(accepted(build)).toEqual({ 'tracks[1].octaveShift': ['chromatic-transposition'] });
    const [difference] = build.differences;
    expect(difference?.alphaTab).toBeCloseTo(1 + 7 / 12);
    expect(difference?.ours).toBe(1);
  });

  it('does not accept a whole-octave difference, which is a reader bug', () => {
    const build = HAND_BUILT.chromaticOctave();
    expect(build.differences.map((difference) => difference.path)).toEqual([
      'tracks[1].octaveShift',
    ]);
    expect(unexplained(build)).toHaveLength(1);
    const octaveOnly = HAND_BUILT.octaveOnly();
    expect(octaveOnly.differences).toEqual([]);
    const [difference] = build.differences;
    if (!difference) throw new Error('no shift difference');
    expect(
      tolerance('chromatic-transposition').applies(
        { ...difference, ours: 1, alphaTab: 2 },
        build.projections,
      ),
    ).toBe(false);
  });

  it('does not accept a fraction of a semitone or a non-number', () => {
    const { differences, projections } = HAND_BUILT.chromatic();
    const [difference] = differences;
    if (!difference) throw new Error('no shift difference');
    const applies = (ours: unknown, alphaTab: unknown, path = difference.path): boolean =>
      tolerance('chromatic-transposition').applies(
        { ...difference, ours, alphaTab, path },
        projections,
      );
    expect(applies(1, 1.04)).toBe(false);
    expect(applies(1, 1 + 19 / 12)).toBe(false);
    expect(applies(1, 1 - 13 / 12)).toBe(false);
    expect(applies(1, 1 + 11 / 12)).toBe(true);
    expect(applies(1, 'x')).toBe(false);
    expect(applies(1, 1.5, 'tracks[1].capo')).toBe(false);
  });
});

describe('track-automation-on-first-beat', () => {
  it('accepts a sound change alphaTab holds on the first beat and we hold on the second', () => {
    const build = HAND_BUILT.soundChangeMidBar();
    expect(accepted(build)).toEqual({
      'tracks[0].bars[0].voices[0].beats[0].mix': ['track-automation-on-first-beat'],
      'tracks[0].bars[0].voices[0].beats[1].mix': ['track-automation-on-first-beat'],
    });
  });

  it('has nothing to accept when the change is at the bar start', () => {
    expect(HAND_BUILT.soundChangeAtStart().differences).toEqual([]);
  });

  it('does not accept a different program on the later beat', () => {
    const build = HAND_BUILT.soundChangeMidBar();
    const projections = structuredClone(build.projections);
    const later = projections.ours.tracks[0]?.bars[0]?.voices[0]?.beats[1]?.mix;
    if (!later) throw new Error('no mix on the second beat');
    later.program = (later.program ?? 0) + 1;
    for (const difference of build.differences) {
      expect(tolerance('track-automation-on-first-beat').applies(difference, projections)).toBe(
        false,
      );
    }
  });

  it('accepts a change that lands on a first voice we keep empty', () => {
    const build = HAND_BUILT.soundChangeOnSecondVoice();
    expect(accepted(build)).toEqual({
      'tracks[0].bars[0].voices[0].beats': ['placeholder-beat-holds-automation'],
      'tracks[0].bars[0].voices[1].beats[0].mix': ['track-automation-on-first-beat'],
    });
  });

  it('does not accept the second-voice change when it is another program', () => {
    const build = HAND_BUILT.soundChangeOnSecondVoice();
    const projections = structuredClone(build.projections);
    const mix = projections.ours.tracks[0]?.bars[0]?.voices[1]?.beats[0]?.mix;
    if (!mix) throw new Error('no mix on the second voice');
    mix.program = (mix.program ?? 0) + 1;
    for (const difference of build.differences) {
      expect(toleranceFor(difference, build.format, projections)).toBeUndefined();
    }
  });

  it('does not accept a change we hold with none on the first beat of alphaTab', () => {
    const build = HAND_BUILT.soundChangeMidBar();
    const projections = structuredClone(build.projections);
    const first = projections.alphaTab.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    if (!first) throw new Error('no first beat');
    first.mix = null;
    const later = build.differences.find((difference) => difference.path.includes('beats[1]'));
    if (!later) throw new Error('no second-beat difference');
    expect(tolerance('track-automation-on-first-beat').applies(later, projections)).toBe(false);
  });
});

describe('placeholder-beat-holds-automation', () => {
  it('accepts the empty beat alphaTab keeps when one of our beats holds the change', () => {
    const build = HAND_BUILT.soundChangeOnSecondVoice();
    expect(accepted(build)['tracks[0].bars[0].voices[0].beats']).toEqual([
      'placeholder-beat-holds-automation',
    ]);
  });

  // Flips to an accepted case once #153 keeps the change somewhere else in the score.
  it('keeps reporting a sound change we drop in an empty bar (#153)', () => {
    const build = HAND_BUILT.soundChangeInEmptyBar();
    expect(build.warnings).toContain('automation-dropped');
    expect(unexplained(build)).toHaveLength(1);
  });

  it('has nothing to accept in an empty bar with no automation', () => {
    expect(HAND_BUILT.emptyBar().differences).toEqual([]);
  });

  it('does not accept a placeholder that carries more than the automation', () => {
    const build = HAND_BUILT.soundChangeOnSecondVoice();
    const [difference] = build.differences;
    if (!difference) throw new Error('no placeholder difference');
    const mutations: ((
      beat: HandBuilt['projections']['alphaTab']['tracks'][0]['bars'][0]['voices'][0]['beats'][0],
    ) => void)[] = [
      (beat) => (beat.duration = 8),
      (beat) => (beat.dots = 1),
      (beat) => (beat.text = 'note'),
      (beat) => (beat.rest = true),
      (beat) => (beat.mix = null),
    ];
    for (const mutate of mutations) {
      const projections = structuredClone(build.projections);
      const placeholder = projections.alphaTab.tracks[0]?.bars[0]?.voices[0]?.beats[0];
      if (!placeholder) throw new Error('no placeholder');
      mutate(placeholder);
      expect(tolerance('placeholder-beat-holds-automation').applies(difference, projections)).toBe(
        false,
      );
    }
  });

  it('does not accept a voice where we hold beats that alphaTab does not', () => {
    const build = HAND_BUILT.soundChangeOnSecondVoice();
    const difference = build.differences.find((d) => d.path.endsWith('voices[0].beats'));
    if (!difference) throw new Error('no placeholder difference');
    const projections = structuredClone(build.projections);
    const beat = projections.ours.tracks[0]?.bars[0]?.voices[1]?.beats[0];
    const target = projections.ours.tracks[0]?.bars[0]?.voices[0];
    if (!beat || !target) throw new Error('no beat to copy');
    target.beats = [structuredClone(beat)];
    expect(tolerance('placeholder-beat-holds-automation').applies(difference, projections)).toBe(
      false,
    );
  });
});
