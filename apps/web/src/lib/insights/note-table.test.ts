import { PPQ, soundingPitch, type Bend } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { METRIC, NOTE_FLAG, TECH, extraction, noteTableOf } from './note-table';

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

    // An edit makes a new Bar and a new track object, as the commands do.
    const [track] = base.tracks;
    if (!track) throw new Error('no track');
    const [first, second] = track.bars;
    if (!first || !second) throw new Error('no bars');
    const edited = { ...base, tracks: [{ ...track, bars: [first, structuredClone(second)] }] };
    noteTableOf(edited);
    expect(extraction.count).toBe(before + 1);
  });

  describe('the cache follows what the pitches depend on', () => {
    const base = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .build();
    const [track] = base.tracks;
    if (!track) throw new Error('no track');

    it('re-extracts the same bars for a new capo', () => {
      noteTableOf(base);
      const before = extraction.count;
      const table = noteTableOf({ ...base, tracks: [{ ...track, capo: 3 }] });
      expect(extraction.count).toBe(before + 1);
      expect(table.pitch[0]).toBe(67);
    });

    it('re-extracts the same bars for a new tuning', () => {
      noteTableOf(base);
      const before = extraction.count;
      const dropped = [...track.tuning];
      dropped[dropped.length - 1] = (dropped[dropped.length - 1] ?? 64) - 2;
      const table = noteTableOf({ ...base, tracks: [{ ...track, tuning: dropped }] });
      expect(extraction.count).toBe(before + 1);
      expect(table.pitch[0]).toBe(62);
    });

    it('re-extracts the same bars for a new time signature, with the new metric', () => {
      const first = noteTableOf(base);
      expect([...first.metric]).toEqual([0, 1, 1, 1]);
      const [masterBar] = base.masterBars;
      if (!masterBar) throw new Error('no master bar');
      const before = extraction.count;
      const meter = { ...masterBar, timeSignature: { numerator: 4, denominator: 8 as const } };
      const table = noteTableOf({ ...base, masterBars: [meter] });
      expect(extraction.count).toBe(before + 1);
      // Eighth-note beats: the quarters still land on beats, so only the cache key changed.
      expect([...table.metric]).toEqual([0, 1, 1, 1]);
    });
  });

  it('reads grace notes as 64th-note ornaments off the beat, flagged', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], {
        grace: [{ duration: 64, before: true, notes: [note(1, 3)] }],
      })
      .build();
    const table = noteTableOf(built);
    expect(table.length).toBe(2);
    expect(table.duration[0]).toBe(PPQ / 16);
    expect(table.metric[0]).toBe(METRIC.offbeat);
    expect(table.flags[0]).toBe(NOTE_FLAG.grace);
    expect(table.flags[1]).toBe(0);
  });

  it('reads harmonics by their sounding pitch', () => {
    const natural = note(1, 5, { harmonic: { kind: 'natural' } });
    const artificial = note(2, 3, { harmonic: { kind: 'artificial', value: 12 } });
    const built = score().track('guitar').bar().beat('4', [natural, artificial]).build();
    const [track] = built.tracks;
    if (!track) throw new Error('no track');
    const table = noteTableOf(built);
    expect([...table.pitch]).toEqual([
      soundingPitch(track, natural),
      soundingPitch(track, artificial),
    ]);
    expect(table.pitch[0]).not.toBe(64 + 5);
    expect(table.flags[0]).toBe(NOTE_FLAG.harmonic);
  });

  it('reads a pitched track by its MIDI notes', () => {
    const built = score()
      .track('piano')
      .bar()
      .beat('4', [midi(60), midi(67)])
      .build();
    expect([...noteTableOf(built).pitch]).toEqual([60, 67]);
  });

  it('skips a note on a string the tuning lacks and keeps the rest of the bar', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0), note(9, 0)])
      .beat('4', [note(2, 0)])
      .build({ validate: false });
    expect([...noteTableOf(built).pitch]).toEqual([64, 59]);
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

describe('noteTableOf, techniques and positions', () => {
  it('carries the string and fret of a fretted track and none for a pitched one', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(2, 7), note(5, 0)])
      .track('piano')
      .bar()
      .beat('4', [midi(60)])
      .build();
    const table = noteTableOf(built);
    expect([...table.string]).toEqual([2, 5, 0]);
    expect([...table.fret]).toEqual([7, 0, 0]);
  });

  it('sets a bit for each technique of a note and of its beat', () => {
    const wide: Bend = {
      kind: 'bend',
      points: [
        { position: 0, value: 0 },
        { position: 60, value: 4 },
      ],
    };
    const narrow: Bend = {
      kind: 'bend',
      points: [
        { position: 0, value: 0 },
        { position: 60, value: 2 },
      ],
    };
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 5, { bend: wide })])
      .beat('4', [note(1, 5, { bend: narrow })])
      .beat('4', [
        note(1, 5, { slide: ['legato'], hammerPull: true, palmMute: true, letRing: true }),
      ])
      .beat('4', [note(1, 5, { harmonic: { kind: 'pinch' } })], {
        effects: { tapping: true, slapping: true },
      })
      .bar()
      .beat(
        '4',
        [note(1, 5, { harmonic: { kind: 'natural' }, accent: 'accent', staccato: true })],
        {
          effects: {
            tremoloPicking: 16,
            whammy: {
              kind: 'dive',
              points: [
                { position: 0, value: 0 },
                { position: 60, value: -4 },
              ],
            },
          },
        },
      )
      .beat('4', [note(1, 5)], {
        effects: { vibrato: 'slight', arpeggio: { direction: 'down' }, brush: { direction: 'up' } },
      })
      .beat('4', [note(1, 5, { trill: { fret: 7, speed: 16 } })], { effects: { popping: true } })
      .build();
    const { tech } = noteTableOf(built);
    expect(tech[0]).toBe(TECH.bend | TECH.bendWide);
    expect(tech[1]).toBe(TECH.bend);
    expect(tech[2]).toBe(TECH.slide | TECH.hammerPull | TECH.palmMute | TECH.letRing);
    expect(tech[3]).toBe(TECH.harmonicHard | TECH.tapping | TECH.slap);
    expect(tech[4]).toBe(TECH.accent | TECH.staccato | TECH.tremoloPicking | TECH.whammy);
    expect(tech[5]).toBe(TECH.vibrato | TECH.arpeggio | TECH.brush);
    expect(tech[6]).toBe(TECH.trill | TECH.pop);
  });
});
