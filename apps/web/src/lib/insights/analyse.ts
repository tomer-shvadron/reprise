import {
  expandPlaybackSequence,
  tempoMap,
  type KeySignature,
  type Score,
  type TempoMap,
} from '@reprise/model';

import { chordsUsed, type ChordsInsight } from './chords-used';
import { detectKey, type KeyResult } from './key';
import { keyChanges, type KeyChange } from './key-changes';
import { keyName, scaleName } from './key-names';
import { noteTableOf, type NoteTable } from './note-table';
import { songOutline, type SongOutline } from './outline';
import { sectionInsights, trackScales, type SectionInsight, type Tonality } from './sections';
import { songShape, type SongShape } from './shape';
import { trackStats, type TrackStats } from './track-stats';

/** The key with its readable names, or the reason there is none. */
export type FoundKey = Extract<KeyResult, { found: true }> & {
  runnerUpName: string;
  /** The scale the fit chose, named on the tonic: `A minor pentatonic`. */
  scaleName?: string;
  /** The key signature of the first bar, which is evidence for spelling and nothing more. */
  fileKeySignature?: KeySignature;
};

export type SongKey = Extract<KeyResult, { found: false }> | FoundKey;

/** Plain data: it survives a structured clone, so a worker can post it. */
export interface SongInsights {
  key: SongKey;
  keyChanges: KeyChange[];
  sections: SectionInsight[];
  chords: ChordsInsight;
  shape: SongShape;
  tracks: TrackStats[];
}

const NEUTRAL: KeySignature = { fifths: 0, minor: false };

/**
 * The analysis of a note table and the outline beside it. Both are what a worker receives, so this
 * is the whole analysis; `analyseScore` builds them from a score.
 */
export function analyse(table: NoteTable, outline: SongOutline): SongInsights {
  const fileKey = outline.bars[0]?.keySignature;
  const detected = detectKey(table, fileKey ? { fileKey } : {});
  let key: SongKey;
  let tonality: Tonality | undefined;
  let spelling = fileKey ?? NEUTRAL;
  if (!detected.found) {
    key = detected;
  } else {
    tonality = { tonic: detected.tonic, quality: detected.quality };
    spelling = detected.signature;
    key = {
      ...detected,
      runnerUpName: keyName(detected.runnerUp.tonic, detected.runnerUp.quality, fileKey),
      ...(detected.scale
        ? { scaleName: scaleName(detected.tonic, detected.scale.scale, fileKey) }
        : {}),
      ...(fileKey ? { fileKeySignature: { ...fileKey } } : {}),
    };
  }
  const names = outline.tracks.map((track) => track.name);
  return {
    key,
    keyChanges: keyChanges(table, outline, tonality, fileKey),
    sections: sectionInsights(table, outline, tonality),
    chords: chordsUsed(table, outline, spelling),
    shape: songShape(outline),
    tracks: trackStats(table, outline, spelling, trackScales(table, tonality, names, fileKey)),
  };
}

/** The whole analysis of a score, on the calling thread: for tests and where there is no worker. */
export function analyseScore(score: Score, map?: TempoMap): SongInsights {
  const tempos = map ?? tempoMap(score, expandPlaybackSequence(score).sequence);
  const outline = songOutline(score, tempos);
  return analyse(
    noteTableOf(
      score,
      outline.bars.map((bar) => bar.passes),
    ),
    outline,
  );
}
