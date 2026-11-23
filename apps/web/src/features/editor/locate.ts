import {
  anchorBox,
  type Anchor,
  type LayoutResult,
  type StaffType,
  type System,
} from '@reprise/layout';
import type { Id, Score, Track } from '@reprise/model';

import { findAnchors, scoreIndex, type ScorePointerEvent } from '@/features/score';
import type { EditCursor } from '@/state/selection';

import { clampString, cursorAtPosition, defaultStaff, stopCount, stringCount } from './cursor';
import { laneNear } from './drum-lanes';
import { clefOf, pitchAtPosition } from './pitch-entry';

/** What a pointer position means to the editor: where the cursor would go, and the note under it, if any. */
export interface EditHit {
  track: Id;
  masterBar: Id;
  voice: number;
  staff: StaffType;
  /** Undefined: the voice's end slot. */
  beat: Id | undefined;
  /** Set when a note anchor was hit. */
  note: Id | undefined;
  string: number;
  /** The drum lane under the pointer, as a GM key; set on a drum track only. */
  pitch?: number;
  /** The note is a grace note of `beat`. */
  grace: boolean;
}

type Pointer = Pick<ScorePointerEvent, 'point' | 'anchor' | 'column'>;

/**
 * The string whose tab line is nearest `y`, from the track's tab staff in `system`; undefined when
 * the system holds no tab staff of the track. Lines are evenly spaced from `top` (string 1).
 */
export function stringAt(
  system: System | undefined,
  track: Id,
  strings: number,
  y: number,
): number | undefined {
  const staff = system?.staves.find((s) => s.track === track && s.type === 'tab');
  if (!staff || strings < 1) return undefined;
  if (strings === 1) return 1;
  const spacing = (staff.bottom - staff.top) / (strings - 1);
  if (spacing <= 0) return 1;
  return Math.min(Math.max(Math.round((y - staff.top) / spacing) + 1, 1), strings);
}

/**
 * The drum lane nearest `y` on the track's percussion staff in `system`; undefined when the
 * system holds none. Position 0 is the bottom line and each step is half a staff space.
 */
function laneAtY(
  system: System | undefined,
  track: Track,
  y: number,
  current: number | undefined,
): number | undefined {
  const staff = system?.staves.find((s) => s.track === track.id && s.type === 'percussion');
  if (!staff || staff.bottom <= staff.top) return undefined;
  const space = (staff.bottom - staff.top) / 4;
  return laneNear(track, ((staff.bottom - y) / space) * 2, current);
}

/**
 * The key written nearest `y` on the track's standard staff in `system`, in bar `bar`'s clef and
 * key; undefined when the system holds none. Position 0 is the bottom line, a step half a space.
 */
function pitchAtY(
  system: System | undefined,
  score: Score,
  trackIndex: number,
  bar: number,
  y: number,
): number | undefined {
  const track = score.tracks[trackIndex];
  const staff = system?.staves.find((s) => s.track === track?.id && s.type === 'standard');
  if (!track || !staff || staff.bottom <= staff.top) return undefined;
  const space = (staff.bottom - staff.top) / 4;
  return pitchAtPosition(
    Math.round(((staff.bottom - y) / space) * 2),
    clefOf(track, bar),
    track.display.octaveShift,
    score.masterBars[bar]?.keySignature ?? { fifths: 0, minor: false },
  );
}

/** The staff of `track` in `system` nearest `y`, or the default for the track. */
function staffAt(
  score: Score,
  system: System | undefined,
  trackIndex: number,
  y: number,
): StaffType {
  const track = score.tracks[trackIndex];
  const own = system?.staves.filter((s) => s.track === track?.id) ?? [];
  let best: StaffType | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const s of own) {
    const d = Math.max(0, s.top - y, y - s.bottom);
    if (d < nearest) {
      nearest = d;
      best = s.type;
    }
  }
  return best ?? defaultStaff(score, trackIndex);
}

/**
 * The stop of a voice nearest `x`, among the beats drawn in `system`; the end slot when `x` lies
 * right of the last of them and the bar has one, or the voice is empty.
 */
function stopNear(
  layout: LayoutResult,
  score: Score,
  trackIndex: number,
  bar: number,
  voice: number,
  system: number,
  x: number,
): number {
  const beats = score.tracks[trackIndex]?.bars[bar]?.voices[voice]?.beats ?? [];
  const stops = stopCount(score, trackIndex, bar, voice);
  let best = -1;
  let nearest = Number.POSITIVE_INFINITY;
  let lastX = Number.NEGATIVE_INFINITY;
  beats.forEach((beat, i) => {
    const drawn = findAnchors(layout, beat.id, 'beat').find((a) => a.system === system);
    if (!drawn) return;
    const box = anchorBox(layout, drawn);
    const centre = box.x + box.width / 2;
    lastX = Math.max(lastX, box.x + box.width);
    if (Math.abs(centre - x) < nearest) {
      nearest = Math.abs(centre - x);
      best = i;
    }
  });
  if (best < 0) return Math.max(stops - 1, 0);
  return stops > beats.length && x > lastX ? beats.length : best;
}

/** Whether the voice's note anchor is a grace note of `beat`: its id is not among the beat's own notes. */
function isGrace(score: Score, noteId: Id, beatId: Id): boolean {
  const info = scoreIndex(score).beats.get(beatId);
  const beat =
    info &&
    score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  return beat !== undefined && !beat.notes.some((n) => n.id === noteId);
}

/** The lane the cursor already holds on `track`; a lane on another track means nothing here. */
const sameTrackLane = (current: EditCursor | undefined, track: Id): number | undefined =>
  current?.track === track ? current.pitch : undefined;

/** The GM key of a drum note, from the beat that holds it. */
function noteKey(score: Score, beatId: Id, noteId: Id): number | undefined {
  const info = scoreIndex(score).beats.get(beatId);
  const beat =
    info &&
    score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  return beat?.notes.find((n) => n.id === noteId)?.fret;
}

/** Resolves a pointer event to where the editor would put its cursor; undefined over nothing the score owns. */
export function locate(
  layout: LayoutResult,
  score: Score,
  hit: Pointer,
  current?: EditCursor,
  visible?: readonly Id[],
): EditHit | undefined {
  const { anchor, column, point } = hit;
  const index = scoreIndex(score);
  const system = (a: Anchor | undefined) => (a ? layout.systems[a.system] : undefined);

  const beatId =
    anchor?.kind === 'beat'
      ? anchor.id
      : anchor?.kind === 'note'
        ? index.noteBeat.get(anchor.id)
        : undefined;
  const info = beatId === undefined ? undefined : index.beats.get(beatId);
  const masterBar = info && score.masterBars[info.masterBarIndex];
  const track = info && score.tracks[info.trackIndex];
  if (anchor && beatId !== undefined && info && masterBar && track) {
    const staff = anchor.staff ?? defaultStaff(score, info.trackIndex);
    let string: number;
    let note: Id | undefined;
    let pitch: number | undefined;
    if (anchor.kind === 'note') {
      note = anchor.id;
      string = index.noteString.get(anchor.id) ?? 1;
      if (track.kind !== 'fretted') {
        pitch = noteKey(score, beatId, anchor.id) ?? sameTrackLane(current, track.id);
      }
    } else {
      const strings = stringCount(score, info.trackIndex);
      const fromLine =
        staff === 'tab' ? stringAt(system(anchor), track.id, strings, point.y) : undefined;
      string = clampString(score, info.trackIndex, fromLine ?? current?.string ?? 1);
      if (track.kind === 'drums') {
        pitch = laneAtY(system(anchor), track, point.y, current?.pitch) ?? current?.pitch;
      } else if (track.kind === 'pitched') {
        // The height of the click is the pitch, as on a drum staff it is the drum.
        pitch =
          pitchAtY(system(anchor), score, info.trackIndex, info.masterBarIndex, point.y) ??
          sameTrackLane(current, track.id);
      }
    }
    return {
      track: track.id,
      masterBar: masterBar.id,
      voice: info.voice,
      staff,
      beat: beatId,
      note,
      string: clampString(score, info.trackIndex, string),
      ...(pitch !== undefined && { pitch }),
      grace: note !== undefined && isGrace(score, note, beatId),
    };
  }

  // A gap between beats of a track's bar, or the clef and key at a staff's start.
  if (anchor?.track !== undefined && (anchor.kind === 'bar' || anchor.kind === 'staff')) {
    const trackIndex = score.tracks.findIndex(({ id }) => id === anchor.track);
    const sys = system(anchor);
    const bar =
      anchor.kind === 'bar' && anchor.masterBar !== undefined
        ? (index.barIndex.get(anchor.masterBar) ?? -1)
        : (sys?.bars.start ?? -1);
    const bound = score.masterBars[bar];
    if (trackIndex >= 0 && bound) {
      const voice = current && current.track === anchor.track ? current.voice : 0;
      const stop =
        anchor.kind === 'staff'
          ? 0
          : stopNear(layout, score, trackIndex, bar, voice, anchor.system, point.x);
      return atStop(score, { trackIndex, bar, voice, stop, system: sys, y: point.y, current });
    }
  }

  // Between systems, in a margin, or on a staff with no track: the nearest column's bar.
  const columnBar =
    column?.masterBar === undefined ? undefined : index.barIndex.get(column.masterBar);
  const visibleFirst = visible?.[0];
  const wanted = current?.track ?? visibleFirst ?? score.tracks[0]?.id;
  const trackIndex = score.tracks.findIndex(({ id }) => id === wanted);
  if (column && columnBar !== undefined && trackIndex >= 0) {
    const voice = current && current.track === wanted ? current.voice : 0;
    const stop = stopNear(layout, score, trackIndex, columnBar, voice, column.system, point.x);
    return atStop(score, {
      trackIndex,
      bar: columnBar,
      voice,
      stop,
      system: system(column),
      y: undefined,
      current,
    });
  }
  return undefined;
}

function atStop(
  score: Score,
  at: {
    trackIndex: number;
    bar: number;
    voice: number;
    stop: number;
    system: System | undefined;
    y: number | undefined;
    current: EditCursor | undefined;
  },
): EditHit | undefined {
  const track = score.tracks[at.trackIndex];
  const masterBar = score.masterBars[at.bar];
  if (!track || !masterBar) return undefined;
  const beat = score.tracks[at.trackIndex]?.bars[at.bar]?.voices[at.voice]?.beats[at.stop]?.id;
  const staff =
    at.y === undefined
      ? at.current?.track === track.id
        ? at.current.staff
        : defaultStaff(score, at.trackIndex)
      : staffAt(score, at.system, at.trackIndex, at.y);
  const strings = stringCount(score, at.trackIndex);
  const fromLine =
    at.y !== undefined && staff === 'tab'
      ? stringAt(at.system, track.id, strings, at.y)
      : undefined;
  const lane =
    track.kind === 'pitched'
      ? ((at.y !== undefined
          ? pitchAtY(at.system, score, at.trackIndex, at.bar, at.y)
          : undefined) ?? sameTrackLane(at.current, track.id))
      : track.kind !== 'drums'
        ? undefined
        : ((at.y !== undefined ? laneAtY(at.system, track, at.y, at.current?.pitch) : undefined) ??
          (at.current?.track === track.id ? at.current.pitch : undefined));
  return {
    track: track.id,
    masterBar: masterBar.id,
    voice: at.voice,
    staff,
    beat,
    note: undefined,
    string: clampString(score, at.trackIndex, fromLine ?? at.current?.string ?? 1),
    ...(lane !== undefined && { pitch: lane }),
    grace: false,
  };
}

/** The cursor an `EditHit` puts down; undefined when its beat or bar is not in the score. */
export function cursorFromHit(score: Score, hit: EditHit): EditCursor | undefined {
  const index = scoreIndex(score);
  const track = score.tracks.findIndex(({ id }) => id === hit.track);
  const bar = index.barIndex.get(hit.masterBar);
  if (track < 0 || bar === undefined) return undefined;
  const beats = score.tracks[track]?.bars[bar]?.voices[hit.voice]?.beats ?? [];
  const stop = hit.beat === undefined ? beats.length : (index.beats.get(hit.beat)?.index ?? -1);
  return cursorAtPosition(
    score,
    { track, bar, voice: hit.voice, stop },
    { string: hit.string, staff: hit.staff, ...(hit.pitch !== undefined && { pitch: hit.pitch }) },
  );
}
