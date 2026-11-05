import {
  createBar,
  createMasterBar,
  createScoreMeta,
  createTrack,
  newId,
  validateScore,
} from '@reprise/model';
import type { MasterBar, Score, Track } from '@reprise/model';

import { BinaryReader, CorruptFile, TruncatedFile } from '../binary/binary-reader';
import { WarningLog } from '../warnings';
import type { Warning } from '../warnings';
import { readVoice } from './beats';
import type { Context } from './context';
import { finishTrack } from './finish';
import { readHeader } from './header';
import type { Header } from './header';
import { applyLyrics } from './lyrics';
import { propagateEndings, readMasterBar } from './master-bars';
import { readTrack } from './tracks';
import type { TrackInfo } from './tracks';
import { formatOf, readVersion } from './version';
import type { GpFormat, GpVersion } from './version';

export interface GpReadResult {
  score: Score;
  warnings: Warning[];
  format: GpFormat;
  /** Major × 100 + minor, as in the header: 300, 400, 406, 500 or 510. */
  version: GpVersion;
}

const DEFAULT_TEMPO = 120;

/**
 * Reads a Guitar Pro 3, 4 or 5 file. Throws `GpVersionError` when the bytes do not start with a
 * version this reader knows; anything else wrong with the file becomes a warning, and a file cut
 * short yields the score read up to the cut.
 */
export function readGp3To5(bytes: Uint8Array): GpReadResult {
  const reader = new BinaryReader(bytes);
  const version = readVersion(reader);
  const log = new WarningLog();
  const context: Context = { reader, version, log, noteFacts: new WeakMap() };

  const partialHeader: Partial<Header> = {};
  let header: Header | undefined;
  const masterBars: MasterBar[] = [];
  const infos: TrackInfo[] = [];
  try {
    header = readHeader(context, partialHeader);
    for (let i = 0; i < header.masterBarCount; i++) {
      masterBars.push(readMasterBar(context, header, masterBars));
    }
    for (let t = 0; t < header.trackCount; t++) infos.push(readTrack(context, header, t));
    for (let b = 0; b < masterBars.length; b++) {
      infos.forEach((info, t) => {
        readBar(context, info, b, t);
      });
    }
    const trailingOffset = reader.offset;
    // GP3 files end with four zero bytes; padding carries nothing worth reporting.
    if (reader.bytesOf(reader.remaining).some((byte) => byte !== 0)) {
      log.info('trailing-data', 'data after the last bar', { offset: trailingOffset });
    }
  } catch (error) {
    if (error instanceof TruncatedFile) {
      log.add('truncated-file', 'error', `${error.message}; the score stops there`, {
        offset: error.offset,
      });
    } else if (error instanceof CorruptFile) {
      log.add('corrupt-file', 'error', `${error.message}; the score stops there`, {
        offset: error.offset,
      });
    } else {
      throw error;
    }
  }

  const score = assemble(context, header ?? partialHeader, masterBars, infos);
  const warnings = log.list();
  for (const violation of validateScore(score)) {
    warnings.push({
      code: violation.rule,
      severity: 'warning',
      message: violation.message,
      location: { path: violation.path },
    });
  }
  return { score, warnings, format: formatOf(version), version };
}

function readBar(context: Context, info: TrackInfo, barIndex: number, trackIndex: number): void {
  const bar = createBar();
  info.track.bars.push(bar);
  // GP5 opens each bar with a byte Guitar Pro uses for line breaks.
  if (context.version >= 500) context.reader.skip(1);
  const voiceCount = context.version >= 500 ? 2 : 1;
  for (let voice = 0; voice < voiceCount; voice++) {
    readVoice(context, info, bar.voices[voice]?.beats ?? [], {
      track: trackIndex,
      bar: barIndex,
      voice,
    });
  }
}

function assemble(
  context: Context,
  header: Partial<Header>,
  masterBars: MasterBar[],
  infos: TrackInfo[],
): Score {
  if (masterBars.length === 0) masterBars.push(createMasterBar());
  const first = masterBars[0];
  if (first) {
    const { tempo = DEFAULT_TEMPO, tempoLabel = '', tempoOffset } = header;
    first.tempo = { bpm: tempo > 0 ? tempo : DEFAULT_TEMPO };
    if (tempoLabel !== '') first.tempo.label = tempoLabel;
    if (tempo <= 0 && tempoOffset !== undefined) {
      context.log.warn('invalid-value', `tempo ${String(tempo)} is out of range; read as 120`, {
        offset: tempoOffset,
      });
    }
  }
  propagateEndings(masterBars);

  const tracks: Track[] = infos.map((info) => info.track);
  if (tracks.length === 0) tracks.push(createTrack('fretted', { barCount: 0 }));
  for (const track of tracks) {
    while (track.bars.length < masterBars.length) track.bars.push(createBar());
  }
  infos.forEach((info, t) => {
    finishTrack(context, info, masterBars, t);
  });

  const lyrics = header.lyrics;
  if (lyrics && lyrics.lines.some((line) => line.text !== '')) {
    const track = tracks[lyrics.track];
    if (track) {
      track.lyrics = lyrics.lines;
      applyLyrics(track, lyrics, context.log);
    } else {
      context.log.warn(
        'lyrics-unplaced',
        `the lyrics belong to track ${String(lyrics.track + 1)}, which the file does not have`,
        { offset: lyrics.offset },
      );
    }
  }

  return {
    id: newId(),
    meta: header.meta ?? createScoreMeta(),
    masterBars,
    tracks,
  };
}
