import { PPQ } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { METRIC, NOTE_FLAG, extraction, noteTableOf } from './note-table';

describe('noteTableOf', () => {
  it('reads sounding pitch with the capo, and skips drums and rests', () => {
    const built = score()
      .track('guitar', { capo: 2 })
      .bar()
      .beat('4', [note(1, 0), note(6, 3)])
      .rest('4')
      .track('drums')
      .bar()
      .beat('4', [midi(36)])
      .build();
    const table = noteTableOf(built);
    expect(table.length).toBe(2);
    expect([...table.pitch]).toEqual([66, 45]);
    expect([...table.track]).toEqual([0, 0]);
    expect([...table.beat]).toEqual([0, 0]);
    expect(table.duration[0]).toBe(PPQ);
  });

  it('flags ties, dead and ghost notes, and grades the metric position', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('8', [note(1, 0, { dead: true })])
      .beat('8', [note(1, 1, { ghost: true })])
      .beat('4', [note(1, 2, { tie: true })])
      .build({ validate: false });
    const table = noteTableOf(built);
    expect([...table.flags]).toEqual([NOTE_FLAG.dead, NOTE_FLAG.ghost, NOTE_FLAG.tie]);
    expect([...table.metric]).toEqual([METRIC.downbeat, METRIC.offbeat, METRIC.beat]);
  });

  it('counts a repeated bar by its passes', () => {
    const built = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0)])
      .bar()
      .repeatEnd(3)
      .beat('1', [note(1, 2)])
      .build();
    expect([...noteTableOf(built).passes]).toEqual([3, 3]);
  });

  it('re-extracts only the bar that changed', () => {
    const base = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 2)])
      .build();
    noteTableOf(base);
    const before = extraction.count;
    noteTableOf(base);
    expect(extraction.count).toBe(before);

    const track = base.tracks[0];
    const edited = {
      ...base,
      tracks: track ? [{ ...track, bars: [track.bars[0], structuredClone(track.bars[1])] }] : [],
    };
    // `structuredClone` makes a new Bar object, as an edit does.
    noteTableOf(edited as typeof base);
    expect(extraction.count).toBe(before + 1);
  });

  it('puts every array on a transferable buffer', () => {
    const table = noteTableOf(
      score()
        .track('guitar')
        .bar()
        .beat('4', [note(1, 0)])
        .build(),
    );
    expect(table.pitch.buffer).toBeInstanceOf(ArrayBuffer);
    expect(table.onset.buffer).toBeInstanceOf(ArrayBuffer);
  });
});
