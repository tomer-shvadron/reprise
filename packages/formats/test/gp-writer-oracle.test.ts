import { PPQ, barTicks, beatStartTicks, type Score } from '@reprise/model';
import { fullScore, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { readGp, readGp3To5, readGpx, writeGp } from '../src/index';
import { countNotes, fixtureBytes, manifestEntries } from './corpus';
import { kitchenSink } from './kitchen-sink';
import { compareProjections, formatDifference, type Difference } from './oracle/compare';
import { loadWithAlphaTab, projectAlphaTab } from './oracle/project-alphatab';
import { projectOurs } from './oracle/project-ours';
import type { ScoreProjection } from './oracle/projection';
import { toleranceFor, type Projections } from './oracle/tolerances';

/**
 * alphaTab stands in for Guitar Pro, which cannot run here: every file the writer makes must
 * load in alphaTab's Guitar Pro 7 importer with the same tracks, bars and notes, and its reading
 * must project (the oracle's reduction of a score, `test/oracle/`) the same as our reader's
 * reading of the same bytes, up to the oracle's gp tolerances and the writer's own below. The
 * round-trip tests close the other half of the loop, source against our reading. alphaTab is a
 * dev-only dependency, used only in tests.
 */
interface Written {
  source: Score;
  /** Our reader's reading of the written file. */
  ours: Score;
  projections: Projections;
}

interface WriterTolerance {
  id: string;
  why: string;
  applies: (difference: Difference, written: Written) => boolean;
}

const MASTER_BAR_FIELD = /^masterBars\[(?<bar>\d+)\]\.(?<field>\w+)$/;
const TRACK = /^tracks\[(?<track>\d+)\]/;
const FIRST_BEAT_MIX = /^tracks\[\d+\]\.bars\[0\]\.voices\[0\]\.beats\[0\]\.mix$/;

const masterBarOf = (difference: Difference): number =>
  Number(MASTER_BAR_FIELD.exec(difference.path)?.groups?.['bar']);

const trackOf = (
  difference: Difference,
  projection: ScoreProjection,
): ScoreProjection['tracks'][number] | undefined =>
  projection.tracks[Number(TRACK.exec(difference.path)?.groups?.['track'])];

/** The master bars a tempo ramp starts in or ends in. */
function rampBars(score: Score): Set<number> {
  const starts = [0];
  for (const masterBar of score.masterBars) {
    starts.push((starts.at(-1) ?? 0) + barTicks(masterBar));
  }
  const barAt = (tick: number): number => {
    const next = starts.findIndex((start) => start > tick);
    return next === -1 ? score.masterBars.length - 1 : Math.max(0, next - 1);
  };
  const bars = new Set<number>();
  for (const track of score.tracks) {
    track.bars.forEach((bar, barIndex) => {
      for (const voice of bar.voices) {
        voice.beats.forEach((beat, beatIndex) => {
          const ramp = beat.mix?.tempo?.duration;
          if (ramp === undefined) return;
          bars.add(barIndex);
          bars.add(barAt((starts[barIndex] ?? 0) + beatStartTicks(voice, beatIndex) + ramp * PPQ));
        });
      }
    });
  }
  return bars;
}

const hasBeatLyrics = (score: Score): boolean =>
  score.tracks.some((track) =>
    track.bars.some((bar) =>
      bar.voices.some((voice) => voice.beats.some((beat) => beat.lyrics !== undefined)),
    ),
  );

/**
 * Where alphaTab's reading of a written file legitimately differs from ours. Each entry must
 * accept at least one difference, so the list stays as short as the writer's inputs allow.
 */
const WRITER_TOLERANCES: readonly WriterTolerance[] = [
  {
    id: 'notices-line-ends',
    why: 'The oracle joins notice lines with CRLF, as GP3 to GP5 store them; gpif holds LF, which alphaTab returns as is.',
    applies: (d) =>
      d.path === 'meta.notices' &&
      typeof d.ours === 'string' &&
      d.ours.replaceAll('\r\n', '\n') === d.alphaTab,
  },
  {
    id: 'split-cdata',
    why: "`]]>` in free text can only be written as two adjacent CDATA sections; alphaTab's `XmlDocument` keeps the last one, where a conforming parser joins them.",
    applies: (d) =>
      d.path.startsWith('meta.') && typeof d.ours === 'string' && d.ours.includes(']]>'),
  },
  {
    id: 'harmonic-value-default',
    why: "A harmonic with no fret of its own is written without `HarmonicFret`; alphaTab's `harmonicValue` then reads 0, where the model keeps it absent.",
    applies: (d) => d.field === 'harmonicValue' && d.ours === null && d.alphaTab === 0,
  },
  {
    id: 'piano-hammer-pull',
    why: "alphaTab's `findHammerPullDestination` searches by string; a pitched track with no tuning is written in GP6's `Octave`/`Tone` form, whose notes have none.",
    applies: (d, { projections }) =>
      d.field === 'hammerPull' &&
      d.alphaTab === false &&
      trackOf(d, projections.ours)?.strings === 0,
  },
  {
    id: 'lyrics-skipped-for-every-track',
    why: "alphaTab's `_skipApplyLyrics` is one flag for the whole file: a beat with its own `Lyrics` on any track stops every track's lyric block from being laid onto its beats, where Guitar Pro's `dispatched` and our reader decide per track.",
    applies: (d, { source }) =>
      d.field === 'lyrics' && d.alphaTab === null && d.ours !== null && hasBeatLyrics(source),
  },
  {
    id: 'sound-beside-track-sound',
    why: "A program change on the very first beat is a second `Sound` automation at bar 0, position 0, after the track's own; alphaTab keeps the first automation per beat, Guitar Pro applies them in order.",
    applies: (d) => FIRST_BEAT_MIX.test(d.path) && d.alphaTab === null,
  },
  {
    id: 'ramp-as-two-automations',
    why: 'The model keeps a tempo ramp on its start beat; gpif holds an automation at the start with the tempo in effect and a linear one at the end, which alphaTab lists as two tempos and our reader folds back into the ramp.',
    applies: (d, { ours }) => d.field === 'tempos' && rampBars(ours).has(masterBarOf(d)),
  },
  {
    id: 'double-bar-on-last-bar',
    why: '`GpifParser._buildModel` clears a double bar on the final master bar.',
    applies: (d, { ours }) =>
      d.field === 'doubleBar' &&
      d.ours === true &&
      d.alphaTab === false &&
      masterBarOf(d) === ours.masterBars.length - 1,
  },
];

const explained = (difference: Difference, written: Written): boolean =>
  toleranceFor(difference, 'gp', written.projections) !== undefined ||
  WRITER_TOLERANCES.some((tolerance) => tolerance.applies(difference, written));

const sources: [string, () => Score][] = [
  ...manifestEntries(['gp']).map((entry): [string, () => Score] => [
    entry.path,
    () => readGp(fixtureBytes(entry.path)).score,
  ]),
  ...manifestEntries(['gp3', 'gp4', 'gp5']).map((entry): [string, () => Score] => [
    `${entry.path} exported to gp`,
    () => readGp3To5(fixtureBytes(entry.path)).score,
  ]),
  ...manifestEntries(['gpx']).map((entry): [string, () => Score] => [
    `${entry.path} exported to gp`,
    () => readGpx(fixtureBytes(entry.path)).score,
  ]),
  ['fullScore()', fullScore],
  ['the kitchen sink', kitchenSink],
  ['largeScore(4, 32, { structure: true })', () => largeScore(4, 32, { structure: true })],
];

interface Comparison {
  name: string;
  source: Score;
  read: ReturnType<typeof loadWithAlphaTab>;
  written: Written;
  differences: Difference[];
}

function compare(name: string, source: Score): Comparison {
  const { bytes } = writeGp(source);
  const read = loadWithAlphaTab(bytes);
  const ours = readGp(bytes).score;
  const projections = {
    ours: projectOurs(ours),
    alphaTab: projectAlphaTab(
      read,
      ours.tracks.map((track) => track.kind),
    ),
  };
  const written = { source, ours, projections };
  return {
    name,
    source,
    read,
    written,
    differences: compareProjections(name, projections.ours, projections.alphaTab),
  };
}

const comparisons = sources.map(([name, build]) => compare(name, build()));

describe.each(comparisons)('alphaTab reads $name', ({ source, read, written, differences }) => {
  it('with the same tracks, bars, notes, names and opening tempo', () => {
    let notes = 0;
    for (const track of read.tracks) {
      for (const staff of track.staves) {
        for (const bar of staff.bars) {
          for (const voice of bar.voices)
            for (const beat of voice.beats) notes += beat.notes.length;
        }
      }
    }
    expect({
      tracks: read.tracks.length,
      bars: read.masterBars.length,
      notes,
      names: read.tracks.map((track) => track.name),
      tempo: read.tempo,
    }).toEqual({
      tracks: source.tracks.length,
      bars: source.masterBars.length,
      notes: countNotes(source),
      names: source.tracks.map((track) => track.name),
      tempo: source.masterBars[0]?.tempo?.bpm,
    });
  });

  it('projecting the same as our reader, up to the tolerances', () => {
    const unexplained = differences.filter((difference) => !explained(difference, written));
    expect(unexplained.map(formatDifference)).toEqual([]);
  });
});

describe("the writer's tolerance list", () => {
  it.each(WRITER_TOLERANCES)('$id accepts at least one difference', (tolerance) => {
    const used = comparisons.some(({ written, differences }) =>
      differences.some((difference) => tolerance.applies(difference, written)),
    );
    expect(used).toBe(true);
  });

  it('has unique ids', () => {
    const ids = WRITER_TOLERANCES.map((tolerance) => tolerance.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
