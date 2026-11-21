import {
  PPQ,
  beatTicks,
  expandPlaybackSequence,
  soundingPitch,
  type Bar,
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

/** How many bars `noteTableOf` extracted rather than reused; for the cache test. */
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
        for (const note of grace.notes) {
          rows.push(row(track, note, voiceIndex, beats, onset, graceTicks, at(onset, true), true));
        }
        if (grace.notes.length > 0) beats++;
      }
      if (!beat.rest) {
        for (const note of beat.notes) {
          rows.push(row(track, note, voiceIndex, beats, onset, length, at(onset, false), false));
        }
        if (beat.notes.length > 0) beats++;
      }
      onset += length;
    }
  });
  const built = { basis, rows, beats };
  cache.set(bar, built);
  return built;
}

function row(
  track: Track,
  note: Note,
  voice: number,
  beat: number,
  onset: number,
  duration: number,
  metric: number,
  grace: boolean,
): Row {
  const flags =
    (note.tie ? NOTE_FLAG.tie : 0) |
    (note.dead ? NOTE_FLAG.dead : 0) |
    (note.ghost ? NOTE_FLAG.ghost : 0) |
    (grace ? NOTE_FLAG.grace : 0) |
    (note.harmonic ? NOTE_FLAG.harmonic : 0);
  return {
    pitch: Math.round(soundingPitch(track, note)),
    voice,
    beat,
    onset,
    duration,
    metric,
    flags,
  };
}

/**
 * The notes of a score as a table. `passes` is how many times each master bar is played; it
 * defaults to the count the playback sequence gives. Notes with a pitch outside MIDI range or a
 * string the tuning lacks are skipped, since a bad file must not stop the analysis.
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
      const built = safely(() => rowsOf(bar, track, masterBar));
      if (!built) return;
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
    passes: new Uint16Array(total),
  };
  let at = 0;
  for (const chunk of chunks) {
    for (const r of chunk.built.rows) {
      table.pitch[at] = Math.max(0, Math.min(127, r.pitch));
      table.track[at] = chunk.track;
      table.bar[at] = chunk.bar;
      table.voice[at] = r.voice;
      table.beat[at] = chunk.first + r.beat;
      table.onset[at] = r.onset;
      table.duration[at] = r.duration;
      table.metric[at] = r.metric;
      table.flags[at] = r.flags;
      table.passes[at] = Math.min(chunk.passes, 0xffff);
      at++;
    }
  }
  return table;
}

function safely<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

/** Plays per master bar from the playback sequence. */
export function passesPerBar(score: Pick<Score, 'masterBars'>): number[] {
  const counts = score.masterBars.map(() => 0);
  for (const pass of expandPlaybackSequence(score).sequence) {
    counts[pass.masterBarIndex] = (counts[pass.masterBarIndex] ?? 0) + 1;
  }
  return counts;
}
