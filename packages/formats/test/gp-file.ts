/**
 * Builds small Guitar Pro 3 to 5 files byte by byte, for the paths no fixture exercises
 * (lyrics, a second voice, tempo changes, keyboard tracks). It writes the layout the reader
 * expects, so it proves the mapping, not the layout; the fixtures prove the layout.
 */
export type BuildVersion = '3.00' | '4.00' | '4.06' | '5.00' | '5.10';

class ByteWriter {
  private readonly bytes: number[] = [];

  byte(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  short(value: number): this {
    return this.byte(value).byte(value >> 8);
  }

  int(value: number): this {
    return this.byte(value)
      .byte(value >> 8)
      .byte(value >> 16)
      .byte(value >> 24);
  }

  raw(values: readonly number[]): this {
    for (const value of values) this.byte(value);
    return this;
  }

  zeros(count: number): this {
    return this.raw(Array.from({ length: count }, () => 0));
  }

  private text(value: string): number[] {
    return Array.from(value, (char) => char.charCodeAt(0));
  }

  fixedString(value: string, size: number): this {
    const text = this.text(value).slice(0, size);
    return this.byte(text.length)
      .raw(text)
      .zeros(size - text.length);
  }

  intString(value: string): this {
    return this.int(value.length).raw(this.text(value));
  }

  intByteString(value: string): this {
    return this.int(value.length + 1)
      .byte(value.length)
      .raw(this.text(value));
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export interface NoteSpec {
  /** 1 = highest string. */
  string: number;
  fret: number;
  tie?: boolean;
  /** Note-effect bits (first byte), e.g. 0x02 for a hammer-on origin. */
  effects?: number;
  /** GP5's second note flags byte, e.g. 0x02 to swap accidentals. */
  flags2?: number;
}

export interface BeatSpec {
  /** GP's duration exponent: 0 quarter, -2 whole. */
  duration?: number;
  rest?: boolean;
  notes?: NoteSpec[];
  /** A mixer change carrying only a tempo. */
  tempo?: { bpm: number; duration?: number };
  text?: string;
}

export interface TrackSpec {
  name?: string;
  /** Open strings, string 1 first, as the file lists them. */
  strings?: number[];
  /** 1-based MIDI channel; its program comes from `programs`. */
  channel?: number;
  percussion?: boolean;
  capo?: number;
}

export interface FileSpec {
  version: BuildVersion;
  tempo?: number;
  /** One program per MIDI channel slot, by 1-based channel. */
  programs?: Record<number, number>;
  lyrics?: { track: number; lines: { startBar: number; text: string }[] };
  masterBars?: number;
  tracks: TrackSpec[];
  /** By master bar, then track, then voice: the beats. */
  bars: BeatSpec[][][][];
}

export function buildGpFile(spec: FileSpec): Uint8Array {
  const version = Number(spec.version.replace('.', ''));
  const w = new ByteWriter();
  w.fixedString(`FICHIER GUITAR PRO v${spec.version}`, 30);
  const info = version >= 500 ? 9 : 8;
  for (let i = 0; i < info; i++) w.intByteString(i === 0 ? 'Built' : '');
  w.int(0);
  if (version < 500) w.byte(0);
  if (version >= 400) {
    const lyrics = spec.lyrics ?? { track: 0, lines: [] };
    w.int(lyrics.track);
    for (let i = 0; i < 5; i++) {
      const line = lyrics.lines[i];
      w.int(line?.startBar ?? 0).intString(line?.text ?? '');
    }
  }
  if (version >= 510) w.zeros(19);
  if (version >= 500) {
    w.zeros(28).short(0);
    for (let i = 0; i < 10; i++) w.intByteString('');
    w.intByteString('Moderate');
  }
  w.int(spec.tempo ?? 120);
  if (version >= 510) w.byte(0);
  w.int(0);
  if (version >= 400) w.byte(0);
  for (let channel = 1; channel <= 64; channel++) {
    w.int(spec.programs?.[channel] ?? 25).raw([13, 8, 0, 0, 0, 0, 0, 0]);
  }
  if (version >= 500) {
    for (let i = 0; i < 19; i++) w.short(-1);
    w.int(0);
  }
  const masterBars = spec.masterBars ?? spec.bars.length;
  w.int(masterBars).int(spec.tracks.length);
  for (let i = 0; i < masterBars; i++) {
    w.byte(i === 0 ? 0x03 : 0);
    if (i === 0) w.byte(4).byte(4);
    if (version >= 500) {
      if (i === 0) w.zeros(4);
      w.byte(0).byte(0).byte(0);
    }
  }
  spec.tracks.forEach((track, index) => {
    const strings = track.strings ?? [64, 59, 55, 50, 45, 40];
    w.byte(track.percussion ? 0x01 : 0).fixedString(track.name ?? `Track ${String(index + 1)}`, 40);
    w.int(strings.length);
    for (let i = 0; i < 7; i++) w.int(strings[i] ?? 0);
    const channel = track.channel ?? 1;
    w.int(1)
      .int(channel)
      .int(channel + 1)
      .int(24)
      .int(track.capo ?? 0)
      .raw([255, 0, 0, 0]);
    if (version >= 500) {
      w.raw([0x03, 0, 0, 0, 0]).int(0).int(0).int(0).zeros(10).raw([0, 0]).zeros(16);
      if (version >= 510) w.zeros(4).intByteString('').intByteString('');
    }
  });
  for (const bar of spec.bars) {
    for (const voices of bar) {
      if (version >= 500) w.byte(0);
      const count = version >= 500 ? 2 : 1;
      for (let v = 0; v < count; v++) {
        const beats = voices[v] ?? [];
        w.int(beats.length);
        for (const beat of beats) writeBeat(w, version, beat);
      }
    }
  }
  return w.done();
}

function writeBeat(w: ByteWriter, version: number, beat: BeatSpec): void {
  const flags =
    (beat.rest ? 0x40 : 0) | (beat.text === undefined ? 0 : 0x04) | (beat.tempo ? 0x10 : 0);
  w.byte(flags);
  if (beat.rest) w.byte(0x02);
  w.byte(beat.duration ?? 0);
  if (beat.text !== undefined) w.intByteString(beat.text);
  if (beat.tempo) {
    w.byte(0xff);
    if (version >= 500) w.zeros(16);
    w.raw([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    if (version >= 500) w.intByteString('');
    w.int(beat.tempo.bpm).byte(beat.tempo.duration ?? 0);
    if (version >= 510) w.byte(0);
    if (version >= 400) w.byte(0);
    if (version >= 500) w.byte(0xff);
    if (version >= 510) w.intByteString('').intByteString('');
  }
  const notes = beat.notes ?? [];
  w.byte(notes.reduce((mask, note) => mask | (1 << (7 - note.string)), 0));
  for (const note of [...notes].sort((a, b) => a.string - b.string)) {
    w.byte(0x20 | (note.effects === undefined ? 0 : 0x08));
    w.byte(note.tie ? 2 : 1).byte(note.fret);
    if (version >= 500) w.byte(note.flags2 ?? 0);
    if (note.effects !== undefined) {
      w.byte(note.effects);
      if (version >= 400) w.byte(0);
    }
  }
  if (version >= 500) w.short(0);
}
