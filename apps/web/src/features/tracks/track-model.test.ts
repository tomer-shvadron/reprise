import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  audibleTracks,
  effectiveMix,
  nextVisibility,
  notationChoices,
  panText,
  stepTrackId,
  trackLabel,
  volumeText,
} from './track-model';

const song = () =>
  score()
    .track('guitar', { name: 'Lead' })
    .track('bass')
    .track('drums')
    .track('piano', { tuning: [] })
    .build();

function tracksOf() {
  const tracks = song().tracks;
  const [a, b, c, d] = tracks;
  if (!a || !b || !c || !d) throw new Error('four tracks');
  return { tracks, a, b, c, d };
}

describe('track model', () => {
  it('puts the override over the file’s mute and solo, both ways', () => {
    const { a } = tracksOf();
    expect(effectiveMix(a, undefined)).toEqual({ mute: false, solo: false });
    expect(effectiveMix(a, { mute: true })).toEqual({ mute: true, solo: false });
    const soloed = { ...a, channel: { ...a.channel, solo: true } };
    expect(effectiveMix(soloed, undefined).solo).toBe(true);
    expect(effectiveMix(soloed, { solo: false }).solo).toBe(false);
  });

  it('finds the audible tracks: no solo, one solo, mute beats solo, a solo from the file', () => {
    const { tracks, a, b, c, d } = tracksOf();
    expect([...audibleTracks(tracks, {})]).toEqual([a.id, b.id, c.id, d.id]);
    expect([...audibleTracks(tracks, { [b.id]: { solo: true } })]).toEqual([b.id]);
    expect([...audibleTracks(tracks, { [b.id]: { solo: true, mute: true } })]).toEqual([]);
    const fromFile = tracks.map((track) =>
      track.id === c.id ? { ...track, channel: { ...track.channel, solo: true } } : track,
    );
    expect([...audibleTracks(fromFile, {})]).toEqual([c.id]);
  });

  it('keeps the multitrack set in score order, as all when full, and never empty', () => {
    const { tracks, a, b, c, d } = tracksOf();
    expect(nextVisibility(tracks, 'all', b.id, false)).toEqual([a.id, c.id, d.id]);
    expect(nextVisibility(tracks, [d.id, a.id, c.id], b.id, true)).toBe('all');
    expect(nextVisibility(tracks, [c.id], c.id, false)).toBeUndefined();
  });

  it('offers notation choices only to a track with strings that is not drums', () => {
    const { a, c, d } = tracksOf();
    expect(notationChoices(a)).toEqual(['tab', 'standard', 'both']);
    expect(notationChoices(c)).toEqual([]);
    expect(notationChoices(d)).toEqual([]);
  });

  it('steps the current track, clamped at both ends', () => {
    const { tracks, a, b, d } = tracksOf();
    expect(stepTrackId(tracks, a.id, 1)).toBe(b.id);
    expect(stepTrackId(tracks, a.id, -1)).toBe(a.id);
    expect(stepTrackId(tracks, d.id, 1)).toBe(d.id);
    expect(stepTrackId(tracks, undefined, 1)).toBe(a.id);
  });

  it('writes volume and pan texts', () => {
    expect(volumeText(100)).toBe('79%');
    expect(volumeText(127)).toBe('100%');
    expect(panText(64)).toEqual({ short: 'C', spoken: 'centre' });
    expect(panText(0)).toEqual({ short: 'L 100', spoken: '100% left' });
    expect(panText(127)).toEqual({ short: 'R 100', spoken: '100% right' });
    expect(panText(63).short).toBe('L 2');
  });

  it('names a blank track by its position', () => {
    expect(trackLabel({ name: '  ' }, 2)).toBe('Track 3');
    expect(trackLabel({ name: 'Lead' }, 0)).toBe('Lead');
  });
});
