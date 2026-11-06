export interface PaintRecord {
  label: string;
  /** `layout()` itself. */
  layoutMs: number;
  /** From handing React the layout to the demo's layout effect: render and DOM commit. */
  commitMs: number;
  /** From the layout effect to the next frame: style, layout and paint. */
  frameMs: number;
  totalMs: number;
  /** Systems whose subtree the DOM changed in, for an edit. */
  changedSystems?: number;
  elements: number;
}

export interface ScrollRecord {
  label: string;
  frames: number;
  meanFps: number;
  p95Ms: number;
  over20Ms: number;
  elements: number;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Frame statistics over the intervals between animation frames, in ms. */
export function frameStats(intervals: readonly number[]): Omit<ScrollRecord, 'label' | 'elements'> {
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, interval) => sum + interval, 0);
  return {
    frames: intervals.length,
    meanFps: total > 0 ? (intervals.length * 1000) / total : 0,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    over20Ms: intervals.filter((interval) => interval > 20).length,
  };
}

/** Distinct systems containing the targets of DOM mutations. */
export function changedSystems(records: readonly MutationRecord[]): number {
  const ids = new Set<string>();
  for (const { target } of records) {
    const element = target instanceof Element ? target : target.parentElement;
    const id = element?.closest('svg[data-system-id]')?.getAttribute('data-system-id');
    if (id) ids.add(id);
  }
  return ids.size;
}
