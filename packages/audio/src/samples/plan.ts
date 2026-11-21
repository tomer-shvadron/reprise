import {
  beatTicks,
  courseOffset,
  expandPlaybackSequence,
  midiNote,
  soundingPitch,
} from '@reprise/model';
import type { Beat, BeatEffects, Id, Note, Score, Track } from '@reprise/model';

import { availableSets, voicingOf } from '../articulations/sets';
import type { ArticulationSet, PlanVoicing } from '../articulations/sets';
import type { RegionMap, SampleRef } from '../sampler/region-map';
import type { InstrumentId } from './types';

export interface InstrumentUse {
  instrument: InstrumentId;
  /** Sounding MIDI keys played in the instrument's default layer, ascending. */
  keys: number[];
  /**
   * The keys played in each keyswitch layer a note's articulation set names, by layer id: what a
   * song without a palm mute never lists, so the palm-mute layer is never decoded for it.
   */
  layers: { layer: string; keys: number[] }[];
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
  /**
   * Where a track's pack has each articulation set; without it (General MIDI) every note is
   * planned on the default layer of the track's instrument.
   */
  voicingFor?: (track: Track) => PlanVoicing | undefined;
}

/** The GM tier's ids: `gm:<bank>:<program>`, and `gm:drums:<kit>` on the percussion channel. */
export function gmInstrumentId(track: Pick<Track, 'kind' | 'bank'>, program: number): InstrumentId {
  return track.kind === 'drums'
    ? `gm:drums:${String(program)}`
    : `gm:${String(track.bank)}:${String(program)}`;
}

/** The keys the sink strikes: a harmonic's sounding pitch, rounded as it is, and a trill's alternate. */
function addKeys(track: Track, note: Note, keys: Set<number>): void {
  const struck = [Math.round(soundingPitch(track, note))];
  if (note.trill) struck.push(midiNote(track, { string: note.string, fret: note.trill.fret }));
  // A doubled course strikes its partner string too, except a dead or ghost note (the sink's rule).
  const offset = note.dead || note.ghost ? null : courseOffset(track, note.string);
  for (const key of struck) {
    if (key >= 0 && key <= 127) keys.add(key);
    const partner = offset === null ? undefined : key + offset;
    if (partner !== undefined && partner >= 0 && partner <= 127) keys.add(partner);
  }
}

/** The keys one instrument is played on, by layer. */
interface Used {
  keys: Set<number>;
  layers: Map<string, Set<number>>;
}

const NO_SETS: ReadonlySet<ArticulationSet> = new Set();

const emptyUse = (): Used => ({ keys: new Set(), layers: new Map() });

/** What a beat's notes need: the set each plays (`voicingOf`, the sink's rule) says where its keys go. */
interface Placing {
  track: Track;
  voicing: PlanVoicing | undefined;
  available: ReadonlySet<ArticulationSet>;
  /** The use of an instrument id, created on first need. */
  usedBy: (instrument: InstrumentId) => Used;
  base: Used;
}

function addNote(placing: Placing, note: Note, effects: BeatEffects): void {
  const { track, voicing, usedBy } = placing;
  // A tied note is not struck: it keeps its origin's voice, and the origin plans the key.
  const { set } = note.tie
    ? { set: 'default' as const }
    : voicingOf({ kind: track.kind, note, effects }, placing.available);
  const target = set === 'default' ? undefined : voicing?.[set];
  const used = target?.instrument === undefined ? placing.base : usedBy(target.instrument);
  let keys = used.keys;
  if (target?.layer !== undefined) {
    keys = used.layers.get(target.layer) ?? new Set();
    used.layers.set(target.layer, keys);
  }
  addKeys(track, note, keys);
}

function addBeat(placing: Placing, beat: Beat): void {
  for (const note of beat.notes) addNote(placing, note, beat.effects);
  for (const grace of beat.grace ?? []) {
    for (const note of grace.notes) addNote(placing, note, {});
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
    const uses = new Map<InstrumentId, Used>([[instrumentOf(track, track.program), emptyUse()]]);
    const usedBy = (instrument: InstrumentId): Used => {
      let used = uses.get(instrument);
      if (!used) {
        used = emptyUse();
        uses.set(instrument, used);
      }
      return used;
    };
    const voicing = options.voicingFor?.(track);
    const available = voicing ? availableSets(voicing) : NO_SETS;
    let program = track.program;
    for (const pass of passes) {
      program = walkBar(track, pass.masterBarIndex, program, (current, beat) => {
        if (beat.notes.length === 0 && (beat.grace?.length ?? 0) === 0) return;
        addBeat(
          { track, voicing, available, usedBy, base: usedBy(instrumentOf(track, current)) },
          beat,
        );
      });
    }
    for (const instrument of uses.keys()) instruments.add(instrument);
    const ascending = (keys: Set<number>): number[] => [...keys].sort((a, b) => a - b);
    return {
      track: track.id,
      uses: [...uses].map(([instrument, used]) => ({
        instrument,
        keys: ascending(used.keys),
        layers: [...used.layers].map(([layer, keys]) => ({ layer, keys: ascending(keys) })),
      })),
    };
  });

  return { instruments: [...instruments], tracks };
}

const VELOCITIES = Array.from({ length: 127 }, (_, i) => i + 1);

/**
 * The samples a plan's keys resolve to at every velocity, in the layers the score plays (the
 * default layer and each layer a note's articulation set names, and no other keyswitch layer),
 * and every round-robin and random position (`candidates`): the plan does not know dynamics (the
 * scheduler does), so preloading all of them for the opening bars is what guarantees no skipped
 * note there. Release regions are included, since they must be resident at the note-off.
 */
export function planSamples(
  plan: SongPlan,
  regionMaps: (instrument: InstrumentId) => RegionMap | undefined,
): SampleRef[] {
  const samples = new Set<SampleRef>();
  for (const { uses } of plan.tracks) {
    for (const { instrument, keys, layers } of uses) {
      const map = regionMaps(instrument);
      if (!map) continue;
      const planned: { layer: string | undefined; keys: readonly number[] }[] = [
        { layer: undefined, keys },
        ...layers,
      ];
      for (const { layer, keys: layerKeys } of planned) {
        for (const key of layerKeys) {
          for (const velocity of VELOCITIES) {
            for (const region of map.candidates(key, velocity, layer)) samples.add(region.sample);
          }
        }
      }
    }
  }
  return [...samples];
}
