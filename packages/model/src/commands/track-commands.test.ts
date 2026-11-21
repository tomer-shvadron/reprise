import { describe, expect, it } from 'vitest';

import { createHistory } from '../history';
import { newId } from '../id';
import { ScoreSchema } from '../score';
import { validateScore } from '../validate';
import { note } from '../testing';
import { buildScore, expectRefusal, roundTrip } from './test-score';
import { addTrack, moveTrack, removeTrack, setTrackProperties } from './track-commands';

const trackId = (score: ReturnType<typeof buildScore>, index: number): string => {
  const track = score.tracks[index];
  if (!track) throw new Error('no track');
  return track.id;
};

describe('setTrackProperties courses and drone', () => {
  it('refuses courses that do not match the string count', () => {
    const score = buildScore();
    expectRefusal(
      score,
      setTrackProperties({ trackId: trackId(score, 0) }, { courses: [0, 0, 0, 0] }),
      'invariant',
    );
  });

  it('still edits a track whose stored courses already break the rule', () => {
    const score = buildScore();
    const track = score.tracks[0];
    if (!track) throw new Error('no track');
    track.courses = [0, 0, 0, 0];
    // Not `roundTrip`: the score is already invalid, which that helper rejects.
    const { score: after } = createHistory().apply(
      score,
      setTrackProperties({ trackId: track.id }, { name: 'Renamed', channel: { volume: 80 } }),
    );
    expect(after.tracks[0]).toMatchObject({ name: 'Renamed', courses: [0, 0, 0, 0] });
  });

  it('sets a 12-string course set and refuses a drone off the strings', () => {
    const score = buildScore();
    const id = trackId(score, 0);
    const { score: after } = roundTrip(
      score,
      setTrackProperties({ trackId: id }, { courses: [12, 12, 12, 12, 0, 0] }),
    );
    expect(after.tracks[0]?.courses).toEqual([12, 12, 12, 12, 0, 0]);
    expectRefusal(
      score,
      setTrackProperties({ trackId: id }, { drone: { string: 9, fret: 5 } }),
      'invariant',
    );
  });

  it('refuses a drone that strands a note above its shorter neck', () => {
    const score = buildScore();
    const track = score.tracks[0];
    const beat = track?.bars[0]?.voices[0].beats[0];
    if (!track || !beat) throw new Error('no beat');
    beat.notes = [note(5, 20)];
    expectRefusal(
      score,
      setTrackProperties({ trackId: track.id }, { drone: { string: 5, fret: 5 } }),
      'invariant',
    );
  });

  it('removes the drone and the courses with null', () => {
    const score = buildScore();
    const track = score.tracks[0];
    if (!track) throw new Error('no track');
    track.courses = [12, 12, 12, 12, 0, 0];
    track.drone = { string: 5, fret: 5 };
    const { score: after } = roundTrip(
      score,
      setTrackProperties({ trackId: track.id }, { drone: null, courses: null }),
    );
    expect(after.tracks[0]).not.toHaveProperty('drone');
    expect(after.tracks[0]).not.toHaveProperty('courses');
  });

  it('refuses a tuning change that drops the drone string', () => {
    const score = buildScore();
    const track = score.tracks[0];
    if (!track) throw new Error('no track');
    track.tuning = [67, 50, 55, 59, 62];
    track.drone = { string: 5, fret: 5 };
    for (const bar of track.bars) {
      for (const beat of bar.voices[0].beats) beat.notes = [];
    }
    expectRefusal(
      score,
      setTrackProperties({ trackId: track.id }, { tuning: [50, 55, 59, 62] }),
      'invariant',
    );
  });
});

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

describe('setTrackProperties fret ceiling', () => {
  // The guitar's highest note sits at fret 22 on 24 frets.
  it('refuses a fret count that strands a note; the capo does not move the ceiling', () => {
    const score = buildScore();
    const id = trackId(score, 0);
    expectRefusal(score, setTrackProperties({ trackId: id }, { fretCount: 21 }), 'invariant');
    const { score: after } = roundTrip(
      score,
      setTrackProperties({ trackId: id }, { capo: 7, fretCount: 22 }),
    );
    expect(after.tracks[0]).toMatchObject({ capo: 7, fretCount: 22 });
  });

  it('tolerates a note an import left above the ceiling', () => {
    const imported = ScoreSchema.parse(JSON.parse(JSON.stringify(buildScore())));
    const guitar = imported.tracks[0];
    if (!guitar) throw new Error('no guitar');
    guitar.fretCount = 20;
    expect(validateScore(imported).map((violation) => violation.rule)).toEqual(['fret-range']);
    const history = createHistory();
    const { score: after } = history.apply(
      imported,
      setTrackProperties({ trackId: guitar.id }, { fretCount: 21 }),
    );
    expect(validateScore(after).map((violation) => violation.rule)).toEqual(['fret-range']);
    expect(history.undo()?.score).toEqual(imported);
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
