import type { BeatProjection, ScoreProjection } from './projection';

export interface Difference {
  /** The fixture's path under `fixtures/`, `gp5/effects.gp5`. */
  fixture: string;
  /** `tracks[0].bars[14].voices[0].beats[2].notes[0].vibrato`; an array whose lengths differ
   * ends in `.length`. */
  path: string;
  /** The last named segment of the path: `vibrato`, `beats`. */
  field: string;
  ours: unknown;
  alphaTab: unknown;
  /** The beat both sides hold at this path, when the path is inside one. */
  beat?: { ours: BeatProjection; alphaTab: BeatProjection };
}

type Node = unknown;

const isRecord = (value: Node): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLeaf = (value: Node): boolean =>
  !isRecord(value) &&
  !(Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null));

const sameLeaf = (a: Node, b: Node): boolean => JSON.stringify(a) === JSON.stringify(b);

function isBeat(value: Node): value is BeatProjection {
  return isRecord(value) && 'duration' in value && 'notes' in value;
}

/**
 * Walks both projections in step. Arrays of records are compared index by index up to the
 * shorter one, with their lengths reported apart, so one missing beat does not hide the rest of
 * the bar's comparison.
 */
export function compareProjections(
  fixture: string,
  ours: ScoreProjection,
  alphaTab: ScoreProjection,
): Difference[] {
  const differences: Difference[] = [];

  function walk(a: Node, b: Node, path: string, field: string, beat: Difference['beat']): void {
    if (isLeaf(a) || isLeaf(b)) {
      if (!sameLeaf(a, b)) {
        differences.push({ fixture, path, field, ours: a, alphaTab: b, ...(beat && { beat }) });
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        differences.push({
          fixture,
          path: `${path}.length`,
          field,
          ours: a.length,
          alphaTab: b.length,
          ...(beat && { beat }),
        });
      }
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        walk(a[i], b[i], `${path}[${String(i)}]`, field, beat);
      }
      return;
    }
    if (isRecord(a) && isRecord(b)) {
      const inner = field === 'beats' && isBeat(a) && isBeat(b) ? { ours: a, alphaTab: b } : beat;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], path === '' ? key : `${path}.${key}`, key, inner);
      }
      return;
    }
    differences.push({ fixture, path, field, ours: a, alphaTab: b, ...(beat && { beat }) });
  }

  walk(ours, alphaTab, '', '', undefined);
  return differences;
}

export function formatDifference({ fixture, path, ours, alphaTab }: Difference): string {
  return `${fixture} ${path}: ours ${JSON.stringify(ours)}, alphaTab ${JSON.stringify(alphaTab)}`;
}
