import { describe, expect, it } from 'vitest';

import { newId } from '../id';
import { buildScore, expectRefusal, roundTrip } from './test-score';
import { addTrack, moveTrack, removeTrack, setTrackProperties } from './track-commands';

const trackId = (score: ReturnType<typeof buildScore>, index: number): string => {
  const track = score.tracks[index];
  if (!track) throw new Error('no track');
  return track.id;
};

describe('setTrackProperties', () => {
  it('sets properties and merges channel and display', () => {
    const score = buildScore();
    const { score: after } = roundTrip(
      score,
      setTrackProperties(
        { trackId: trackId(score, 0) },
        {
          name: 'Lead',
          color: '#123456',
          capo: 2,
          channel: { volume: 90, mute: true },
          display: { notation: 'both' },
        },
      ),
    );
    expect(after.tracks[0]).toMatchObject({
      name: 'Lead',
      color: '#123456',
      capo: 2,
      channel: { volume: 90, mute: true, pan: 64 },
      display: { notation: 'both', clef: 'treble' },
    });
  });

  it('touches no bars for a mixer change and every bar for a tuning change', () => {
    const score = buildScore();
    const id = trackId(score, 0);
    expect(
      roundTrip(score, setTrackProperties({ trackId: id }, { channel: { solo: true } })).change
        .touchedBars,
    ).toEqual([]);
    const dropD = [38, 45, 50, 55, 59, 64];
    const { change } = roundTrip(score, setTrackProperties({ trackId: id }, { tuning: dropD }));
    expect(change.touchedBars).toEqual(score.masterBars.map((bar) => bar.id));
  });

  it('refuses a tuning that strands notes, a bad colour and a drum capo', () => {
    const score = buildScore();
    expectRefusal(
      score,
      setTrackProperties({ trackId: trackId(score, 0) }, { tuning: [40, 45, 50, 55] }),
      'invariant',
    );
    expectRefusal(
      score,
      setTrackProperties({ trackId: trackId(score, 0) }, { color: 'red' }),
      'invalid-value',
    );
    expectRefusal(
      score,
      setTrackProperties({ trackId: trackId(score, 1) }, { capo: 2 }),
      'invariant',
    );
  });
});

describe('addTrack', () => {
  it('adds a track with one empty bar per master bar', () => {
    const score = buildScore();
    const id = newId();
    const { score: after } = roundTrip(
      score,
      addTrack({ kind: 'fretted', index: 1, id }, { name: 'Bass', tuning: [28, 33, 38, 43] }),
    );
    expect(after.tracks.map((track) => track.id)).toEqual([
      trackId(score, 0),
      id,
      trackId(score, 1),
    ]);
    expect(after.tracks[1]).toMatchObject({ name: 'Bass', tuning: [28, 33, 38, 43] });
    expect(after.tracks[1]?.bars).toHaveLength(score.masterBars.length);
    expect(roundTrip(score, addTrack({ kind: 'pitched' })).score.tracks[2]?.kind).toBe('pitched');
  });

  it('refuses a bad index and an invalid track', () => {
    const score = buildScore();
    expectRefusal(score, addTrack({ kind: 'drums', index: 3 }), 'invalid-value');
    expectRefusal(score, addTrack({ kind: 'drums' }, { tuning: [40] }), 'invariant');
    expectRefusal(score, addTrack({ kind: 'fretted' }, { program: 300 }), 'invalid-value');
  });
});

describe('removeTrack', () => {
  it('removes a track', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, removeTrack({ trackId: trackId(score, 0) }));
    expect(after.tracks.map((track) => track.id)).toEqual([trackId(score, 1)]);
  });

  it('refuses the last track', () => {
    const score = buildScore();
    const single = { ...score, tracks: score.tracks.slice(0, 1) };
    expectRefusal(single, removeTrack({ trackId: trackId(score, 0) }), 'last-track');
  });
});

describe('moveTrack', () => {
  it('reorders tracks', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, moveTrack({ trackId: trackId(score, 1) }, 0));
    expect(after.tracks.map((track) => track.id)).toEqual([trackId(score, 1), trackId(score, 0)]);
  });

  it('refuses an index past the last track', () => {
    const score = buildScore();
    expectRefusal(score, moveTrack({ trackId: trackId(score, 0) }, 2), 'invalid-value');
  });
});
