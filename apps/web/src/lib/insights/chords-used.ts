import type { KeySignature } from '@reprise/model';

import { nameChord } from '../chords';
import { NOTE_FLAG, type NoteTable } from './note-table';
import type { SongOutline } from './outline';
import { sectionSpans } from './sections';

/** The file counts as naming its chords from this many chord marks on; fewer and the notes are read too. */
export const MIN_WRITTEN_CHORDS = 4;
/** A beat is a chord when one track sounds this many pitch classes at once. */
export const MIN_CHORD_TONES = 3;
export const MIN_LOOP = 2;
export const MAX_LOOP = 8;
/** A progression without a loop shows its first changes only. */
export const MAX_SHOWN = 12;

export interface ChordUse {
  name: string;
  /** How many times the chord comes in, a repeat of the same chord on the next beat not counted. */
  count: number;
  /** Its share of the time chords sound, 0 to 1. */
  share: number;
}

export interface Progression {
  /** The section it belongs to; absent when the song has no sections. */
  section?: string;
  /** The chords in written order with repeats collapsed, at most `MAX_SHOWN`. */
  chords: string[];
  loop?: Loop;
  /** E.g. `Am–F–C–G ×4`, or the chords followed by `…`. */
  label: string;
}

export interface Loop {
  chords: string[];
  /** Whole repeats, the last one allowed to stop short (`partial`). */
  times: number;
  partial: boolean;
  /** Chords that do not belong to the loop: one fill or pickup bar is tolerated. */
  fills: number;
}

export interface ChordsInsight {
  /** Where the chords come from: `inferred` ones are read from the notes and shown as such; `none` is a song with no chords. */
  source: 'written' | 'inferred' | 'none';
  chords: ChordUse[];
  progressions: Progression[];
}

interface Event {
  bar: number;
  onset: number;
  name: string;
  weight: number;
}

const barStarts = (outline: Pick<SongOutline, 'bars'>): number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const bar of outline.bars) {
    starts.push(at);
    at += bar.ticks;
  }
  starts.push(at);
  return starts;
};

/**
 * The chords the file names inside `span`, each weighed by the ticks until the next one, or the end
 * of the section, times its bar's passes. A section with no chord marks has no chords, and a
 * section whose first mark comes late starts with the chord held over from before it, up to that mark.
 */
function writtenEvents(outline: SongOutline, span: Span): Event[] {
  const starts = barStarts(outline);
  const tick = (bar: number, onset = 0): number => (starts[bar] ?? 0) + onset;
  const marks = outline.chords.filter((mark) => mark.bar >= span.fromBar && mark.bar <= span.toBar);
  const first = marks[0];
  if (!first) return [];
  if (span.fromBar > 0 && (first.bar > span.fromBar || first.onset > 0)) {
    const held = outline.chords.filter((mark) => mark.bar < span.fromBar).at(-1);
    if (held) marks.unshift({ ...held, bar: span.fromBar, onset: 0 });
  }
  const end = tick(span.toBar + 1);
  return marks.map((mark, index) => {
    const next = marks[index + 1];
    const until = next ? tick(next.bar, next.onset) : end;
    return {
      bar: mark.bar,
      onset: mark.onset,
      name: mark.name,
      weight:
        Math.max(0, until - tick(mark.bar, mark.onset)) * (outline.bars[mark.bar]?.passes || 1),
    };
  });
}

interface Span {
  name?: string;
  fromBar: number;
  toBar: number;
}

interface Cluster {
  track: number;
  bar: number;
  onset: number;
  pitches: number[];
  ticks: number;
  passes: number;
}

/**
 * The beats where one track sounds three or more pitch classes. A figure played one note at a
 * time (an arpeggio, a riff) never has three in one beat, so it gives nothing rather than a guess.
 */
function clusters(table: NoteTable): Cluster[] {
  const byBeat = new Map<number, Cluster>();
  for (let i = 0; i < table.length; i++) {
    if ((table.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace)) continue;
    const beat = table.beat[i] ?? 0;
    const pitch = table.pitch[i] ?? 0;
    const known = byBeat.get(beat);
    if (known) known.pitches.push(pitch);
    else {
      byBeat.set(beat, {
        track: table.track[i] ?? 0,
        bar: table.bar[i] ?? 0,
        onset: table.onset[i] ?? 0,
        pitches: [pitch],
        ticks: table.duration[i] ?? 0,
        passes: table.passes[i] ?? 1,
      });
    }
  }
  return [...byBeat.values()].filter(
    (cluster) => new Set(cluster.pitches.map((p) => p % 12)).size >= MIN_CHORD_TONES,
  );
}

/** Chord names read from the track that has the most chord beats (the rhythm part). */
function inferredEvents(table: NoteTable, key: KeySignature): Event[] {
  const all = clusters(table);
  const perTrack = new Map<number, number>();
  for (const cluster of all) perTrack.set(cluster.track, (perTrack.get(cluster.track) ?? 0) + 1);
  let rhythm: number | undefined;
  for (const [track, count] of [...perTrack].sort((a, b) => a[0] - b[0])) {
    if (rhythm === undefined || count > (perTrack.get(rhythm) ?? 0)) rhythm = track;
  }
  const events: Event[] = [];
  for (const cluster of all
    .filter((c) => c.track === rhythm)
    .sort((a, b) => a.bar - b.bar || a.onset - b.onset)) {
    const name = nameChord(cluster.pitches, key)[0]?.name;
    if (name) {
      events.push({
        bar: cluster.bar,
        onset: cluster.onset,
        name,
        weight: cluster.ticks * cluster.passes,
      });
    }
  }
  return events;
}

/** Runs of the same chord merged into one event. */
function collapse(events: readonly Event[]): Event[] {
  const merged: Event[] = [];
  for (const event of events) {
    const last = merged[merged.length - 1];
    if (last?.name === event.name) last.weight += event.weight;
    else merged.push({ ...event });
  }
  return merged;
}

/** How many chords of `names` a loop of `period` chords starting at `start` explains, and how many it skips. */
function fit(
  names: readonly string[],
  period: number,
  start: number,
  fills: 0 | 1,
): { matched: number; loop: string[] } | undefined {
  const loop = names.slice(start, start + period);
  if (loop.length < period) return undefined;
  const at = (index: number, shift: number): string | undefined =>
    loop[(((index - start - shift) % period) + period) % period];
  if (fills === 0) {
    return names.every((name, index) => name === at(index, 0))
      ? { matched: names.length, loop }
      : undefined;
  }
  // One chord is a fill: it replaces a chord of the loop (a substitution), or it is an extra bar
  // that shifts the loop by one (an insertion); a pickup is the first of these.
  for (let extra = 0; extra < names.length; extra++) {
    const substituted = names.every((name, index) => index === extra || name === at(index, 0));
    const inserted = names.every(
      (name, index) => index === extra || name === at(index, index > extra ? 1 : 0),
    );
    if (substituted || inserted)
      return { matched: substituted && extra >= start ? names.length : names.length - 1, loop };
  }
  return undefined;
}

/**
 * The shortest period from `MIN_LOOP` to `MAX_LOOP` that explains the whole sequence in at least
 * two repeats, the last repeat allowed to stop short. An exact loop wins over one with a fill,
 * and a fill is tolerated once (a pickup bar, a turnaround, a passing voicing) and only when the
 * loop still repeats three times. A loop that ends on its own first chord, which the collapse of
 * repeated chords merged, is shown with that chord.
 */
export function loopOf(names: readonly string[]): Loop | undefined {
  for (const fills of [0, 1] as const) {
    for (let period = MIN_LOOP; period <= MAX_LOOP; period++) {
      const needed = (fills === 0 ? 2 : 3) * period;
      if (names.length - fills < needed) continue;
      for (let start = 0; start < period; start++) {
        const found = fit(names, period, start, fills);
        if (!found) continue;
        const times = Math.floor(found.matched / period);
        const partial = found.matched % period !== 0;
        const wraps =
          partial && period >= 3 && found.matched % period === 1 && names.at(-1) === found.loop[0];
        return {
          chords: wraps ? [...found.loop, found.loop[0] ?? ''] : found.loop,
          times,
          partial: partial && !wraps,
          fills,
        };
      }
    }
  }
  return undefined;
}

export function progressionOf(names: readonly string[], section?: string): Progression {
  const loop = loopOf(names);
  const shown = names.slice(0, MAX_SHOWN);
  const label = loop
    ? `${loop.chords.join('–')} ×${String(loop.times)}${loop.partial ? '+' : ''}`
    : `${shown.join('–')}${names.length > MAX_SHOWN ? '…' : ''}`;
  return {
    ...(section === undefined ? {} : { section }),
    chords: shown,
    ...(loop ? { loop } : {}),
    label,
  };
}

/**
 * Chords as standard names. The owner's rule is the song's: a file that writes four or more chord
 * names has them used wherever they are, and one that writes fewer has its chords read from the
 * notes. Repeats are merged inside a section, never across a section boundary, so each section's
 * progression starts on its own first chord.
 */
export function chordsUsed(
  table: NoteTable,
  outline: SongOutline,
  key: KeySignature,
): ChordsInsight {
  const sections = sectionSpans(outline);
  const spans: Span[] =
    sections.length > 0 ? sections : [{ fromBar: 0, toBar: outline.bars.length - 1 }];
  const inferred = outline.chords.length < MIN_WRITTEN_CHORDS ? inferredEvents(table, key) : [];
  const partsOf = (from: 'written' | 'inferred') =>
    spans
      .map((span) => ({
        span,
        events: collapse(
          from === 'written'
            ? writtenEvents(outline, span)
            : inferred.filter((e) => e.bar >= span.fromBar && e.bar <= span.toBar),
        ),
      }))
      .filter((part) => part.events.length > 0);
  // The few names a file writes still stand when its notes name no chord (an arpeggiated part).
  let source: 'written' | 'inferred' =
    outline.chords.length >= MIN_WRITTEN_CHORDS ? 'written' : 'inferred';
  let parts = partsOf(source);
  if (parts.length === 0 && source === 'inferred') {
    source = 'written';
    parts = partsOf(source);
  }
  if (parts.length === 0) return { source: 'none', chords: [], progressions: [] };

  const uses = new Map<string, { count: number; weight: number }>();
  for (const { events } of parts) {
    for (const event of events) {
      const use = uses.get(event.name) ?? { count: 0, weight: 0 };
      use.count++;
      use.weight += event.weight;
      uses.set(event.name, use);
    }
  }
  const total = [...uses.values()].reduce((sum, use) => sum + use.weight, 0);
  const chords = [...uses]
    .map(([name, use]) => ({
      name,
      count: use.count,
      share: total > 0 ? use.weight / total : 0,
    }))
    .sort((a, b) => b.share - a.share || b.count - a.count || a.name.localeCompare(b.name));
  return {
    source,
    chords,
    progressions: parts.map(({ span, events }) =>
      progressionOf(
        events.map((event) => event.name),
        sections.length > 0 ? span.name : undefined,
      ),
    ),
  };
}
