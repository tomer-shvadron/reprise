import { beatTicks, midiNote, type Id, type MasterBar, type Track } from '@reprise/model';

/** The board always shows at least this many frets, whatever the track says. */
export const BOARD_FRETS = 24;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** The pitch class of a MIDI note, spelled with sharps: the board has no key to spell against. */
export function noteName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12] ?? '?';
}

/** One lit position. `fret` is as written (counted from the capo); `absolute` is where it sits. */
export interface Dot {
  /** 1 = highest-pitched string, as `Note.string`. */
  string: number;
  fret: number;
  absolute: number;
  name: string;
}

export interface BoardShape {
  strings: number;
  frets: number;
  capo: number;
}

/** The board a track draws, or undefined for a track with no strings to show. */
export function boardOf(track: Track | undefined): BoardShape | undefined {
  if (track?.kind !== 'fretted' || track.tuning.length === 0) return undefined;
  return {
    strings: track.tuning.length,
    frets: Math.max(BOARD_FRETS, track.fretCount),
    capo: track.capo,
  };
}

function dotOf(track: Track, string: number, fret: number): Dot | undefined {
  if (string < 1 || string > track.tuning.length) return undefined;
  return {
    string,
    fret,
    absolute: track.capo + fret,
    name: noteName(midiNote(track, { string, fret })),
  };
}

interface Stop {
  start: number;
  dots: readonly Dot[];
}

/** What sounds where, precomputed once per score and track so a playback tick only looks it up. */
export interface BeatIndex {
  /** Per master bar, the stretches of the bar with their notes, in tick order, every voice merged. */
  bars: ReadonlyMap<Id, readonly Stop[]>;
  beats: ReadonlyMap<Id, readonly Dot[]>;
}

const NO_DOTS: readonly Dot[] = [];

export function buildBeatIndex(track: Track, masterBars: readonly MasterBar[]): BeatIndex {
  const bars = new Map<Id, Stop[]>();
  const beats = new Map<Id, Dot[]>();
  masterBars.forEach((masterBar, index) => {
    const bar = track.bars[index];
    if (!bar) return;
    const spans: { start: number; end: number; dots: Dot[] }[] = [];
    for (const voice of bar.voices) {
      let start = 0;
      for (const beat of voice.beats) {
        const end = start + beatTicks(beat);
        const dots = beat.rest
          ? []
          : beat.notes.flatMap((note) => dotOf(track, note.string, note.fret) ?? []);
        beats.set(beat.id, dots);
        spans.push({ start, end, dots });
        start = end;
      }
    }
    const cuts = [...new Set(spans.flatMap((span) => [span.start, span.end]))].sort(
      (a, b) => a - b,
    );
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
      // Merge equal neighbours so a lookup lands on the longest stretch.
      if (previous && previous.dots.length === dots.length && sameDots(previous.dots, dots))
        continue;
      stops.push({ start: cut, dots });
    }
    bars.set(masterBar.id, stops);
  });
  return { bars, beats };
}

function sameDots(a: readonly Dot[], b: readonly Dot[]): boolean {
  return a.every((dot, i) => dot.string === b[i]?.string && dot.fret === b[i].fret);
}

/** The notes sounding `tick` ticks into a bar. */
export function dotsAt(index: BeatIndex, masterBarId: Id, tick: number): readonly Dot[] {
  const stops = index.bars.get(masterBarId);
  if (!stops) return NO_DOTS;
  let low = 0;
  let high = stops.length - 1;
  if (high < 0 || (stops[0]?.start ?? 0) > tick) return NO_DOTS;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((stops[middle]?.start ?? Infinity) <= tick) low = middle;
    else high = middle - 1;
  }
  return stops[low]?.dots ?? NO_DOTS;
}

export function dotsOfBeat(index: BeatIndex, beat: Id | undefined): readonly Dot[] {
  return (beat && index.beats.get(beat)) || NO_DOTS;
}

/** A compact identity for a lit set, so an update that changes nothing touches no DOM. */
export function signature(dots: readonly Dot[]): string {
  return dots.map((dot) => `${String(dot.string)}.${String(dot.fret)}`).join(',');
}

export function dotLabel(dot: Dot): string {
  return `string ${String(dot.string)}, fret ${String(dot.fret)}, ${dot.name}`;
}

const MARKERS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_MARKERS = new Set([12, 24]);
export const fretMarker = (fret: number): 0 | 1 | 2 =>
  DOUBLE_MARKERS.has(fret) ? 2 : MARKERS.has(fret) ? 1 : 0;

/** Fret `n`'s distance from the nut, 0 to 1 across `frets` frets, with real fret spacing. */
export function fretPosition(n: number, frets: number): number {
  return (1 - 2 ** (-n / 12)) / (1 - 2 ** (-frets / 12));
}
