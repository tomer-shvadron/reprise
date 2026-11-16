import {
  barTicks,
  beatTicks,
  chain,
  createBeat,
  insertBar,
  newId,
  replaceBeats,
  type Beat,
  type ChainStep,
  type Id,
  type Score,
  type Track,
} from '@reprise/model';

import type { EditRange, SelectionState } from '@/state/selection';

import { clipSummary } from './clip';
import type { Clip, ClipTrack } from './clipboard-format';
import { cursorTick, resolveCursor } from './cursor';
import type { Landing } from './entry';
import type { EntryMode } from './entry-store';
import { rangeSpan } from './range';
import { refinger } from './refinger';
import { overfullMessage, restsFor } from './rhythm';

const EPSILON = 1e-6;

export type PasteMode = EntryMode;

export interface PastePlan {
  command: ReturnType<typeof chain>;
  /** The cursor goes to the first pasted beat, or the first pasted bar. */
  land: Landing;
  /** The pasted span, so the next copy, cut or delete acts on it. */
  range: EditRange | undefined;
  /** What the status line says once the paste is in: what went where, and any re-fingering. */
  notice: string;
}

export type PasteResult = PastePlan | { refused: string };

type PasteState = Pick<SelectionState, 'cursor' | 'range'>;

const KIND_NAMES = { fretted: 'fretted', drums: 'drum', pitched: 'pitched' } as const;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** A copy of the beats with an id on every beat, note and grace note that nothing else in any score has. */
function fresh(beats: readonly Beat[]): Beat[] {
  const renew = <T extends { id: Id }>(item: T): T => ({ ...item, id: newId() });
  return beats.map((beat) => ({
    ...renew(beat),
    notes: beat.notes.map(renew),
    ...(beat.grace && {
      grace: beat.grace.map((ornament) => ({ ...ornament, notes: ornament.notes.map(renew) })),
    }),
  }));
}

const ticksOf = (beats: readonly Beat[]): number =>
  beats.reduce((sum, beat) => sum + beatTicks(beat), 0);

/** Rests that fill `ticks`, or undefined when no run of plain and dotted rests does. */
function restBeats(ticks: number): Beat[] | undefined {
  const rhythms = restsFor(ticks);
  return rhythms?.map(({ duration, dots, tuplet }) =>
    createBeat({ duration, dots, rest: true, ...(tuplet && { tuplet }) }),
  );
}

interface Placed {
  track: number;
  bar: number;
  /** Ticks into the bar where the clip's own beats start, and where they end. */
  from: number;
  to: number;
  first: Id;
  last: Id;
}

interface Splice {
  track: number;
  bar: number;
  voice: number;
  index: number;
  remove: number;
  beats: Beat[];
}

interface Anchor {
  track: number;
  bar: number;
  tick: number;
  voice: number;
}

/** Where a paste begins: the range's start, else the cursor's stop; undefined with neither. */
function anchorOf(score: Score, state: PasteState, visible: readonly Id[]): Anchor | undefined {
  const { range, cursor } = state;
  const voice = cursor?.voice ?? 0;
  if (range) {
    const span = rangeSpan(score, range, visible);
    const first = span?.tracks[0];
    const track = score.tracks.findIndex(({ id }) => id === first);
    if (span && track >= 0) return { track, bar: span.start.bar, tick: span.start.tick, voice };
  }
  const at = cursor && resolveCursor(score, cursor);
  const tick = cursor && cursorTick(score, cursor);
  return at && tick !== undefined
    ? { track: at.track, bar: at.bar, tick, voice: at.voice }
    : undefined;
}

function neckLabel(track: Track): string {
  return plural(track.tuning.length, 'string');
}

/**
 * Plans a paste as one command: `insertBar` steps for the bars it adds, then one `replaceBeats`
 * for every voice it changes, so it is one undo step. Pure: it reads `score` and returns the
 * command, the landing, the range to select and the notice, or why it cannot.
 *
 * - The clip's tracks go onto the visible tracks from the anchor's track down, the same kind
 *   only; a fretted clip with another string count is re-fingered by pitch.
 * - A bars clip replaces whole bars (overwrite) or becomes new bars at the target (insert),
 *   which take the clip's time signatures. Overwrite never edits a bar's properties and refuses
 *   content that would overflow its bar.
 * - A beats clip starts at the cursor's stop in the cursor's voice (a clip of several voices
 *   keeps their indices); overwrite replaces the beats its length covers, insert pushes the rest
 *   along. Past the last bar it appends bars, in the same step.
 */
export function planPaste(
  score: Score,
  clip: Clip,
  state: PasteState,
  visible: readonly Id[],
  mode: PasteMode,
): PasteResult {
  const anchor = anchorOf(score, state, visible);
  if (!anchor) return { refused: 'Put the cursor where the paste should go' };

  const shown = new Set(visible);
  const candidates = score.tracks.flatMap((track, index) =>
    index >= anchor.track && shown.has(track.id) ? [{ track, index }] : [],
  );
  const targets = candidates.slice(0, clip.tracks.length);
  if (targets.length < clip.tracks.length) {
    return {
      refused: `The clipboard holds ${plural(clip.tracks.length, 'track')} and only ${plural(targets.length, 'track')} ${targets.length === 1 ? 'is' : 'are'} here or below`,
    };
  }

  let dropped = 0;
  let refingered: Track | undefined;
  const sources: ClipTrack[] = [];
  for (const [i, { track }] of targets.entries()) {
    const from = clip.tracks[i];
    if (!from) continue;
    if (from.kind !== track.kind) {
      const name = KIND_NAMES[from.kind];
      return { refused: `Notes from a ${name} track paste only into a ${name} track` };
    }
    if (track.kind === 'fretted' && from.tuning.length !== track.tuning.length) {
      const result = refinger(from, track);
      dropped += result.dropped;
      refingered = track;
      sources.push(result.track);
    } else {
      sources.push(from);
    }
  }

  const count = Math.max(...sources.map(({ bars }) => bars.length));
  const bars = score.masterBars.length;
  // Bars the paste adds: new bars at the target for an insert of bars, else only those past the end.
  const insertBars = clip.kind === 'bars' && mode === 'insert';
  const added: { index: number; id: Id; clipBar: number }[] = [];
  for (let k = 0; k < count; k++) {
    if (insertBars || anchor.bar + k >= bars) {
      added.push({ index: anchor.bar + k, id: newId(), clipBar: k });
    }
  }
  const isNew = (bar: number) =>
    insertBars ? bar >= anchor.bar && bar < anchor.bar + count : bar >= bars;
  const barIds = score.masterBars.map(({ id }) => id);
  for (const { index, id } of added) barIds.splice(index, 0, id);

  const splices: Splice[] = [];
  const placed: Placed[] = [];
  for (const [t, source] of sources.entries()) {
    const target = targets[t];
    if (!target) continue;
    const usedVoices = new Set(source.bars.flatMap((bar) => bar.voices.map(({ voice }) => voice)));
    // A beats clip of one voice goes into the voice the cursor is in.
    const lone = clip.kind === 'beats' && usedVoices.size === 1;
    for (const [k, clipBar] of source.bars.entries()) {
      const bar = anchor.bar + k;
      const created = isNew(bar);
      const masterBar = score.masterBars[bar];
      const limit = barTicks({
        timeSignature: created || !masterBar ? clipBar.timeSignature : masterBar.timeSignature,
      });
      // A bars clip names all four voices, so a voice it lacks is cleared too.
      const jobs =
        clip.kind === 'bars'
          ? [0, 1, 2, 3].map((voice) => ({
              voice,
              entry: clipBar.voices.find((candidate) => candidate.voice === voice),
            }))
          : clipBar.voices.map((entry) => ({ voice: lone ? anchor.voice : entry.voice, entry }));
      for (const { voice, entry } of jobs) {
        const current: readonly Beat[] = created
          ? []
          : (target.track.bars[bar]?.voices[voice]?.beats ?? []);
        const beats = entry?.beats ?? [];
        const length = ticksOf(beats);
        const filled = ticksOf(current);
        const label = `Bar ${String(bar + 1)}, voice ${String(voice + 1)}`;
        if (clip.kind === 'bars') {
          if (length > limit + EPSILON) {
            return { refused: overfullMessage(bar + 1, limit, length) };
          }
          if (beats.length === 0 && current.length === 0) continue;
          const renewed = fresh(beats);
          splices.push({
            track: target.index,
            bar,
            voice,
            index: 0,
            remove: current.length,
            beats: renewed,
          });
          const [firstBeat] = renewed;
          const lastBeat = renewed.at(-1);
          if (firstBeat && lastBeat) {
            placed.push({
              track: target.index,
              bar,
              from: 0,
              to: length,
              first: firstBeat.id,
              last: lastBeat.id,
            });
          }
          continue;
        }
        if (beats.length === 0) continue;
        const start = (k === 0 ? anchor.tick : 0) + (entry?.offset ?? 0);
        let index = current.length;
        let gap = 0;
        if (start > filled + EPSILON) {
          gap = start - filled;
        } else if (start < filled - EPSILON) {
          let tick = 0;
          const found = current.findIndex((beat) => {
            const here = tick;
            tick += beatTicks(beat);
            return Math.abs(here - start) < EPSILON;
          });
          if (found < 0) {
            return { refused: `${label} has no beat starting where the paste begins` };
          }
          index = found;
        }
        let remove = 0;
        let removed = 0;
        let pad = 0;
        if (mode === 'overwrite' && index < current.length) {
          for (const beat of current.slice(index)) {
            if (removed >= length - EPSILON) break;
            removed += beatTicks(beat);
            remove += 1;
          }
          pad = Math.max(0, removed - length);
        }
        const room = limit - (filled - removed);
        if (gap + length > room + EPSILON) {
          return { refused: overfullMessage(bar + 1, Math.max(0, room), gap + length) };
        }
        const before = gap > 0 ? restBeats(gap) : [];
        const after = pad > 0 ? restBeats(pad) : [];
        if (!before || !after) {
          return { refused: `${label}: that length cannot be written as rests` };
        }
        const renewed = fresh(beats);
        splices.push({
          track: target.index,
          bar,
          voice,
          index,
          remove,
          beats: [...before, ...renewed, ...after],
        });
        const [firstBeat] = renewed;
        const lastBeat = renewed.at(-1);
        if (firstBeat && lastBeat) {
          placed.push({
            track: target.index,
            bar,
            from: start,
            to: start + length,
            first: firstBeat.id,
            last: lastBeat.id,
          });
        }
      }
    }
  }

  if (splices.length === 0 && added.length === 0) return { refused: 'There is nothing to paste' };

  const steps: ChainStep[] = added.map(({ index, id, clipBar }) => {
    const timeSignature = sources[0]?.bars[clipBar]?.timeSignature;
    return insertBar({ index, id }, timeSignature ? { timeSignature: { ...timeSignature } } : {});
  });
  if (splices.length > 0) {
    // After the inserts: the voices of a new bar exist only in the score they made.
    steps.push((next) =>
      replaceBeats(
        splices.map(({ track, bar, voice, index, remove, beats }) => {
          const found = next.tracks[track]?.bars[bar]?.voices[voice];
          if (!found)
            throw new Error(
              `paste planned a voice that is not there: ${String(track)}/${String(bar)}/${String(voice)}`,
            );
          return { voiceId: found.id, index, remove, beats };
        }),
      ),
    );
  }

  const firstTrack = targets[0]?.track;
  const lastTrack = targets.at(-1)?.track;
  const firstBar = barIds[anchor.bar];
  const lastBar = barIds[anchor.bar + count - 1];
  let range: EditRange | undefined;
  let land: Landing | undefined;
  if (clip.kind === 'bars') {
    if (firstTrack && lastTrack && firstBar && lastBar) {
      range = {
        kind: 'bars',
        anchor: { track: firstTrack.id, masterBar: firstBar, beat: undefined },
        focus: { track: lastTrack.id, masterBar: lastBar, beat: undefined },
      };
    }
    if (firstBar) land = { bar: firstBar };
  } else {
    const ofTrack = (index: number | undefined) => placed.filter(({ track }) => track === index);
    const head = ofTrack(targets[0]?.index).sort((a, b) => a.bar - b.bar || a.from - b.from)[0];
    const tail = ofTrack(targets.at(-1)?.index).sort((a, b) => b.bar - a.bar || b.to - a.to)[0];
    const headBar = head && barIds[head.bar];
    const tailBar = tail && barIds[tail.bar];
    if (head && tail && firstTrack && lastTrack && headBar && tailBar) {
      range = {
        kind: 'beats',
        anchor: { track: firstTrack.id, masterBar: headBar, beat: head.first },
        focus: { track: lastTrack.id, masterBar: tailBar, beat: tail.last },
      };
      land = { beat: head.first };
    }
  }
  if (!land) return { refused: 'There is nothing to paste' };

  const where = clip.tracks.length > 1 ? ` into ${plural(clip.tracks.length, 'track')}` : '';
  const what = clipSummary({ ...clip, tracks: clip.tracks.slice(0, 1) });
  const warning =
    refingered === undefined
      ? ''
      : `. Re-fingered for ${neckLabel(refingered)}${dropped > 0 ? `; ${plural(dropped, 'note')} left out` : ''}`;
  return {
    command: chain(clip.kind === 'bars' ? 'pasteBars' : 'pasteBeats', steps),
    land,
    range,
    notice: `Pasted ${what}${where}${warning}`,
  };
}
