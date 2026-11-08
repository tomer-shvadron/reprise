import type { Id } from '@reprise/model';

import type { SystemPlan } from './breaking';
import type { BarMeasure } from './measure';
import type { LaneRequests } from './staves/lanes';
import type { Anchor, Primitive, Range, Rect, System } from './types';
import type { VerticalLayout } from './vertical';

export interface CachedBar {
  /** What the measurement was made from, compared by identity: Immer keeps unchanged nodes. */
  inputs: readonly unknown[];
  measure: BarMeasure;
  /**
   * The bar's lane requests per staff slot, with the index and entering dynamic they were made
   * at; filled in place once per call, as they depend on earlier bars through the dynamic.
   */
  lanes?: { index: number; entering: string; requests: LaneRequests[] };
}

/** Where the next system goes: paged systems flow down pages, continuous ones run rightwards. */
export interface Cursor {
  page: number;
  x: number;
  y: number;
  empty: boolean;
}

/** Where one part of a system went, and the staff slots it holds. */
export interface PartPlacement extends Cursor {
  slots: Range;
}

/** One part of a system as it went into the result: the whole system unless it was split. */
export interface CachedPart {
  system: System;
  /** The system's box as rendered, before `offsetX`. */
  box: Rect;
  primitives: Primitive[];
  anchors: Anchor[];
}

export interface CachedSystem {
  plan: SystemPlan;
  /** Master-bar ids from the system's first bar through the bar after its last. */
  barIds: (Id | undefined)[];
  verticalKey: string;
  /** Where each part was placed, and the unrounded stack they were placed from. */
  at: PartPlacement[];
  vertical: VerticalLayout;
  /** `enteringDynamics` at its first bar; empty when laid out without a cache. */
  entering: string;
  parts: CachedPart[];
}

export interface CacheState {
  measureKey: string;
  systemKey: string;
  bars: Map<Id, CachedBar>;
  barCount: number;
  systems: CachedSystem[];
}

const states = new WeakMap<LayoutCache, CacheState>();

/**
 * Per-bar measurements and the systems built from them, carried between `layout()` calls of one
 * document so an edit re-measures only the bars it touched and rebuilds only the systems within
 * reach of them. Drop it with the document.
 */
export class LayoutCache {
  /** Master bars with a measurement held. */
  get size(): number {
    return states.get(this)?.bars.size ?? 0;
  }

  clear(): void {
    states.delete(this);
  }
}

export function readCache(cache: LayoutCache): CacheState | undefined {
  return states.get(cache);
}

export function writeCache(cache: LayoutCache, state: CacheState): void {
  states.set(cache, state);
}

export function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}
