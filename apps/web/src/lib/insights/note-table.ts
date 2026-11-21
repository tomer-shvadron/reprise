import {
  PPQ,
  beatTicks,
  expandPlaybackSequence,
  soundingPitch,
  type Bar,
  type Beat,
  type MasterBar,
  type Note,
  type Score,
  type Track,
} from '@reprise/model';

/** Bits of `NoteTable.flags`. */
export const NOTE_FLAG = {
  tie: 1,
  dead: 2,
  ghost: 4,
  grace: 8,
  harmonic: 16,
} as const;

/**
 * Bits of `NoteTable.tech`: what the player does to a note or its beat. Beat-level effects
 * (tapping, tremolo picking, whammy, slap, pop, arpeggio, brush) are set on every note of the beat.
 */
export const TECH = {
  bend: 1,
  /** A bend that reaches a whole tone or more (4 quarter tones). */
  bendWide: 2,
  slide: 4,
  hammerPull: 8,
  vibrato: 16,
  palmMute: 32,
  letRing: 64,
  trill: 128,
  staccato: 256,
  accent: 512,
  /** Artificial, pinch, tapped, semi and feedback harmonics: the ones that take effort. */
  harmonicHard: 1024,
  tapping: 2048,
  tremoloPicking: 4096,
  whammy: 8192,
  slap: 16384,
  pop: 32768,
  arpeggio: 65536,
  brush: 131072,
} as const;

/** The names of `TECH` bits, for the counts a track shows. */
export type TechName = keyof typeof TECH;

/** A bend of this many quarter tones or more is a whole tone: GP bend units are quarter tones. */
const WIDE_BEND = 4;

/** Where a note sits in its bar: the downbeat, another beat of the time signature, or off the beat. */
export const METRIC = { downbeat: 0, beat: 1, offbeat: 2 } as const;

/**
 * One row per sounding note of every pitched or fretted track, as parallel typed arrays so the
 * table can be transferred to a worker without a structured clone. Drum tracks have no rows.
 */
export interface NoteTable {
  length: number;
  /** Sounding MIDI pitch, capo and harmonics included. */
  pitch: Uint8Array;
  /** Index into `Score.tracks`. */
  track: Uint16Array;
  /** Master bar index. */
  bar: Uint32Array;
  voice: Uint8Array;
  /** A running beat index; the notes of one beat are adjacent and share it. */
  beat: Uint32Array;
  /** Ticks into the bar. */
  onset: Float64Array;
  /** Ticks. */
  duration: Float64Array;
  metric: Uint8Array;
  flags: Uint8Array;
  /** `TECH` bits. */
  tech: Uint32Array;
  /** 1-based string (1 = highest) on a fretted track, 0 on a pitched one. */
  string: Uint8Array;
  /** Fret on a fretted track, 0 on a pitched one. */
  fret: Uint8Array;
  /** How many times playback passes the note's bar. */
  passes: Uint16Array;
}

interface Row {
  pitch: number;
  voice: number;
  beat: number;
  onset: number;
  duration: number;
  metric: number;
  flags: number;
  tech: number;
  string: number;
  fret: number;
}

interface BarRows {
  /** What the pitches depend on besides the bar: see `pitchBasis`. */
  basis: string;
  rows: Row[];
  beats: number;
}

// An edit replaces the bar it touches, so a bar's rows stay valid until its object changes. An edit
// also makes a new track object, so the cache compares what the rows depend on, not identities.
const cache = new WeakMap<Bar, BarRows>();

/** How many bars `noteTableOf` extracted rather than reused. A test hook: `index.ts` does not export it. */
export const extraction = { count: 0 };

/** The track and time signature facts the rows are built from: a retune, a capo or a new meter changes them. */
const pitchBasis = (track: Track, masterBar: MasterBar): string =>
  `${track.kind}|${String(track.capo)}|${track.tuning.join(',')}|${String(masterBar.timeSignature.numerator)}/${String(masterBar.timeSignature.denominator)}`;

function rowsOf(bar: Bar, track: Track, masterBar: MasterBar): BarRows {
  const basis = pitchBasis(track, masterBar);
  const hit = cache.get(bar);
  if (hit?.basis === basis) return hit;
  extraction.count++;
  const beatLength = (PPQ * 4) / masterBar.timeSignature.denominator;
  const rows: Row[] = [];
  let beats = 0;
  bar.voices.forEach((voice, voiceIndex) => {
    let onset = 0;
    for (const beat of voice.beats) {
      const length = beatTicks(beat);
      const at = (ticks: number, grace: boolean): number => {
        if (grace) return METRIC.offbeat;
        if (ticks < 1e-6) return METRIC.downbeat;
        return Math.abs(ticks / beatLength - Math.round(ticks / beatLength)) < 1e-6
          ? METRIC.beat
          : METRIC.offbeat;
      };
      for (const grace of beat.grace ?? []) {
        const graceTicks = (PPQ * 4) / grace.duration;
        let any = false;
        for (const note of grace.notes) {
          const made = row(
            track,
            undefined,
            note,
            voiceIndex,
            beats,
            onset,
            graceTicks,
            at(onset, true),
            true,
          );
          if (made) rows.push(made);
          any ||= made !== undefined;
        }
        if (any) beats++;
      }
      if (!beat.rest) {
        let any = false;
        for (const note of beat.notes) {
          const made = row(
            track,
            beat,
            note,
            voiceIndex,
            beats,
            onset,
            length,
            at(onset, false),
            false,
          );
          if (made) rows.push(made);
          any ||= made !== undefined;
        }
        if (any) beats++;
      }
      onset += length;
    }
  });
  const built = { basis, rows, beats };
  cache.set(bar, built);
  return built;
}

function techOf(note: Note, beat: Beat | undefined): number {
  const effects = beat?.effects;
  const wide = note.bend?.points.some((point) => Math.abs(point.value) >= WIDE_BEND) ?? false;
  const hard = note.harmonic !== undefined && note.harmonic.kind !== 'natural';
  return (
    (note.bend ? TECH.bend : 0) |
    (wide ? TECH.bendWide : 0) |
    (note.slide && note.slide.length > 0 ? TECH.slide : 0) |
    (note.hammerPull ? TECH.hammerPull : 0) |
    (note.vibrato !== 'none' || (effects?.vibrato !== undefined && effects.vibrato !== 'none')
      ? TECH.vibrato
      : 0) |
    (note.palmMute ? TECH.palmMute : 0) |
    (note.letRing ? TECH.letRing : 0) |
    (note.trill ? TECH.trill : 0) |
    (note.staccato ? TECH.staccato : 0) |
    (note.accent === 'none' ? 0 : TECH.accent) |
    (hard ? TECH.harmonicHard : 0) |
    (effects?.tapping ? TECH.tapping : 0) |
    (effects?.tremoloPicking === undefined ? 0 : TECH.tremoloPicking) |
    (effects?.whammy ? TECH.whammy : 0) |
    (effects?.slapping ? TECH.slap : 0) |
    (effects?.popping ? TECH.pop : 0) |
    (effects?.arpeggio ? TECH.arpeggio : 0) |
    (effects?.brush ? TECH.brush : 0)
  );
}

function row(
  track: Track,
  source: Beat | undefined,
  note: Note,
  voice: number,
  beat: number,
  onset: number,
  duration: number,
  metric: number,
  grace: boolean,
): Row | undefined {
  const flags =
    (note.tie ? NOTE_FLAG.tie : 0) |
    (note.dead ? NOTE_FLAG.dead : 0) |
    (note.ghost ? NOTE_FLAG.ghost : 0) |
    (grace ? NOTE_FLAG.grace : 0) |
    (note.harmonic ? NOTE_FLAG.harmonic : 0);
  let pitch: number;
  try {
    pitch = Math.round(soundingPitch(track, note));
  } catch {
    return undefined; // a string the tuning lacks
  }
  if (pitch < 0 || pitch > 127) return undefined;
  return {
    pitch,
    voice,
    beat,
    onset,
    duration,
    metric,
    flags,
    tech: techOf(note, source),
    string: track.kind === 'fretted' ? Math.min(note.string, 255) : 0,
    fret: track.kind === 'fretted' ? Math.min(note.fret, 255) : 0,
  };
}

/**
 * The notes of a score as a table. `passes` is how many times each master bar is played; it
 * defaults to the count the playback sequence gives. A note on a string the tuning lacks, or with
 * a pitch outside MIDI range, is skipped on its own, since a bad file must not stop the analysis.
 */
export function noteTableOf(score: Score, passes?: readonly number[]): NoteTable {
  const counts = passes ?? passesPerBar(score);
  const chunks: { track: number; bar: number; passes: number; built: BarRows; first: number }[] =
    [];
  let beatBase = 0;
  let total = 0;
  score.tracks.forEach((track, trackIndex) => {
    if (track.kind === 'drums') return;
    track.bars.forEach((bar, barIndex) => {
      const masterBar = score.masterBars[barIndex];
      if (!masterBar) return;
      const built = rowsOf(bar, track, masterBar);
      chunks.push({
        track: trackIndex,
        bar: barIndex,
        passes: counts[barIndex] ?? 1,
        built,
        first: beatBase,
      });
      beatBase += built.beats;
      total += built.rows.length;
    });
  });

  const table: NoteTable = {
    length: total,
    pitch: new Uint8Array(total),
    track: new Uint16Array(total),
    bar: new Uint32Array(total),
    voice: new Uint8Array(total),
    beat: new Uint32Array(total),
    onset: new Float64Array(total),
    duration: new Float64Array(total),
    metric: new Uint8Array(total),
    flags: new Uint8Array(total),
    tech: new Uint32Array(total),
    string: new Uint8Array(total),
    fret: new Uint8Array(total),
    passes: new Uint16Array(total),
  };
  let at = 0;
  for (const chunk of chunks) {
    for (const r of chunk.built.rows) {
      table.pitch[at] = r.pitch;
      table.track[at] = chunk.track;
      table.bar[at] = chunk.bar;
      table.voice[at] = r.voice;
      table.beat[at] = chunk.first + r.beat;
      table.onset[at] = r.onset;
      table.duration[at] = r.duration;
      table.metric[at] = r.metric;
      table.flags[at] = r.flags;
      table.tech[at] = r.tech;
      table.string[at] = r.string;
      table.fret[at] = r.fret;
      table.passes[at] = Math.min(chunk.passes, 0xffff);
      at++;
    }
  }
  return table;
}

/** Plays per master bar from the playback sequence. */
export function passesPerBar(score: Pick<Score, 'masterBars'>): number[] {
  const counts = score.masterBars.map(() => 0);
  for (const pass of expandPlaybackSequence(score).sequence) {
    counts[pass.masterBarIndex] = (counts[pass.masterBarIndex] ?? 0) + 1;
  }
  return counts;
}
