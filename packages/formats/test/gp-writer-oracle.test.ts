import * as alphaTab from '@coderline/alphatab';
import { midiNote, type Score } from '@reprise/model';
import { fullScore, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { readGp, readGp3To5, writeGp } from '../src/index';
import { countNotes, fixtureBytes, manifestEntries } from './corpus';
import { kitchenSink } from './kitchen-sink';

/**
 * alphaTab stands in for Guitar Pro, which cannot run here: every file the writer makes must
 * load in alphaTab's Guitar Pro 7 importer with the same tracks, bars and notes, and every note
 * at the same pitch and rhythm position. alphaTab is a dev-only dependency, used only in tests.
 */
function loadWithAlphaTab(bytes: Uint8Array): alphaTab.model.Score {
  const settings = new alphaTab.Settings();
  settings.core.logLevel = alphaTab.LogLevel.None;
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
}

/** Every main (non-grace) beat as track, bar, voice and index, with the sounding pitches it plays. */
function ourBeats(score: Score): string[] {
  const result: string[] = [];
  score.tracks.forEach((track, t) => {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        voice.beats.forEach((beat, i) => {
          const pitches = beat.notes.map((note) => midiNote(track, note)).sort((x, y) => x - y);
          result.push(`${String(t)}/${String(b)}/${String(v)}/${String(i)}: ${pitches.join(' ')}`);
        });
      });
    });
  });
  return result;
}

function theirBeats(score: alphaTab.model.Score): string[] {
  const result: string[] = [];
  score.tracks.forEach((track, t) => {
    const staff = track.staves[0];
    staff?.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        let index = 0;
        for (const beat of voice.beats) {
          if (beat.graceType !== alphaTab.model.GraceType.None || voice.isEmpty) continue;
          const pitches = beat.notes
            .map((note) =>
              note.isPercussion
                ? (track.percussionArticulations[note.percussionArticulation]?.outputMidiNumber ??
                  -1)
                : note.realValueWithoutHarmonic,
            )
            .sort((x, y) => x - y);
          result.push(
            `${String(t)}/${String(b)}/${String(v)}/${String(index)}: ${pitches.join(' ')}`,
          );
          index++;
        }
      });
    });
  });
  return result;
}

const sources: [string, () => Score][] = [
  ...manifestEntries(['gp']).map((entry): [string, () => Score] => [
    entry.path,
    () => readGp(fixtureBytes(entry.path)).score,
  ]),
  ...manifestEntries(['gp3', 'gp4', 'gp5']).map((entry): [string, () => Score] => [
    `${entry.path} exported to gp`,
    () => readGp3To5(fixtureBytes(entry.path)).score,
  ]),
  ['fullScore()', fullScore],
  ['the kitchen sink', kitchenSink],
  ['largeScore(4, 32, { structure: true })', () => largeScore(4, 32, { structure: true })],
];

describe('alphaTab reads what the writer writes', () => {
  it.each(sources)('%s', (_, build) => {
    const source = build();
    const { bytes } = writeGp(source);
    const read = loadWithAlphaTab(bytes);
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
    // Beat by beat against our own reader of the same bytes, which drops what the writer reported.
    expect(theirBeats(read)).toEqual(ourBeats(readGp(bytes).score));
  });
});
