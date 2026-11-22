import { describe, expect, it } from 'vitest';

import { chordDegrees } from './degrees';
import { QUALITIES, qualityOf } from './qualities';

const degrees = (suffix: string): string[] => {
  const quality = qualityOf(suffix);
  if (!quality) throw new Error(`no quality ${suffix}`);
  return chordDegrees(quality);
};

describe('chordDegrees', () => {
  it.each(QUALITIES.map((quality) => [quality.suffix || 'major', quality] as const))(
    'labels every tone of %s once',
    (_name, quality) => {
      const labels = chordDegrees(quality);
      expect(labels).toHaveLength(quality.intervals.length);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels[0]).toBe('R');
    },
  );

  it('spells the common chords', () => {
    expect(degrees('m7')).toEqual(['R', '♭3', '5', '♭7']);
    expect(degrees('dim7')).toEqual(['R', '♭3', '♭5', '𝄫7']);
    expect(degrees('7#9')).toEqual(['R', '3', '5', '♭7', '♯9']);
    expect(degrees('sus4')).toEqual(['R', '4', '5']);
    expect(degrees('sus2')).toEqual(['R', '2', '5']);
    expect(degrees('7sus4')).toEqual(['R', '4', '5', '♭7']);
    expect(degrees('13')).toEqual(['R', '3', '5', '♭7', '9', '13']);
    expect(degrees('6/9')).toEqual(['R', '3', '5', '6', '9']);
    expect(degrees('maj7')).toEqual(['R', '3', '5', '7']);
  });
});
