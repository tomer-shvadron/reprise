import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE,
  CUE_WEIGHTS,
  bassCues,
  confidenceOf,
  cueEvidence,
  detectKey,
  onsetCount,
  qualityFromThirds,
  thirdPlayed,
  pearson,
  rankKeys,
  sonorities,
} from './key';
import { PROFILE_SETS, profileSetOf } from './key-profiles';
import { noteTableOf } from './note-table';
import { aMinorRiff } from '../../test/a-minor-riff';

import { fromBars, fromMelody } from './test/corpus';

describe('pearson', () => {
  it('is 1 for a scaled copy, -1 for a mirror and 0 for no spread', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe('profiles', () => {
  it.each(PROFILE_SETS)('$name has twelve weights per mode and a citation', (set) => {
    expect(set.major).toHaveLength(12);
    expect(set.minor).toHaveLength(12);
    expect(set.citation.length).toBeGreaterThan(20);
    // The tonic is the heaviest degree of a major profile.
    expect(Math.max(...set.major)).toBe(set.major[0]);
  });

  it.each(PROFILE_SETS)('$name ranks a rotated profile as its own key', (set) => {
    for (const tonic of [0, 3, 8]) {
      const histogram = Array.from(
        { length: 12 },
        (_, pc) => set.minor[(pc - tonic + 12) % 12] ?? 0,
      );
      const best = rankKeys(histogram, set)[0];
      expect(best).toMatchObject({ tonic, quality: 'minor' });
    }
  });

  it('looks a set up by id', () => {
    expect(profileSetOf('temperley').name).toBe('Temperley');
  });
});

describe('confidenceOf', () => {
  it('grades by the best correlation and the gap to the runner-up', () => {
    expect(confidenceOf(0.9, 0.7)).toBe('high');
    expect(confidenceOf(0.7, 0.6)).toBe('medium');
    expect(confidenceOf(0.9, 0.9 - CONFIDENCE.mediumGap / 2)).toBe('low');
  });
});

describe('detectKey', () => {
  const triad = (root: number, third: number) => [root, root + third, root + 7];

  it('names C major from a I-IV-V-I and agrees with the file', () => {
    const table = noteTableOf(
      fromBars([
        { chord: [36, ...triad(60, 4)] },
        { chord: [41, ...triad(65, 4)] },
        { chord: [43, ...triad(67, 4)] },
        { chord: [36, ...triad(60, 4)] },
      ]),
    );
    const key = detectKey(table, { fileKey: { fifths: 0, minor: false } });
    expect(key).toMatchObject({ found: true, tonic: 0, quality: 'major', name: 'C major' });
    expect(key.found && key.agreesWithFile).toBe(true);
    expect(key.found && key.scale?.scale).toBe('ionian');
  });

  it('spells a flat key with flats', () => {
    const shift = 3;
    const table = noteTableOf(
      fromBars([
        { chord: [36 + shift, ...triad(60 + shift, 3)] },
        { chord: [41 + shift, ...triad(65 + shift, 3)] },
        { chord: [43 + shift, ...triad(67 + shift, 4)] },
        { chord: [36 + shift, ...triad(60 + shift, 3)] },
      ]),
    );
    expect(detectKey(table)).toMatchObject({ tonic: 3, quality: 'minor', name: 'E♭ minor' });
  });

  it('says so when there are too few notes', () => {
    const table = noteTableOf(
      score()
        .track('piano')
        .bar()
        .beat('1', [midi(60)])
        .build(),
    );
    expect(detectKey(table)).toEqual({ found: false, reason: 'not-enough-notes' });
  });

  it('keeps the tonic of a power-chord riff and does not guess a mode', () => {
    const power = (root: number) => [root, root + 7, root + 12];
    const table = noteTableOf(
      fromBars([40, 40, 45, 45, 40, 40, 47, 45, 40].map((root) => ({ chord: power(root) }))),
    );
    expect(detectKey(table)).toMatchObject({ found: true, tonic: 4, quality: 'none' });
  });

  it('names the tonic of a minor and major-IV vamp', () => {
    // An A minor and D major vamp: A Dorian.
    const am = [45, 57, 60, 64];
    const d = [38, 57, 62, 66];
    const table = noteTableOf(
      fromBars([am, am, d, am, am, am, d, am, am].map((chord) => ({ chord }))),
    );
    const key = detectKey(table);
    expect(key.found && key.tonic).toBe(9);
    expect(key.found && key.quality).toBe('minor');
  });

  it('keeps the tonic when the quality has no third to show for it', () => {
    // E Dorian in the bass, with only G natural played: the third is minor, so the key is minor.
    const em = [40, 52, 55, 59];
    const table = noteTableOf(fromBars([em, em, [45, 57, 60, 64], em].map((chord) => ({ chord }))));
    expect(detectKey(table)).toMatchObject({ tonic: 4, quality: 'minor' });
  });

  describe('a melody over a held bass, in either track order', () => {
    // C major: the bass holds C, F, G, C as whole notes while the melody opens on G and its last
    // eighths are a C chord arpeggio ending on G. A per-track bass read G as the last bass note.
    const melody = [
      [67, '4'],
      [65, '4'],
      [64, '4'],
      [62, '4'],
      [64, '4'],
      [64, '4'],
      [64, '2'],
      [62, '4'],
      [62, '4'],
      [64, '4'],
      [62, '4'],
      [60, '8'],
      [64, '8'],
      [67, '8'],
      [72, '8'],
      [67, '2'],
    ] as const;
    const bass = [
      [36, '1'],
      [41, '1'],
      [43, '1'],
      [36, '1'],
    ] as const;

    it.each([false, true])('names C major with the bass track first: %s', (bassFirst) => {
      const table = noteTableOf(fromMelody(melody, { bass, bassFirst }));
      expect(bassCues(table).last).toBe(0);
      expect(detectKey(table)).toMatchObject({ tonic: 0, quality: 'major' });
    });
  });

  it('does not let a fill over a held note count as the bass', () => {
    const table = noteTableOf(
      fromMelody(
        [
          [72, '4'],
          [67, '4'],
          [64, '4'],
          [60, '4'],
        ],
        {
          bass: [[36, '1']],
        },
      ),
    );
    expect(sonorities(table).map((s) => s.pc)).toEqual([0, 0, 0, 0]);
  });
});

describe('the bass evidence', () => {
  it('adds up to the sum of the weights for a bass that agrees on every cue', () => {
    const cues = { first: 0, last: 0, downbeat: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(cueEvidence(cues, 0)).toBeCloseTo(
      CUE_WEIGHTS.downbeat + CUE_WEIGHTS.first + CUE_WEIGHTS.last,
    );
    expect(cueEvidence(cues, 5)).toBe(0);
  });

  it('is evidence, not an override: a last note alone does not move a clear key', () => {
    // A clear C major that ends on a held G: the correlation stays with C.
    const c = [36, 60, 64, 67];
    const table = noteTableOf(
      fromBars(
        [
          c,
          [41, 65, 69, 72],
          [43, 67, 71, 74],
          c,
          c,
          [41, 65, 69, 72],
          [43, 67, 71, 74],
          [43, 67, 71, 74],
        ].map((chord) => ({ chord })),
      ),
    );
    expect(detectKey(table)).toMatchObject({ tonic: 0, quality: 'major' });
  });

  it('can settle a close call between a mode and its relative key', () => {
    const am = [45, 57, 60, 64];
    const g = [43, 55, 59, 62];
    const table = noteTableOf(fromBars([am, g, am, g, am, g, am].map((chord) => ({ chord }))));
    expect(detectKey(table)).toMatchObject({ tonic: 9 });
    expect(detectKey(table, { cues: false }).found).toBe(true);
  });

  it('puts the bass at each onset, held notes included, across tracks', () => {
    const table = noteTableOf(
      fromMelody(
        [
          [72, '4'],
          [67, '4'],
        ],
        { bass: [[36, '2']] },
      ),
    );
    const line = sonorities(table);
    expect(line.map((s) => [s.onset, s.pc])).toEqual([
      [0, 0],
      [960, 0],
    ]);
  });
});

const CHORD_TONES = [0, 4, 7, 12];

describe('not enough notes', () => {
  const notes = (count: number, duration: '4' | '16' = '4') => {
    const b = score().track('piano');
    b.bar();
    for (let i = 0; i < count; i++) {
      if (i > 0 && i % (duration === '4' ? 4 : 16) === 0) b.bar();
      b.beat(duration, [midi(60 + (CHORD_TONES[i % 4] ?? 0))]);
    }
    return b.build();
  };

  it('needs 16 onsets', () => {
    expect(detectKey(noteTableOf(notes(15))).found).toBe(false);
    expect(detectKey(noteTableOf(notes(16))).found).toBe(true);
  });

  it('counts onsets, not the rows of a tie continuation', () => {
    const built = score().track('piano');
    for (let bar = 0; bar < 8; bar++) {
      built.bar();
      built.beat('1', [midi(60, { tie: bar > 0 })]);
      if (bar % 2 === 0) continue;
    }
    const table = noteTableOf(built.build({ validate: false }));
    expect(table.length).toBe(8);
    expect(onsetCount(table)).toBe(1);
    expect(detectKey(table).found).toBe(false);
  });

  it('finds nothing in a drums-only score', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(36)])
      .build();
    expect(detectKey(noteTableOf(built))).toEqual({ found: false, reason: 'not-enough-notes' });
  });
});

describe('a riff with no third', () => {
  const power = (root: number) => [root, root + 7, root + 12];
  const riff = (roots: number[]) =>
    noteTableOf(fromBars(roots.map((root) => ({ chord: power(root) }))));

  it('is named by a scale without a third, or by none', () => {
    const key = detectKey(riff([40, 38, 45, 40, 40, 38, 45, 40]));
    expect(key).toMatchObject({ found: true, tonic: 4, quality: 'none' });
    // E, B, D and A: the suspended pentatonic holds them all and no third.
    expect(key.found && key.scale?.scale).toBe('suspendedPentatonic');
  });

  it('never reports E minor pentatonic for E5-A5-B5', () => {
    const key = detectKey(riff([40, 40, 45, 45, 40, 40, 47, 45, 40]));
    expect(key.found && key.quality).toBe('none');
    expect(key.found && key.scale?.scale).not.toBe('minorPentatonic');
  });

  it('names a bare root-and-fifth riff by the smallest scale that holds it', () => {
    const key = detectKey(riff([40, 47, 40, 47, 40, 47]));
    expect(key.found && key.quality).toBe('none');
    expect(key.found && key.scale?.scale).toBe('rootFourthFifth');
  });

  it('reads a flat third on a chord root as minor', () => {
    const key = detectKey(riff([40, 43, 45, 40, 43, 45, 40]));
    expect(key).toMatchObject({ found: true, tonic: 4, quality: 'minor' });
  });
});

describe('the third', () => {
  const frame = 0.4;
  it('flips a major profile to minor when only the flat third sounds, and the reverse', () => {
    expect(qualityFromThirds('major', { minor: 0.1, major: 0.02, frame })).toBe('minor');
    expect(qualityFromThirds('minor', { minor: 0.02, major: 0.1, frame })).toBe('major');
  });

  it('keeps the profile when the thirds are within a factor of two, as in a blues', () => {
    expect(qualityFromThirds('major', { minor: 0.07, major: 0.05, frame })).toBe('major');
    expect(qualityFromThirds('minor', { minor: 0.05, major: 0.07, frame })).toBe('minor');
  });

  it('is none only when neither third sounds in proportion to the tonic and fifth', () => {
    expect(qualityFromThirds('minor', { minor: 0, major: 0, frame })).toBe('none');
    // A single flat third is enough, however little of the song there is.
    expect(thirdPlayed({ minor: 0.02, major: 0, frame })).toBe(true);
    expect(qualityFromThirds('major', { minor: 0.02, major: 0, frame })).toBe('minor');
  });

  it('does not call a melody over a dominant pedal "none"', () => {
    // A C major tune over a held G, closing on C: G has no B in it, so G is no key.
    const melody = [
      [67, '4'],
      [65, '4'],
      [64, '4'],
      [62, '4'],
      [64, '4'],
      [64, '4'],
      [64, '2'],
      [62, '4'],
      [62, '4'],
      [64, '4'],
      [62, '4'],
      [60, '8'],
      [64, '8'],
      [67, '8'],
      [72, '8'],
      [67, '2'],
    ] as const;
    const pedal = [
      [43, '1'],
      [43, '1'],
      [43, '1'],
      [43, '1'],
      [43, '1'],
      [43, '1'],
      [43, '1'],
      [36, '1'],
    ] as const;
    const key = detectKey(noteTableOf(fromMelody([...melody, ...melody], { bass: pedal })));
    expect(key).toMatchObject({ found: true, tonic: 0, quality: 'major' });
  });
});

describe('the runner-up the card names', () => {
  const riff = (frets: readonly number[], bass: number[] = [0]) => {
    const builder = score().tempo(120).track('guitar');
    for (let round = 0; round < 6; round++) {
      builder.bar();
      frets.forEach((fret, at) => {
        builder.beat(
          '8',
          at === 0 ? [note(1, fret), ...bass.map((f) => note(5, f))] : [note(1, fret)],
        );
      });
    }
    return builder.build();
  };

  it('skips the parallel key whose third the notes contradict', () => {
    const key = detectKey(noteTableOf(aMinorRiff()));
    expect(key).toMatchObject({ found: true, tonic: 9, quality: 'minor' });
    // A major would be second by score (the bass bonus ignores the mode), but C sharp never sounds.
    if (key.found) expect(key.runnerUp).toMatchObject({ tonic: 0, quality: 'major' });
  });

  it('keeps the parallel key second when both thirds sound', () => {
    // A blues: C and C sharp both played.
    const key = detectKey(noteTableOf(riff([5, 8, 9, 10, 12, 10, 8, 5])));
    expect(key).toMatchObject({ found: true, tonic: 9 });
    if (key.found) expect(key.runnerUp).toMatchObject({ tonic: 9 });
  });

  it('keeps the plain second place when no third sounds', () => {
    // A power-chord riff: A, D and E only.
    const key = detectKey(noteTableOf(riff([5, 10, 12, 10, 5, 10, 12, 10])));
    expect(key).toMatchObject({ found: true, tonic: 9, quality: 'none' });
    // D major, the key of the A, D and E it plays: no third contradicts it, so nothing is skipped.
    if (key.found) expect(key.runnerUp).toMatchObject({ tonic: 2, quality: 'major' });
  });
});
