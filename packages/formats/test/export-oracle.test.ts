import {
  createHistory,
  setMasterBar,
  setNote,
  setTrackProperties,
  type Command,
  type Score,
} from '@reprise/model';
import { beatOf, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { read, write } from '../src/index';
import { compareProjections, formatDifference } from './oracle/compare';
import { loadWithAlphaTab, projectAlphaTab } from './oracle/project-alphatab';
import { projectOurs } from './oracle/project-ours';
import { toleranceFor } from './oracle/tolerances';

/**
 * What File > Export as Guitar Pro does to a score the user has edited: the edits go through the
 * model's commands, the score is written with `write(score, 'gp')` (the call the app's export
 * flow makes) and loaded in alphaTab, the stand-in for Guitar Pro, which cannot run here. The
 * e2e `export.spec.ts` closes the chain from the app's side. alphaTab is dev-only, and tests
 * are one of the two places it may be imported.
 */
function edited(): Score {
  const original = score()
    .title('Exported')
    .artist('Tester')
    .tempo(120)
    .track('guitar', { name: 'Lead' })
    .bar()
    .beat('4', [note(2, 3)])
    .beat('4', [note(3, 5)])
    .beat('2', [note(1, 0)])
    .bar()
    .beat('1', [note(4, 7)])
    .bar()
    .beat('1', [note(5, 2)])
    .track('bass')
    .bar()
    .beat('1', [note(3, 0)])
    .bar()
    .beat('1', [note(4, 2)])
    .bar()
    .beat('1', [note(3, 5)])
    .build();
  const history = createHistory();
  const apply = (current: Score, command: Command) => history.apply(current, command).score;
  const [lead, bass] = original.tracks;
  const [firstBar, secondBar] = original.masterBars;
  if (!lead || !bass || !firstBar || !secondBar)
    throw new Error('the score is not what it was built as');
  let next = apply(
    original,
    setNote({ beatId: beatOf(original, 0, 0, 0).id }, { string: 2, fret: 9 }),
  );
  next = apply(
    next,
    setTrackProperties({ trackId: lead.id }, { name: 'Rhythm', channel: { volume: 90 } }),
  );
  next = apply(next, setMasterBar({ masterBarId: secondBar.id }, { tempo: { bpm: 90 } }));
  next = apply(
    next,
    setTrackProperties({ trackId: bass.id }, { display: { notation: 'standard' } }),
  );
  return next;
}

const source = edited();
const written = await write(source, 'gp');
const loaded = loadWithAlphaTab(written.bytes);
const [lead, bass] = loaded.tracks;

describe('an edited score exported as gp opens in alphaTab', () => {
  it('with the tracks, strings, tunings and bars the edits left', () => {
    expect(loaded.title).toBe('Exported');
    expect(loaded.masterBars).toHaveLength(3);
    expect(loaded.tracks.map((track) => track.name)).toEqual(['Rhythm', 'Bass']);
    expect(loaded.tracks.map((track) => track.staves[0]?.tuning.length)).toEqual([6, 4]);
    expect([...(lead?.staves[0]?.tuning ?? [])].reverse()).toEqual(source.tracks[0]?.tuning);
    expect([...(bass?.staves[0]?.tuning ?? [])].reverse()).toEqual(source.tracks[1]?.tuning);
  });

  it('with the edited note on the string and fret it was given', () => {
    const edit = noteOf(source, 0, 0, 0);
    expect([edit.string, edit.fret]).toEqual([2, 9]);
    const [first] =
      projectAlphaTab(loaded, ['fretted', 'fretted']).tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
    expect(first?.notes.map(({ string, value }) => [string, value])).toEqual([[2, 9]]);
  });

  it('with the tempo change, the volume and the notation the edits set', () => {
    expect(loaded.tempo).toBe(120);
    expect(loaded.masterBars[1]?.tempoAutomations.map(({ value }) => value)).toEqual([90]);
    expect(lead?.playbackInfo.volume).toBe(
      projectAlphaTab(loaded, ['fretted', 'fretted']).tracks[0]?.volume,
    );
    expect([lead?.staves[0]?.showTablature, lead?.staves[0]?.showStandardNotation]).toEqual([
      true,
      false,
    ]);
    expect([bass?.staves[0]?.showTablature, bass?.staves[0]?.showStandardNotation]).toEqual([
      false,
      true,
    ]);
  });

  it('projecting the same as our reader, up to the oracle’s gp tolerances', async () => {
    const ours = (await read(written.bytes, 'gp')).score;
    expect(ours.tracks[0]?.channel.volume).toBe(90);
    expect(ours.tracks[1]?.display.notation).toBe('standard');
    const projections = {
      ours: projectOurs(ours),
      alphaTab: projectAlphaTab(
        loaded,
        ours.tracks.map((track) => track.kind),
      ),
    };
    const unexplained = compareProjections('edited', projections.ours, projections.alphaTab).filter(
      (difference) => toleranceFor(difference, 'gp', projections) === undefined,
    );
    expect(unexplained.map(formatDifference)).toEqual([]);
  });

  it('writes nothing the writer drops for a plain score', () => {
    expect(written.dropped).toEqual([]);
  });
});
