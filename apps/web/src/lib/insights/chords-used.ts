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
  loop?: { chords: string[]; times: number; partial: boolean };
  /** E.g. `Am–F–C–G ×4`, or the chords followed by `…`. */
  label: string;
}

export interface ChordsInsight {
  /** `inferred` chords are read from the notes and shown as such; `none` is a song with no chords. */
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

/** The chords the file names, each weighed by the ticks until the next one times its bar's passes. */
function writtenEvents(outline: SongOutline): Event[] {
  const starts = barStarts(outline);
  const end = starts[starts.length - 1] ?? 0;
  return outline.chords.map((mark, index) => {
    const here = (starts[mark.bar] ?? 0) + mark.onset;
    const next = outline.chords[index + 1];
    const until = next ? (starts[next.bar] ?? 0) + next.onset : end;
    return {
      bar: mark.bar,
      onset: mark.onset,
      name: mark.name,
      weight: Math.max(0, until - here) * (outline.bars[mark.bar]?.passes || 1),
    };
  });
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

/**
 * The shortest period from `MIN_LOOP` to `MAX_LOOP` that tiles the whole sequence at least twice,
 * the last repeat allowed to stop short.
 */
export function loopOf(
  names: readonly string[],
): { chords: string[]; times: number; partial: boolean } | undefined {
  for (let period = MIN_LOOP; period <= MAX_LOOP && period * 2 <= names.length; period++) {
    if (names.every((name, index) => name === names[index % period])) {
      return {
        chords: names.slice(0, period),
        times: Math.floor(names.length / period),
        partial: names.length % period !== 0,
      };
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

/** Chords as standard names: the ones the file writes, or, when it writes fewer than four, the ones the notes spell. */
export function chordsUsed(
  table: NoteTable,
  outline: SongOutline,
  key: KeySignature,
): ChordsInsight {
  const written = collapse(writtenEvents(outline));
  let source: ChordsInsight['source'] = 'written';
  let events = written;
  if (outline.chords.length < MIN_WRITTEN_CHORDS) {
    const inferred = collapse(inferredEvents(table, key));
    if (inferred.length > 0) {
      source = 'inferred';
      events = inferred;
    }
  }
  if (events.length === 0) return { source: 'none', chords: [], progressions: [] };

  const uses = new Map<string, { count: number; weight: number }>();
  for (const event of events) {
    const use = uses.get(event.name) ?? { count: 0, weight: 0 };
    use.count++;
    use.weight += event.weight;
    uses.set(event.name, use);
  }
  const total = [...uses.values()].reduce((sum, use) => sum + use.weight, 0);
  const chords = [...uses]
    .map(([name, use]) => ({
      name,
      count: use.count,
      share: total > 0 ? use.weight / total : 0,
    }))
    .sort((a, b) => b.share - a.share || b.count - a.count || a.name.localeCompare(b.name));

  const spans = sectionSpans(outline);
  const progressions =
    spans.length === 0
      ? [progressionOf(events.map((event) => event.name))]
      : spans.flatMap((span) => {
          const inside = collapse(
            events.filter((event) => event.bar >= span.fromBar && event.bar <= span.toBar),
          );
          return inside.length === 0
            ? []
            : [
                progressionOf(
                  inside.map((event) => event.name),
                  span.name,
                ),
              ];
        });
  return { source, chords, progressions };
}
