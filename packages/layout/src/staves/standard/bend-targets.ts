import type { Bar, Bend, Note, Track } from '@reprise/model';

import type { ChordPlan } from './chord';

/**
 * Target heads: `gap` is the room from the arrival x and around each obstacle, and `snap` how close two positions
 * (0 to 60) or a position and the end count as one. Guitar Pro 6 and 7 store percentages, so a
 * bend "to the end" holds 59.4 and a peak and its release dip 29.4 and 30; dividing by the
 * sliver between them would stretch the bar by hundreds of px (#323).
 */
export const TARGET = { gap: 0.2, snap: 3 } as const;

/** A position within `snap` of the end is the end. */
export function snapPosition(position: number): number {
  return position >= 60 - TARGET.snap ? 60 : position;
}

/** A pitch a bend reaches and keeps, drawn as a grace-size head. */
export interface BendTarget {
  /** Quarter tones above the fretted pitch; always even. */
  value: number;
  /** Bend position, 0 to 60, where the pitch is reached: where the shaft arrives. */
  position: number;
}

/** Target heads reached at one position, as one stemless grace-size chord each. */
export interface TargetGroup {
  position: number;
  chord: ChordPlan;
}

/** What a beat's target heads need: the shortest frame that keeps them clear, and the room after it. */
export interface BendPlan {
  groups: TargetGroup[];
  need: number;
  tail: number;
}

/** Something a target must keep clear of: a shaft turning or dipping at `position`. */
export interface TargetObstacle {
  position: number;
  /** How far left of its nominal x it is drawn, for a bend that starts at the onset. */
  offset: number;
}

export function targetKey(noteId: string, index: number): string {
  return `${noteId}:bend:${String(index)}`;
}

/**
 * The target heads of a bend, in position order. The last is where the bend ends up; a bend
 * and release also gets one at its peak. Odd values (quarter tones), negative ones and a repeat
 * of the head before are left out. Pre-bends, holds and the shapes with no single end get none.
 */
export function bendTargets(bend: Bend): BendTarget[] {
  const points = [...bend.points].sort((a, b) => a.position - b.position);
  const last = points.at(-1);
  const top = Math.max(0, ...points.map((point) => point.value));
  if (!last || top <= 0) return [];
  if (!['bend', 'prebendBend', 'prebendRelease', 'release', 'bendRelease'].includes(bend.kind)) {
    return [];
  }
  let i = points.length - 1;
  while (i > 0 && points[i - 1]?.value === last.value) i -= 1;
  const arrival = points[i];
  if (i === 0 || !arrival) return [];
  const found: BendTarget[] = [];
  if (bend.kind === 'bendRelease') {
    const peak = points.findIndex((point) => point.value === top);
    const at = points[peak];
    if (at && peak >= 1 && peak < i)
      found.push({ value: top, position: snapPosition(at.position) });
  }
  found.push({ value: last.value, position: snapPosition(arrival.position) });
  const kept: BendTarget[] = [];
  for (const target of found) {
    if (target.value < 0 || target.value % 2 !== 0) continue;
    if (kept.at(-1)?.value === target.value) continue;
    kept.push(target);
  }
  return kept;
}

/**
 * Whether `note`, the beat at `beat` of voice `voice` in its bar, is tied into the very next beat
 * of the voice: in the bar, or the next bar's first beat. The ties `drawTies` draws, so a bend
 * is tied exactly when a tie leaves its head.
 */
export function tiedOnward(
  track: Pick<Track, 'kind'>,
  bar: Bar,
  next: Bar | undefined,
  voice: number,
  beat: number,
  note: Note,
): boolean {
  const beats = bar.voices[voice]?.beats ?? [];
  const following = beat + 1 < beats.length ? beats[beat + 1] : next?.voices[voice]?.beats[0];
  const fretted = track.kind === 'fretted';
  return (
    following?.notes.some(
      (other) => other.tie && (fretted ? other.string === note.string : other.fret === note.fret),
    ) ?? false
  );
}

/**
 * The targets a note's bend draws: none on a harmonic, a dead note or a track that is not fretted,
 * and none on a note tied onward, whose tie would cross a head (alphaTab skips them too, #111).
 */
export function targetsOf(track: Pick<Track, 'kind'>, note: Note, tied = false): BendTarget[] {
  if (tied || track.kind !== 'fretted' || !note.bend || note.dead || note.harmonic) return [];
  return bendTargets(note.bend);
}

/**
 * The shortest bend frame, in px, that keeps every group clear of the obstacles after it and
 * of its own end, and the room kept after a group arriving at the frame's end.
 */
export function bendSpan(
  groups: readonly { position: number; width: number }[],
  obstacles: readonly TargetObstacle[],
  space: number,
): { need: number; tail: number } {
  const gap = TARGET.gap * space;
  const tail = Math.max(
    0,
    ...groups.filter((g) => snapPosition(g.position) >= 60).map((g) => gap + g.width),
  );
  let need = 0;
  for (const group of groups) {
    const f = snapPosition(group.position) / 60;
    for (const obstacle of obstacles) {
      const after = obstacle.position / 60 - f;
      // An obstacle within `snap` after the group is the group's own position.
      if (after > TARGET.snap / 60) {
        need = Math.max(need, (group.width + 2 * gap + obstacle.offset) / after);
      }
    }
    if (f < 1) need = Math.max(need, (group.width + gap - tail) / (1 - f));
  }
  return { need, tail };
}

/**
 * What a bar's first beats tie back into the bar before: a bent note tied onward draws no target
 * heads, so the previous bar's plan and measure read it. A string compares by value, so an edit
 * elsewhere in the bar does not re-measure the bar before.
 */
export function tiesIntoNext(next: Bar | undefined): string {
  if (!next) return '';
  return JSON.stringify(
    next.voices.map((voice) =>
      voice.beats[0]?.notes.filter((note) => note.tie).map((note) => [note.string, note.fret]),
    ),
  );
}
