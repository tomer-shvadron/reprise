import {
  beatTicks,
  midiNote,
  soundingPitch,
  writtenFret,
  type Bar,
  type Drone,
  type Id,
  type MasterBar,
  type Note,
  type Track,
} from '@reprise/model';

/** The board always shows at least this many frets, whatever the track says. */
export const BOARD_FRETS = 24;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** The pitch class of a MIDI note, spelled with sharps: the board has no key to spell against. */
export function noteName(midi: number): string {
  return NAMES[((Math.round(midi) % 12) + 12) % 12] ?? '?';
}

/** One lit position. `fret` is as written (counted from the capo); `absolute` is where it sits. */
export interface Dot {
  /** 1 = highest-pitched string, as `Note.string`. */
  string: number;
  fret: number;
  absolute: number;
  capo: number;
  /** The sounding pitch class; `x` for a dead note, which has no pitch. */
  name: string;
  dead: boolean;
  harmonic: boolean;
}

export interface BoardShape {
  strings: number;
  frets: number;
  capo: number;
  /** A banjo's short string: it has no frets below `drone.fret`, so its line starts there. */
  drone?: Drone;
}

const highestByBar = new WeakMap<Bar, number>();

/** The highest stored fret in a bar, cached per bar object so an edit rescans one bar. */
function highestFretOf(bar: Bar): number {
  let highest = highestByBar.get(bar);
  if (highest === undefined) {
    highest = 0;
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) highest = Math.max(highest, note.fret);
      }
    }
    highestByBar.set(bar, highest);
  }
  return highest;
}

/**
 * The board a track draws, or undefined for a track with no strings to show. It reaches the
 * highest position the track uses, so a note past fret 24 is drawn rather than clipped.
 */
export function boardOf(track: Track | undefined): BoardShape | undefined {
  if (track?.kind !== 'fretted' || track.tuning.length === 0) return undefined;
  let used = 0;
  for (const bar of track.bars) used = Math.max(used, highestFretOf(bar));
  return {
    strings: track.tuning.length,
    // A drone note's dot sits `drone.fret` beyond its stored fret, so leave room for that.
    frets: Math.max(BOARD_FRETS, track.fretCount, track.capo + used + (track.drone?.fret ?? 0)),
    capo: track.capo,
    ...(track.drone && { drone: track.drone }),
  };
}

/** The open strings' names, lowest-pitched first. */
export function tuningNames(track: Pick<Track, 'tuning'>): string[] {
  return track.tuning.map(noteName);
}

/**
 * Where a dot sits on the neck. The capo raises all five strings, so a drone note, open or
 * fretted, counts from the capo and the string's first fret: `capo + drone.fret + stored`.
 */
function absoluteFret(track: Track, note: Note, written: number): number {
  const { drone } = track;
  if (drone && note.string === drone.string) return track.capo + drone.fret + note.fret;
  return track.capo + written;
}

function dotOf(track: Track, note: Note): Dot | undefined {
  const { string } = note;
  // Written frets match the tab, so the drone string counts from the banjo's own nut.
  const fret = writtenFret(track, note);
  if (string < 1 || string > track.tuning.length) return undefined;
  const pitch = note.harmonic ? soundingPitch(track, note) : midiNote(track, note);
  return {
    string,
    fret,
    absolute: absoluteFret(track, note, fret),
    capo: track.capo,
    name: note.dead ? 'x' : noteName(pitch),
    dead: note.dead,
    harmonic: note.harmonic !== undefined,
  };
}

interface Stop {
  start: number;
  dots: readonly Dot[];
}

interface BarDots {
  stops: readonly Stop[];
  beats: ReadonlyMap<Id, readonly Dot[]>;
}

const NO_DOTS: readonly Dot[] = [];

function sameDots(a: readonly Dot[], b: readonly Dot[]): boolean {
  return (
    a.length === b.length &&
    a.every((dot, i) => dot.string === b[i]?.string && dot.fret === b[i].fret)
  );
}

function computeBar(track: Track, bar: Bar): BarDots {
  const beats = new Map<Id, Dot[]>();
  const spans: { start: number; end: number; dots: Dot[] }[] = [];
  for (const voice of bar.voices) {
    let start = 0;
    for (const beat of voice.beats) {
      const end = start + beatTicks(beat);
      const dots = beat.rest ? [] : beat.notes.flatMap((note) => dotOf(track, note) ?? []);
      beats.set(beat.id, dots);
      spans.push({ start, end, dots });
      start = end;
    }
  }
  const cuts = [...new Set(spans.flatMap((span) => [span.start, span.end]))].sort((a, b) => a - b);
  const stops: Stop[] = [];
  for (const cut of cuts) {
    const seen = new Set<string>();
    const dots: Dot[] = [];
    for (const span of spans) {
      if (span.start > cut || span.end <= cut) continue;
      for (const dot of span.dots) {
        const key = `${String(dot.string)}:${String(dot.fret)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dots.push(dot);
      }
    }
    const previous = stops.at(-1);
    // Equal neighbours merge, so a lookup lands on the longest stretch.
    if (previous && sameDots(previous.dots, dots)) continue;
    stops.push({ start: cut, dots });
  }
  return { stops, beats };
}

/** What sounds where, for one track; each bar is worked out the first time a tick lands in it. */
export interface BeatIndex {
  /** The notes sounding `tick` ticks into a master bar. */
  dotsAt(masterBarId: Id, tick: number): readonly Dot[];
  dotsOfBeat(masterBarId: Id, beat: Id | undefined): readonly Dot[];
}

/**
 * A bar's notes depend on the bar and the track's tuning and capo only, so they are cached per
 * bar object: an edit recomputes the one bar it replaced, and a mixer change, which leaves the
 * bars alone, recomputes nothing.
 */
const cache = new WeakMap<Bar, { key: string; dots: BarDots }>();

export function createBeatIndex(track: Track, masterBars: readonly MasterBar[]): BeatIndex {
  const key = `${track.tuning.join(',')}/${String(track.capo)}/${String(track.drone?.string)}:${String(track.drone?.fret)}`;
  const barOf = new Map<Id, Bar>();
  masterBars.forEach((masterBar, index) => {
    const bar = track.bars[index];
    if (bar) barOf.set(masterBar.id, bar);
  });
  const dotsOfBar = (masterBarId: Id): BarDots | undefined => {
    const bar = barOf.get(masterBarId);
    if (!bar) return undefined;
    const hit = cache.get(bar);
    if (hit?.key === key) return hit.dots;
    const dots = computeBar(track, bar);
    cache.set(bar, { key, dots });
    return dots;
  };
  return {
    dotsAt(masterBarId, tick) {
      const stops = dotsOfBar(masterBarId)?.stops;
      if (!stops?.length || (stops[0]?.start ?? 0) > tick) return NO_DOTS;
      let low = 0;
      let high = stops.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((stops[middle]?.start ?? Infinity) <= tick) low = middle;
        else high = middle - 1;
      }
      return stops[low]?.dots ?? NO_DOTS;
    },
    dotsOfBeat(masterBarId, beat) {
      return (beat && dotsOfBar(masterBarId)?.beats.get(beat)) || NO_DOTS;
    },
  };
}

/** A compact identity for a lit set, so an update that changes nothing touches no DOM. */
export function signature(dots: readonly Dot[]): string {
  return dots.map((dot) => `${String(dot.string)}.${String(dot.fret)}`).join(',');
}

/** Written frets match the tab; under a capo the label also says where the dot sits. */
export function dotLabel(dot: Dot): string {
  const position =
    dot.capo > 0
      ? `fret ${String(dot.absolute)} (capo ${String(dot.capo)}, written ${String(dot.fret)})`
      : `fret ${String(dot.fret)}`;
  const kind = dot.dead ? 'dead note' : `${dot.harmonic ? 'harmonic ' : ''}${dot.name}`;
  return `string ${String(dot.string)}, ${position}, ${kind}`;
}

const MARKERS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_MARKERS = new Set([12, 24]);
export const fretMarker = (fret: number): 0 | 1 | 2 =>
  DOUBLE_MARKERS.has(fret) ? 2 : MARKERS.has(fret) ? 1 : 0;

/** Fret `n`'s distance from the nut, 0 to 1 across `frets` frets, with real fret spacing. */
export function fretPosition(n: number, frets: number): number {
  return (1 - 2 ** (-n / 12)) / (1 - 2 ** (-frets / 12));
}
