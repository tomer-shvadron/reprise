import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LANE,
  cursorLane,
  drumLanes,
  noteAtCursor,
  laneLabel,
  laneNear,
  stepLane,
} from './drum-lanes';

const empty = score().track('drums').bar().build().tracks[0];
if (!empty) throw new Error('no track');

describe('drumLanes', () => {
  it('walks the default kit from the kick up to the cymbals, by staff position then key', () => {
    const lanes = drumLanes(empty);
    expect(lanes[0]).toBe(44);
    expect(lanes.at(-1)).toBe(57);
    expect(lanes.indexOf(36)).toBeLessThan(lanes.indexOf(38));
    // The snare and the side stick share a line: the lower key first.
    expect(lanes.indexOf(37)).toBeLessThan(lanes.indexOf(38));
    expect(lanes.indexOf(38)).toBe(lanes.indexOf(37) + 1);
  });

  it('merges in the articulations the track already uses, and ignores unknown keys', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [note(0, 56), note(0, 5)])
      .build();
    const lanes = drumLanes(built.tracks[0] ?? empty);
    expect(lanes).toContain(56);
    expect(lanes).not.toContain(5);
  });
});

describe('stepLane', () => {
  it('moves up the staff on -1 and down on +1', () => {
    expect(stepLane(empty, 36, -1)).toBe(43);
    expect(stepLane(empty, 43, 1)).toBe(36);
  });

  it('stops at both ends', () => {
    expect(stepLane(empty, 44, 1)).toBeUndefined();
    expect(stepLane(empty, 57, -1)).toBeUndefined();
  });

  it('steps from where a key off the list would sit, so the arrows always move', () => {
    // Cowbell (56) is no kit lane: after its last hit is deleted the lane still steps.
    expect(stepLane(empty, 56, -1)).toBe(51);
    expect(stepLane(empty, 56, 1)).toBe(50);
    // An unknown key sits where layout draws it, on position 4.
    expect(stepLane(empty, 5, -1)).toBe(47);
    expect(stepLane(empty, 5, 1)).toBe(45);
  });
});

describe('laneNear', () => {
  it('picks the lane on the nearest line, preferring the current one on a shared line', () => {
    expect(laneNear(empty, 9, undefined)).toBe(42);
    expect(laneNear(empty, 5, 38)).toBe(38);
    expect(laneNear(empty, 5, 37)).toBe(37);
  });

  it('gives the snare on a shared line when the current lane is elsewhere, then the lowest key', () => {
    expect(laneNear(empty, 5, 42)).toBe(38);
    expect(laneNear(empty, 5, undefined)).toBe(38);
    // Position 8 holds the ride (51) and the ride bell (53): the lowest key.
    expect(laneNear(empty, 8, 42)).toBe(51);
  });
});

describe('laneLabel', () => {
  it('names the drum and its key', () => {
    expect(laneLabel(DEFAULT_LANE)).toBe('Acoustic Snare (38)');
  });
});

describe('cursorLane', () => {
  it('reads the cursor lane, else the snare', () => {
    expect(cursorLane({})).toBe(38);
    expect(cursorLane({ pitch: 42 })).toBe(42);
  });
});

describe('noteAtCursor', () => {
  const notes = [
    { string: 0, fret: 36 },
    { string: 0, fret: 42 },
  ];
  it('finds a drum hit by lane and a fretted note by string', () => {
    expect(noteAtCursor({ kind: 'drums' }, notes, { string: 0, pitch: 42 })).toBe(notes[1]);
    expect(noteAtCursor({ kind: 'drums' }, notes, { string: 0 })).toBeUndefined();
    expect(noteAtCursor({ kind: 'fretted' }, notes, { string: 0 })).toBe(notes[0]);
  });
});
