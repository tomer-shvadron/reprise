import { readdirSync } from 'node:fs';
import { extname } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as formats from '../../src/index';
import { FIXTURES_DIR, fixtureBytes, manifestEntries } from '../corpus';
import { compareProjections, formatDifference, type Difference } from './compare';
import { loadWithAlphaTab, projectAlphaTab } from './project-alphatab';
import { projectOurs } from './project-ours';
import type { ScoreProjection } from './projection';
import { PENDING_READERS, READERS, type OracleReader } from './readers';
import { TOLERANCES, toleranceFor, type Projections } from './tolerances';

const NOT_FIXTURES = new Set(['LICENSES.md', 'MPL-2.0.txt', 'manifest.json']);

const fixtureExtensions = new Set(
  readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && !NOT_FIXTURES.has(entry.name) && !entry.name.startsWith('.'),
    )
    .map((entry) => extname(entry.name).slice(1)),
);

interface Comparison {
  fixture: string;
  reader: OracleReader;
  projections: Projections;
  differences: Difference[];
}

function compare(path: string, reader: OracleReader): Comparison {
  const bytes = fixtureBytes(path);
  const score = reader.read(bytes);
  const projections = {
    ours: projectOurs(score),
    alphaTab: projectAlphaTab(
      loadWithAlphaTab(bytes),
      score.tracks.map((track) => track.kind),
    ),
  };
  return {
    fixture: path,
    reader,
    projections,
    differences: compareProjections(path, projections.ours, projections.alphaTab),
  };
}

const comparisons = READERS.flatMap((reader) =>
  manifestEntries([reader.extension]).map((entry) => compare(entry.path, reader)),
);

function notesIn(projection: ScoreProjection): number {
  let notes = 0;
  for (const track of projection.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          notes += beat.notes.length;
          for (const grace of beat.graces) notes += grace.notes.length;
        }
      }
    }
  }
  return notes;
}

describe('the oracle reader table', () => {
  it('has a reader or a pending entry for every fixture extension, and no stale entry', () => {
    const listed = [...READERS, ...PENDING_READERS].map((entry) => entry.extension);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...fixtureExtensions].sort()).toEqual([...listed].sort());
  });

  it.each(PENDING_READERS)('$exportName ($workPackage) is still pending', ({ exportName }) => {
    expect(Object.keys(formats)).not.toContain(exportName);
  });
});

describe.each(comparisons)(
  '$fixture against alphaTab',
  ({ fixture, reader, projections, differences }) => {
    it('differs only where the tolerance list allows', () => {
      const unexplained = differences.filter(
        (difference) => toleranceFor(difference, reader.extension, projections) === undefined,
      );
      expect(unexplained.map(formatDifference)).toEqual([]);
    });

    it('compares every note the manifest counts', () => {
      const entry = manifestEntries([reader.extension]).find(
        (candidate) => candidate.path === fixture,
      );
      expect(notesIn(projections.alphaTab)).toBe(entry?.notes);
    });
  },
);

describe('the tolerance list', () => {
  it.each(TOLERANCES)('$id accepts at least one difference in its formats', (tolerance) => {
    const used = comparisons.some(
      ({ reader, projections, differences }) =>
        tolerance.formats.includes(reader.extension) &&
        differences.some((difference) => tolerance.applies(difference, projections)),
    );
    expect(used).toBe(true);
  });

  it('has unique ids', () => {
    const ids = TOLERANCES.map((tolerance) => tolerance.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the comparison', () => {
  const [first] = comparisons;

  it('reports a changed fret with its path and both values', () => {
    if (!first) throw new Error('no fixture to compare');
    const ours = structuredClone(first.projections.ours);
    const note = ours.tracks
      .flatMap((track) => track.bars)
      .flatMap((bar) => bar.voices)
      .flatMap((voice) => voice.beats)
      .flatMap((beat) => beat.notes)[0];
    if (!note) throw new Error(`${first.fixture} has no notes`);
    note.value += 1;
    const differences = compareProjections(first.fixture, ours, first.projections.alphaTab);
    const changed = differences.filter((difference) => difference.field === 'value');
    expect(changed).toHaveLength(1);
    const [difference] = changed;
    if (!difference) throw new Error('the changed fret was not reported');
    expect(difference).toMatchObject({
      fixture: first.fixture,
      ours: note.value,
      alphaTab: note.value - 1,
    });
    expect(toleranceFor(difference, first.reader.extension, first.projections)).toBeUndefined();
  });

  it('reports a missing beat as a length difference and keeps comparing', () => {
    if (!first) throw new Error('no fixture to compare');
    const ours = structuredClone(first.projections.ours);
    const voice = ours.tracks[0]?.bars[0]?.voices[0];
    if (!voice) throw new Error(`${first.fixture} has no first voice`);
    voice.beats.pop();
    const differences = compareProjections(first.fixture, ours, first.projections.alphaTab);
    expect(differences).toContainEqual(
      expect.objectContaining({ path: 'tracks[0].bars[0].voices[0].beats.length', field: 'beats' }),
    );
  });
});
