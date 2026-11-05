import { beatTicks, expandPlaybackSequence, midiNote } from '@reprise/model';
import type { Beat, Id, Note, Score, Track } from '@reprise/model';

import type { RegionMap, SampleRef } from '../sampler/region-map';
import type { InstrumentId } from './types';

export interface InstrumentUse {
  instrument: InstrumentId;
  /** Sounding MIDI keys, ascending. */
  keys: number[];
}

export interface TrackPlan {
  track: Id;
  /** The track's own program first, then each `Beat.mix` program change that plays a note. */
  uses: InstrumentUse[];
}

export interface SongPlan {
  /** Every instrument the song needs, in first-use order. */
  instruments: InstrumentId[];
  tracks: TrackPlan[];
}

export type InstrumentResolver = (track: Track, program: number) => InstrumentId;

export interface PlanOptions {
  /** Only the first `bars` bars of the playback sequence: what playback needs to start. */
  bars?: number;
  instrumentOf?: InstrumentResolver;
}

/** The GM tier's ids: `gm:<bank>:<program>`, and `gm:drums:<kit>` on the percussion channel. */
export function gmInstrumentId(track: Pick<Track, 'kind' | 'bank'>, program: number): InstrumentId {
  return track.kind === 'drums'
    ? `gm:drums:${String(program)}`
    : `gm:${String(track.bank)}:${String(program)}`;
}

function soundingNotes(beat: Beat): Note[] {
  const notes = [...beat.notes];
  for (const grace of beat.grace ?? []) notes.push(...grace.notes);
  return notes;
}

function addKeys(track: Track, note: Note, keys: Set<number>): void {
  const frets = note.trill ? [note.fret, note.trill.fret] : [note.fret];
  for (const fret of frets) {
    const key = midiNote(track, { string: note.string, fret });
    if (key >= 0 && key <= 127) keys.add(key);
  }
}

/**
 * Walks one bar in tick order across voices only when it changes program, so the common bar
 * pays for no sort.
 */
function walkBar(
  track: Track,
  barIndex: number,
  program: number,
  visit: (program: number, beat: Beat) => void,
): number {
  const bar = track.bars[barIndex];
  if (!bar) return program;
  const changes = bar.voices.some((voice) =>
    voice.beats.some((beat) => beat.mix?.program !== undefined),
  );
  if (!changes) {
    for (const voice of bar.voices) for (const beat of voice.beats) visit(program, beat);
    return program;
  }
  const timed: { tick: number; beat: Beat }[] = [];
  for (const voice of bar.voices) {
    let tick = 0;
    for (const beat of voice.beats) {
      timed.push({ tick, beat });
      tick += beatTicks(beat);
    }
  }
  timed.sort((a, b) => a.tick - b.tick);
  let current = program;
  for (const { beat } of timed) {
    current = beat.mix?.program ?? current;
    visit(current, beat);
  }
  return current;
}

/**
 * The instruments a song needs and the keys it plays on each, walked in playback order so a
 * program change reached through a repeat or jump is attributed where it actually sounds.
 */
export function planInstruments(score: Score, options: PlanOptions = {}): SongPlan {
  const instrumentOf = options.instrumentOf ?? gmInstrumentId;
  const { sequence } = expandPlaybackSequence(score);
  const passes = options.bars === undefined ? sequence : sequence.slice(0, options.bars);
  const instruments = new Set<InstrumentId>();

  const tracks = score.tracks.map((track): TrackPlan => {
    const uses = new Map<InstrumentId, Set<number>>([
      [instrumentOf(track, track.program), new Set()],
    ]);
    let program = track.program;
    for (const pass of passes) {
      program = walkBar(track, pass.masterBarIndex, program, (current, beat) => {
        const notes = soundingNotes(beat);
        if (notes.length === 0) return;
        const instrument = instrumentOf(track, current);
        let keys = uses.get(instrument);
        if (!keys) {
          keys = new Set();
          uses.set(instrument, keys);
        }
        for (const note of notes) addKeys(track, note, keys);
      });
    }
    for (const instrument of uses.keys()) instruments.add(instrument);
    return {
      track: track.id,
      uses: [...uses].map(([instrument, keys]) => ({
        instrument,
        keys: [...keys].sort((a, b) => a - b),
      })),
    };
  });

  return { instruments: [...instruments], tracks };
}

const VELOCITIES = Array.from({ length: 127 }, (_, i) => i + 1);

/**
 * The samples a plan's keys resolve to at every velocity and in every layer: the plan does not
 * know dynamics or articulations (the scheduler does), so preloading all of them for the
 * opening bars is what guarantees no skipped note there.
 */
export function planSamples(
  plan: SongPlan,
  regionMaps: (instrument: InstrumentId) => RegionMap | undefined,
): SampleRef[] {
  const samples = new Set<SampleRef>();
  for (const { uses } of plan.tracks) {
    for (const { instrument, keys } of uses) {
      const map = regionMaps(instrument);
      if (!map) continue;
      for (const layer of [undefined, ...map.layers]) {
        for (const key of keys) {
          for (const velocity of VELOCITIES) {
            const region = map.resolve(key, velocity, layer);
            if (region) samples.add(region.sample);
          }
        }
      }
    }
  }
  return [...samples];
}
