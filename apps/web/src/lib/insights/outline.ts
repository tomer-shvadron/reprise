import {
  barTicks,
  beatTicks,
  expandPlaybackSequence,
  percussionInstrument,
  tempoMap,
  type KeySignature,
  type Score,
  type TempoMap,
  type TimeSignature,
  type TrackKind,
} from '@reprise/model';

import { parseChordName } from '../chords';

export interface OutlineBar {
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  section?: string;
  /** The bar's own tempo mark, in quarter notes per minute. */
  tempo?: number;
  /** How many times playback passes the bar; 0 for a bar no pass reaches. */
  passes: number;
  /** Seconds of one pass at the written tempo, 0 when no pass reaches the bar. */
  passSeconds: number;
  /** Seconds over every pass. */
  seconds: number;
  /** The bar's written length in ticks. */
  ticks: number;
}

/** A stretch of the tempo that differs from the one before it. A ramp has different ends. */
export interface TempoChange {
  bar: number;
  startBpm: number;
  endBpm: number;
}

export interface DrumUse {
  midi: number;
  name: string;
  count: number;
}

export interface OutlineTrack {
  name: string;
  kind: TrackKind;
  tuning: number[];
  capo: number;
  fretCount: number;
  /** Set on a drum track, which has no rows in the note table. */
  drums?: { notes: number; top: DrumUse[] };
}

/** A chord the file names above a beat: `bar` is a master bar, `onset` ticks into it. */
export interface ChordMark {
  bar: number;
  onset: number;
  name: string;
  /** The last master bar the writing track plays in; the chord does not sound past it. */
  lastBar: number;
}

/** What the analysis needs of a score beyond its notes: small, and safe to post to a worker. */
export interface SongOutline {
  bars: OutlineBar[];
  tempos: TempoChange[];
  tracks: OutlineTrack[];
  chords: ChordMark[];
  /** Seconds of the whole playback. */
  seconds: number;
}

/** The instruments a drum track shows. */
export const TOP_DRUMS = 3;

function drumsOf(score: Score, index: number): { notes: number; top: DrumUse[] } {
  const counts = new Map<number, number>();
  let notes = 0;
  for (const bar of score.tracks[index]?.bars ?? []) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.rest) continue;
        for (const note of beat.notes) {
          if (note.dead) continue;
          notes++;
          counts.set(note.fret, (counts.get(note.fret) ?? 0) + 1);
        }
      }
    }
  }
  const top = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, TOP_DRUMS)
    .map(([midi, count]) => ({
      midi,
      name: percussionInstrument(midi)?.name ?? `Note ${String(midi)}`,
      count,
    }));
  return { notes, top };
}

/** The first track's chord names, by position; where two tracks name one beat the first wins. */
function chordMarksOf(score: Score): ChordMark[] {
  const seen = new Set<string>();
  const marks: ChordMark[] = [];
  for (const track of score.tracks) {
    let lastBar = -1;
    track.bars.forEach((bar, barIndex) => {
      if (bar.voices.some((voice) => voice.beats.some((beat) => !beat.rest))) lastBar = barIndex;
    });
    track.bars.forEach((bar, barIndex) => {
      const voice = bar.voices[0];
      let onset = 0;
      for (const beat of voice.beats) {
        const name = beat.chord?.name.trim();
        if (name && parseChordName(name)) {
          const key = `${String(barIndex)}:${String(Math.round(onset))}`;
          if (!seen.has(key)) {
            seen.add(key);
            marks.push({ bar: barIndex, onset, name, lastBar });
          }
        }
        onset += beatTicks(beat);
      }
    });
  }
  return marks.sort((a, b) => a.bar - b.bar || a.onset - b.onset);
}

/**
 * The outline of a score. `map` is the tempo map playback already builds for each score version;
 * without one the outline builds its own from the playback sequence.
 */
export function songOutline(score: Score, map?: TempoMap): SongOutline {
  const tempos = map ?? tempoMap(score, expandPlaybackSequence(score).sequence);
  const passes = score.masterBars.map(() => 0);
  const passSeconds = score.masterBars.map(() => 0);
  const seconds = score.masterBars.map(() => 0);
  const changes: TempoChange[] = [];
  const first = new Map<number, TempoMap['passes'][number]>();
  for (const pass of tempos.passes) {
    const bar = pass.masterBarIndex;
    passes[bar] = (passes[bar] ?? 0) + 1;
    seconds[bar] = (seconds[bar] ?? 0) + pass.durationSeconds;
    if (!first.has(bar)) {
      first.set(bar, pass);
      passSeconds[bar] = pass.durationSeconds;
    }
  }
  // Tempo changes read in bar order from each bar's first pass, so a repeat adds none.
  let previous: TempoChange | undefined;
  for (const [bar, pass] of [...first].sort((a, b) => a[0] - b[0])) {
    for (const segment of pass.segments) {
      const constant = segment.startBpm === segment.endBpm;
      if (
        constant &&
        previous !== undefined &&
        previous.startBpm === previous.endBpm &&
        Math.abs(previous.endBpm - segment.startBpm) < 1e-9
      ) {
        continue;
      }
      previous = { bar, startBpm: segment.startBpm, endBpm: segment.endBpm };
      changes.push(previous);
    }
  }

  return {
    bars: score.masterBars.map((masterBar, index) => ({
      timeSignature: { ...masterBar.timeSignature },
      keySignature: { ...masterBar.keySignature },
      ...(masterBar.section ? { section: masterBar.section.name } : {}),
      ...(masterBar.tempo ? { tempo: masterBar.tempo.bpm } : {}),
      passes: passes[index] ?? 0,
      passSeconds: passSeconds[index] ?? 0,
      seconds: seconds[index] ?? 0,
      ticks: barTicks(masterBar),
    })),
    tempos: changes,
    tracks: score.tracks.map((track, index) => ({
      name: track.name,
      kind: track.kind,
      tuning: [...track.tuning],
      capo: track.capo,
      fretCount: track.fretCount,
      ...(track.kind === 'drums' ? { drums: drumsOf(score, index) } : {}),
    })),
    chords: chordMarksOf(score),
    seconds: tempos.durationSeconds,
  };
}
