import type { Bend, Note, Track } from '@reprise/model';

import type { ChordPlan } from './chord';

/** Target heads, in staff spaces: the gap from the arrival x and around each obstacle. */
export const TARGET = { gap: 0.2 } as const;

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
    if (at && peak >= 1 && peak < i) found.push({ value: top, position: at.position });
  }
  found.push({ value: last.value, position: arrival.position });
  const kept: BendTarget[] = [];
  for (const target of found) {
    if (target.value < 0 || target.value % 2 !== 0) continue;
    if (kept.at(-1)?.value === target.value) continue;
    kept.push(target);
  }
  return kept;
}

/** The targets a note's bend draws: none on a harmonic, a dead note or a track that is not fretted. */
export function targetsOf(track: Pick<Track, 'kind'>, note: Note): BendTarget[] {
  if (track.kind !== 'fretted' || !note.bend || note.dead || note.harmonic) return [];
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
  const tail = Math.max(0, ...groups.filter((g) => g.position >= 60).map((g) => gap + g.width));
  let need = 0;
  for (const group of groups) {
    const f = group.position / 60;
    for (const obstacle of obstacles) {
      const after = obstacle.position / 60 - f;
      if (after > 1e-9) {
        need = Math.max(need, (group.width + 2 * gap + obstacle.offset) / after);
      }
    }
    if (f < 1) need = Math.max(need, (group.width + gap - tail) / (1 - f));
  }
  return { need, tail };
}
