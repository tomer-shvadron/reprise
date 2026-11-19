import { beatTicks, type Beat, type Id, type Note, type Score } from '@reprise/model';

export interface BeatInfo {
  masterBarIndex: number;
  /** Index into `score.tracks`. */
  trackIndex: number;
  /** `Bar.voices` index. */
  voice: number;
  /** Index among the voice's beats. */
  index: number;
  /** Ticks from the start of its bar, in its voice. */
  tick: number;
  /** The only beat of its voice and a rest: the tab staff centres it, away from its onset. */
  loneRest: boolean;
}

export interface ScoreIndex {
  barIndex: ReadonlyMap<Id, number>;
  beats: ReadonlyMap<Id, BeatInfo>;
  /** Note id, grace notes included, to its beat's id. */
  noteBeat: ReadonlyMap<Id, Id>;
  /** Note id, grace notes included, to `Note.string`. */
  noteString: ReadonlyMap<Id, number>;
}

/** Past this many overlay entries a derived index is flattened into fresh maps. */
const FLATTEN_AT = 4096;

const TOMBSTONE = Symbol('removed');

/**
 * A read-only map made of a parent map and a small overlay of changes (a removed key is a
 * tombstone). An edit touches a few bars, so deriving an index copies only the overlay, never the
 * whole table; nothing here mutates a map another `ScoreIndex` can still hold.
 */
class LayeredMap<K, V> implements ReadonlyMap<K, V> {
  private flat: Map<K, V> | undefined;

  constructor(
    readonly base: ReadonlyMap<K, V>,
    readonly overlay: ReadonlyMap<K, V | typeof TOMBSTONE>,
  ) {}

  get(key: K): V | undefined {
    const own = this.overlay.get(key);
    if (own === undefined) return this.base.get(key);
    return own === TOMBSTONE ? undefined : own;
  }

  has(key: K): boolean {
    const own = this.overlay.get(key);
    return own === undefined ? this.base.has(key) : own !== TOMBSTONE;
  }

  /** The merged entries, built on first use by anything that iterates. */
  materialize(): Map<K, V> {
    if (!this.flat) {
      const merged = new Map(this.base);
      for (const [key, value] of this.overlay) {
        if (value === TOMBSTONE) merged.delete(key);
        else merged.set(key, value);
      }
      this.flat = merged;
    }
    return this.flat;
  }

  get size(): number {
    return this.materialize().size;
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    this.materialize().forEach((value, key) => {
      callback(value, key, this);
    });
  }

  entries(): MapIterator<[K, V]> {
    return this.materialize().entries();
  }

  keys(): MapIterator<K> {
    return this.materialize().keys();
  }

  values(): MapIterator<V> {
    return this.materialize().values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.materialize().entries();
  }
}

/** The three id tables an edit changes, as plain mutable maps while one index is being made. */
interface Tables {
  beats: Map<Id, BeatInfo | typeof TOMBSTONE>;
  noteBeat: Map<Id, Id | typeof TOMBSTONE>;
  noteString: Map<Id, number | typeof TOMBSTONE>;
}

type BarOf = Score['tracks'][number]['bars'][number];

/** Calls `visit` for every beat of a bar with the entries its index rows hold. */
function indexBar(
  bar: BarOf,
  trackIndex: number,
  masterBarIndex: number,
  visit: (beat: Beat, info: BeatInfo) => void,
): void {
  bar.voices.forEach((voice, voiceIndex) => {
    let tick = 0;
    voice.beats.forEach((beat, index) => {
      visit(beat, {
        masterBarIndex,
        trackIndex,
        voice: voiceIndex,
        index,
        tick,
        loneRest: beat.rest && voice.beats.length === 1,
      });
      tick += beatTicks(beat);
    });
  });
}

const notesOf = (beat: Beat): Note[] => [
  ...beat.notes,
  ...(beat.grace ?? []).flatMap((grace) => grace.notes),
];

function fill(tables: Tables, bar: BarOf, trackIndex: number, masterBarIndex: number): void {
  indexBar(bar, trackIndex, masterBarIndex, (beat, info) => {
    tables.beats.set(beat.id, info);
    for (const note of notesOf(beat)) {
      tables.noteBeat.set(note.id, beat.id);
      tables.noteString.set(note.id, note.string);
    }
  });
}

function unfill(tables: Tables, bar: BarOf): void {
  for (const voice of bar.voices) {
    for (const beat of voice.beats) {
      tables.beats.set(beat.id, TOMBSTONE);
      for (const note of notesOf(beat)) {
        tables.noteBeat.set(note.id, TOMBSTONE);
        tables.noteString.set(note.id, TOMBSTONE);
      }
    }
  }
}

function buildIndex(score: Score): ScoreIndex {
  const barIndex = new Map(score.masterBars.map((bar, index) => [bar.id, index]));
  const tables: Tables = { beats: new Map(), noteBeat: new Map(), noteString: new Map() };
  score.tracks.forEach((track, trackIndex) => {
    track.bars.forEach((bar, masterBarIndex) => {
      fill(tables, bar, trackIndex, masterBarIndex);
    });
  });
  // No tombstones in a cold build, so these are plain maps.
  return {
    barIndex,
    beats: tables.beats as Map<Id, BeatInfo>,
    noteBeat: tables.noteBeat as Map<Id, Id>,
    noteString: tables.noteString as Map<Id, number>,
  };
}

/**
 * Derives the index of `next` from the one of `prev` by comparing bars by identity, or returns
 * undefined when positions moved (a bar or a track added, removed or reordered), which is a cold
 * rebuild: `BeatInfo` holds the track and bar positions, so a shift would change every row.
 */
function deriveIndex(prev: Score, previous: ScoreIndex, next: Score): ScoreIndex | undefined {
  if (
    prev.tracks.length !== next.tracks.length ||
    prev.masterBars.length !== next.masterBars.length
  ) {
    return undefined;
  }
  const changed: { oldBar: BarOf; newBar: BarOf; trackIndex: number; masterBarIndex: number }[] =
    [];
  for (const [trackIndex, track] of next.tracks.entries()) {
    const old = prev.tracks[trackIndex];
    if (old?.id !== track.id || old.bars.length !== track.bars.length) return undefined;
    if (old === track) continue;
    for (const [masterBarIndex, bar] of track.bars.entries()) {
      const oldBar = old.bars[masterBarIndex];
      if (oldBar && oldBar !== bar)
        changed.push({ oldBar, newBar: bar, trackIndex, masterBarIndex });
    }
  }
  // Master bar ids are compared too: a reorder or an edit of the list changes `barIndex`.
  const sameMasterBars =
    prev.masterBars === next.masterBars ||
    next.masterBars.every((bar, index) => bar.id === prev.masterBars[index]?.id);
  const barIndex = sameMasterBars
    ? previous.barIndex
    : new Map(next.masterBars.map((bar, index) => [bar.id, index]));
  if (changed.length === 0) return { ...previous, barIndex };

  const parent = {
    beats: previous.beats instanceof LayeredMap ? previous.beats : undefined,
    noteBeat: previous.noteBeat instanceof LayeredMap ? previous.noteBeat : undefined,
    noteString: previous.noteString instanceof LayeredMap ? previous.noteString : undefined,
  };
  const tables: Tables = {
    beats: new Map<Id, BeatInfo | typeof TOMBSTONE>(parent.beats?.overlay),
    noteBeat: new Map<Id, Id | typeof TOMBSTONE>(parent.noteBeat?.overlay),
    noteString: new Map<Id, number | typeof TOMBSTONE>(parent.noteString?.overlay),
  };
  // Removals first, so a beat that moved to another changed bar is re-added, not erased.
  for (const { oldBar } of changed) unfill(tables, oldBar);
  for (const { newBar, trackIndex, masterBarIndex } of changed) {
    fill(tables, newBar, trackIndex, masterBarIndex);
  }
  if (tables.beats.size + tables.noteBeat.size > FLATTEN_AT) return buildIndex(next);
  return {
    barIndex,
    beats: new LayeredMap(parent.beats?.base ?? previous.beats, tables.beats),
    noteBeat: new LayeredMap(parent.noteBeat?.base ?? previous.noteBeat, tables.noteBeat),
    noteString: new LayeredMap(parent.noteString?.base ?? previous.noteString, tables.noteString),
  };
}

const scoreIndexes = new WeakMap<Score, ScoreIndex>();
/** The last score indexed per document, weakly held so no old document stays alive. */
const lastIndexed = new Map<Id, WeakRef<Score>>();

/**
 * Lookups by id, made once per `Score` (an edit makes a new one, so an index is never stale). An
 * index after an edit is derived from the previous one by re-reading only the bars whose objects
 * changed; indexes are never mutated, so one a caller still holds stays correct.
 */
export function scoreIndex(score: Score): ScoreIndex {
  const cached = scoreIndexes.get(score);
  if (cached) return cached;
  const prev = lastIndexed.get(score.id)?.deref();
  const previous = prev && scoreIndexes.get(prev);
  const index = (prev && previous && deriveIndex(prev, previous, score)) || buildIndex(score);
  scoreIndexes.set(score, index);
  lastIndexed.set(score.id, new WeakRef(score));
  return index;
}

/** The index of a master bar in the score, or -1. */
export function masterBarIndexOf(score: Score, id: Id): number {
  return scoreIndex(score).barIndex.get(id) ?? -1;
}
