import { createScoreMeta } from '@reprise/model';
import type { DirectionTarget, JumpKind, LyricLine, ScoreMeta } from '@reprise/model';

import { CorruptFile } from '../binary/binary-reader';
import type { Context } from './context';

/** One of the 64 MIDI channel slots every file carries, in the file's 0 to 16 mixer scale. */
export interface MidiChannel {
  program: number;
  volume: number;
  pan: number;
  chorus: number;
  reverb: number;
  phaser: number;
  tremolo: number;
}

export interface LyricsBlock {
  /** 0-based track index, -1 for none. */
  track: number;
  lines: LyricLine[];
  offset: number;
}

export type Direction = { target: DirectionTarget } | { jump: JumpKind };

export interface Header {
  meta: ScoreMeta;
  /** GP3 and GP4 set triplet feel for the whole song; GP5 sets it per bar. */
  tripletFeel: boolean;
  lyrics: LyricsBlock | undefined;
  tempo: number;
  tempoLabel: string;
  tempoOffset: number;
  channels: MidiChannel[];
  /** Directions by 0-based master-bar index (GP5). */
  directions: Map<number, Direction[]>;
  masterBarCount: number;
  trackCount: number;
}

/** GP5's 19 direction slots, in file order: five targets, then fourteen jumps. */
const DIRECTION_SLOTS: readonly Direction[] = [
  { target: 'coda' },
  { target: 'doubleCoda' },
  { target: 'segno' },
  { target: 'segnoSegno' },
  { target: 'fine' },
  { jump: 'daCapo' },
  { jump: 'dcAlCoda' },
  { jump: 'dcAlDoubleCoda' },
  { jump: 'dcAlFine' },
  { jump: 'dalSegno' },
  { jump: 'dsAlCoda' },
  { jump: 'dsAlDoubleCoda' },
  { jump: 'dsAlFine' },
  { jump: 'dalSegnoSegno' },
  { jump: 'dssAlCoda' },
  { jump: 'dssAlDoubleCoda' },
  { jump: 'dssAlFine' },
  { jump: 'toCoda' },
  { jump: 'toDoubleCoda' },
];

/** Guitar Pro caps both at these; anything larger is a corrupt count, not a big song. */
const MAX_TRACKS = 127;
const MAX_MASTER_BARS = 2048;
const LYRIC_LINE_COUNT = 5;

/**
 * Reads everything before the master bars. The caller passes `partial`, which this fills in
 * as it goes, so a file that ends inside the header still yields its metadata.
 */
export function readHeader(context: Context, partial: Partial<Header>): Header {
  const { reader, version, log } = context;
  // Header metadata trusts the length byte: some writers put the field's capacity in the int.
  const text = (): string => reader.intByteString('byte');
  const meta = createScoreMeta();
  partial.meta = meta;
  meta.title = text();
  meta.subtitle = text();
  meta.artist = text();
  meta.album = text();
  meta.words = text();
  // GP3 and GP4 have one "author" field; GP5 splits words from music.
  meta.music = version >= 500 ? text() : meta.words;
  meta.copyright = text();
  meta.tab = text();
  meta.instructions = text();
  const noticeOffset = reader.offset;
  const noticeLines = reader.int();
  if (noticeLines < 0) throw new CorruptFile(noticeOffset, `${String(noticeLines)} notice lines`);
  for (let i = 0; i < noticeLines; i++) meta.notices.push(text());

  partial.tripletFeel = version < 500 ? reader.bool() : false;
  if (version >= 400) partial.lyrics = readLyrics(context);

  if (version >= 510) {
    log.info('rse-dropped', 'RSE master effect settings are not modelled', {
      offset: reader.offset,
    });
    reader.skip(19);
  }
  partial.tempoLabel = '';
  if (version >= 500) {
    readPageSetup(context);
    partial.tempoLabel = reader.intByteString('int');
  }
  partial.tempoOffset = reader.offset;
  partial.tempo = reader.int();
  if (version >= 510 && reader.bool()) {
    log.info('hidden-tempo-dropped', 'a hidden tempo mark is shown', {
      offset: reader.offset - 1,
    });
  }
  const keyOffset = reader.offset;
  const key = reader.int();
  const octave = version >= 400 ? reader.signedByte() : 0;
  if (key !== 0 || octave !== 0) {
    log.info(
      'song-key-dropped',
      `the song-level key (${String(key)}) and octave (${String(octave)}) are not modelled; bar key signatures are kept`,
      { offset: keyOffset },
    );
  }
  partial.channels = readChannels(context);
  partial.directions = version >= 500 ? readDirections(context) : new Map<number, Direction[]>();

  const countOffset = reader.offset;
  const masterBarCount = reader.int();
  const trackCount = reader.int();
  if (masterBarCount < 1 || masterBarCount > MAX_MASTER_BARS) {
    throw new CorruptFile(countOffset, `${String(masterBarCount)} bars`);
  }
  if (trackCount < 1 || trackCount > MAX_TRACKS) {
    throw new CorruptFile(countOffset + 4, `${String(trackCount)} tracks`);
  }
  return {
    meta,
    tripletFeel: partial.tripletFeel,
    lyrics: partial.lyrics,
    tempo: partial.tempo,
    tempoLabel: partial.tempoLabel,
    tempoOffset: partial.tempoOffset,
    channels: partial.channels,
    directions: partial.directions,
    masterBarCount,
    trackCount,
  };
}

function readLyrics(context: Context): LyricsBlock {
  const { reader } = context;
  const offset = reader.offset;
  const track = reader.int() - 1;
  const lines: LyricLine[] = [];
  for (let i = 0; i < LYRIC_LINE_COUNT; i++) {
    // GP numbers the starting bar from 1; an unused line may hold 0.
    const startBar = Math.max(0, reader.int() - 1);
    lines.push({ startBar, text: reader.intString() });
  }
  return { track, lines, offset };
}

function readPageSetup(context: Context): void {
  const { reader, log } = context;
  log.info('page-setup-dropped', 'page size, margins and header and footer templates', {
    offset: reader.offset,
  });
  // Page width and height, four margins and the score size, as ints; then a flags short.
  reader.skip(7 * 4 + 2);
  // Ten header and footer templates: title, subtitle, artist, album, words, music, words and
  // music, two copyright lines, and the page number.
  for (let i = 0; i < 10; i++) reader.intByteString('int');
}

function readChannels(context: Context): MidiChannel[] {
  const { reader } = context;
  const channels: MidiChannel[] = [];
  for (let i = 0; i < 64; i++) {
    channels.push({
      program: reader.int(),
      volume: reader.byte(),
      pan: reader.byte(),
      chorus: reader.byte(),
      reverb: reader.byte(),
      phaser: reader.byte(),
      tremolo: reader.byte(),
    });
    // Two bytes of padding Guitar Pro never fills.
    reader.skip(2);
  }
  return channels;
}

function readDirections(context: Context): Map<number, Direction[]> {
  const { reader, log } = context;
  const directions = new Map<number, Direction[]>();
  for (const slot of DIRECTION_SLOTS) {
    // A 1-based bar number, or -1 when the direction is not used.
    const bar = reader.short();
    if (bar <= 0) continue;
    const list = directions.get(bar - 1) ?? [];
    list.push(slot);
    directions.set(bar - 1, list);
  }
  const reverbOffset = reader.offset;
  const reverb = reader.int();
  if (reverb !== 0) {
    log.info('master-reverb-dropped', `master reverb ${String(reverb)} is not modelled`, {
      offset: reverbOffset,
    });
  }
  return directions;
}
