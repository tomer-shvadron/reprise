import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LANE, drumLanes, laneLabel, laneNear, stepLane } from './drum-lanes';

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

  it('refuses a key that is not on the list', () => {
    expect(stepLane(empty, 5, -1)).toBeUndefined();
  });
});

describe('laneNear', () => {
  it('picks the lane on the nearest line, preferring the current one on a shared line', () => {
    expect(laneNear(empty, 9, undefined)).toBe(42);
    expect(laneNear(empty, 5, 38)).toBe(38);
    expect(laneNear(empty, 5, 37)).toBe(37);
  });
});

describe('laneLabel', () => {
  it('names the drum and its key', () => {
    expect(laneLabel(DEFAULT_LANE)).toBe('Acoustic Snare (38)');
  });
});
