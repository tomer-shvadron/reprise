import { describe, expect, it } from 'vitest';

import { readGp } from '../../src/index';
import { twoStaffGp } from '../merged-staves-gp';
import { compareProjections } from './compare';
import { loadWithAlphaTab, projectAlphaTab } from './project-alphatab';
import { projectOurs } from './project-ours';

function projections(bytes: Uint8Array) {
  const { score } = readGp(bytes);
  return {
    ours: projectOurs(score),
    alphaTab: projectAlphaTab(
      loadWithAlphaTab(bytes),
      score.tracks.map((track) => track.kind),
    ),
  };
}

// The builder track has no channel strip, so only the bars are compared.
const barDifferences = (bytes: Uint8Array) => {
  const { ours, alphaTab } = projections(bytes);
  return compareProjections('merged-staves', ours, alphaTab).filter((difference) =>
    difference.path.startsWith('tracks[0].bars'),
  );
};

describe('a track whose second staff has its own tuning', () => {
  it('compares equal to alphaTab note by note', () => {
    expect(barDifferences(twoStaffGp())).toEqual([]);
  });

  it('holds the second staff note in voice slot 1 of the alphaTab projection', () => {
    const { alphaTab } = projections(twoStaffGp());
    expect(alphaTab.tracks[0]?.bars[0]?.voices[1]?.beats[0]?.notes[0]?.value).toBe(33);
  });

  it('reports a one-octave error in the second staff as one value difference', () => {
    const { ours, alphaTab } = projections(twoStaffGp());
    const wrong = structuredClone(ours);
    const target = wrong.tracks[0]?.bars[0]?.voices[1]?.beats[0]?.notes[0];
    if (!target) throw new Error('the second staff note is missing from our projection');
    target.value += 12;
    const differences = compareProjections('merged-staves', wrong, alphaTab).filter((difference) =>
      difference.path.startsWith('tracks[0].bars'),
    );
    expect(differences).toHaveLength(1);
    expect(differences[0]?.path).toContain('value');
  });
});
