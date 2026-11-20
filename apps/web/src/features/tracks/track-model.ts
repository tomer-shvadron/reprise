import { channelPanToStereo, type TrackParams } from '@reprise/audio';
import {
  canShowTab,
  shownNotation,
  type Id,
  type Notation,
  type Score,
  type Track,
} from '@reprise/model';
import { defaultFilter } from 'cmdk';

import { instrumentName } from '@/lib/gm-programs';

export interface TrackMix {
  mute: boolean;
  solo: boolean;
}

/** The file's own mute and solo under the session's overrides. */
export function effectiveMix(track: Track, override: TrackParams | undefined): TrackMix {
  return {
    mute: override?.mute ?? track.channel.mute,
    solo: override?.solo ?? track.channel.solo,
  };
}

/** The tracks that sound, by the sampler's rule: with any solo only soloed ones, and mute wins. */
export function audibleTracks(
  tracks: readonly Track[],
  mixer: Readonly<Record<Id, TrackParams>>,
): ReadonlySet<Id> {
  const mixes = tracks.map((track) => ({ id: track.id, ...effectiveMix(track, mixer[track.id]) }));
  const anySolo = mixes.some((mix) => mix.solo);
  return new Set(mixes.filter((mix) => !mix.mute && (!anySolo || mix.solo)).map((mix) => mix.id));
}

/** The notation the track is drawn in: the session's choice or the file's, as the layout shows it. */
export function effectiveNotation(
  track: Track,
  notation: Readonly<Record<Id, Notation>>,
): Notation {
  return shownNotation(track, notation[track.id] ?? track.display.notation);
}

export const NOTATION_NAMES: Record<Notation, string> = {
  tab: 'Tab',
  standard: 'Standard notation',
  both: 'Tab and standard notation',
};

export const NO_TAB_REASON =
  'Tab needs a string and fret for each note, and this track’s notes have none.';

/** What the notation menu enables: a tab staff needs strings, and drums get no menu at all. */
export function notationChoices(track: Track): Notation[] {
  if (track.kind === 'drums') return [];
  return canShowTab(track) ? ['tab', 'standard', 'both'] : ['standard'];
}

/** The ids shown in multitrack view. */
export function visibleSet(tracks: readonly Track[], view: Id[] | 'all'): ReadonlySet<Id> {
  return new Set(view === 'all' ? tracks.map((track) => track.id) : view);
}

/**
 * The multitrack set after showing or hiding one track: ids in score order, `'all'` once every
 * track shows, and `undefined` when hiding would leave nothing to show.
 */
export function nextVisibility(
  tracks: readonly Track[],
  view: Id[] | 'all',
  id: Id,
  visible: boolean,
): Id[] | 'all' | undefined {
  const shown = new Set(visibleSet(tracks, view));
  if (visible) shown.add(id);
  else shown.delete(id);
  const ids = tracks.filter((track) => shown.has(track.id)).map((track) => track.id);
  if (ids.length === 0) return undefined;
  return ids.length === tracks.length ? 'all' : ids;
}

/** The neighbouring track's id, clamped at both ends. */
export function stepTrackId(
  tracks: readonly Track[],
  current: Id | undefined,
  direction: -1 | 1,
): Id | undefined {
  if (tracks.length === 0) return undefined;
  const index = tracks.findIndex((track) => track.id === current);
  if (index < 0) return tracks[0]?.id;
  const next = Math.min(tracks.length - 1, Math.max(0, index + direction));
  return tracks[next]?.id;
}

/** Controller volume 0 to 127 as a percentage. */
export function volumeText(volume: number): string {
  return `${String(Math.round((volume / 127) * 100))}%`;
}

/** Controller pan 0 to 127: the short readout and the slider's value text. */
export function panText(pan: number): { short: string; spoken: string } {
  const stereo = Math.round(channelPanToStereo(pan) * 100);
  if (stereo === 0) return { short: 'C', spoken: 'centre' };
  const side = stereo < 0 ? 'left' : 'right';
  const amount = Math.abs(stereo);
  return {
    short: `${stereo < 0 ? 'L' : 'R'} ${String(amount)}`,
    spoken: `${String(amount)}% ${side}`,
  };
}

/** A blank name reads as its position. */
export function trackLabel(track: Pick<Track, 'name'>, index: number): string {
  return track.name.trim() === '' ? `Track ${String(index + 1)}` : track.name;
}

export interface TrackEntry {
  id: Id;
  /** 1-based score index: the one numbering the sidebar, the palette and the number keys share. */
  number: number;
  label: string;
  instrument: string;
  hidden: boolean;
  current: boolean;
}

export function trackEntries(
  score: Score,
  view: Id[] | 'all',
  currentTrack: Id | undefined,
): TrackEntry[] {
  const shown = visibleSet(score.tracks, view);
  return score.tracks.map((track, index) => ({
    id: track.id,
    number: index + 1,
    label: trackLabel(track, index),
    instrument: instrumentName(track),
    hidden: !shown.has(track.id),
    current: track.id === currentTrack,
  }));
}

/**
 * Tracks matching `query`: a number first when the query is only digits, then label prefixes,
 * then cmdk's fuzzy score over the label and instrument. An empty query lists them in score order.
 */
export function rankTracks(entries: readonly TrackEntry[], query: string): TrackEntry[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return [...entries];
  const digits = /^\d+$/u.test(wanted) ? Number(wanted) : undefined;
  return entries
    .map((entry, order) => {
      let score = defaultFilter(entry.label, wanted, [entry.instrument]);
      if (entry.label.toLowerCase().startsWith(wanted)) score = Math.max(score, 2);
      if (digits !== undefined && entry.number === digits) score = 3;
      return { entry, score, order };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.entry);
}
