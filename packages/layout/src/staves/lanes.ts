/**
 * Rows above and below a staff for what is not attached to a note head: one per kind, in a fixed
 * order nearest the staff first, sized per system so every bar of a line draws a row at one y.
 */
export const LANES_ABOVE = [
  'bend',
  'articulation',
  'pickStroke',
  'palmMute',
  'letRing',
  'harmonic',
  'fade',
  'tap',
  'vibrato',
  'beatVibrato',
  'trill',
  'whammy',
  'chord',
  'fingering',
  'text',
  'repeatCount',
] as const;

export const LANES_BELOW = ['dynamics', 'lyrics'] as const;

export type LaneAbove = (typeof LANES_ABOVE)[number];
export type LaneBelow = (typeof LANES_BELOW)[number];
export type LaneId = LaneAbove | LaneBelow;

/** The height a bar needs for each lane it draws into, in px. */
export type LaneRequests = Partial<Record<LaneId, number>>;

/** A lane's absolute y range in a system. */
export interface LaneBand {
  top: number;
  bottom: number;
}

export type LaneBands = Readonly<Partial<Record<LaneId, LaneBand>>>;

/** Fixed lane heights, in staff spaces; the others are measured. */
export const LANE_HEIGHT = {
  bend: 3,
  run: 1.4,
  fade: 1.9,
  tap: 1.3,
  vibrato: { slight: 1, wide: 1.6 },
  beatVibrato: { slight: 1.2, wide: 1.7 },
  trill: 2,
  whammy: 5,
  repeatCount: 1.6,
  tabDynamics: 2.4,
  dynamics: 2.9,
} as const;

const ALL_LANES: readonly LaneId[] = [...LANES_ABOVE, ...LANES_BELOW];

/** Raises each lane in `into` to the height `from` asks for. */
export function mergeLanes(into: LaneRequests, from: LaneRequests): void {
  for (const lane of ALL_LANES) {
    const height = from[lane];
    if (height !== undefined) into[lane] = Math.max(into[lane] ?? 0, height);
  }
}
