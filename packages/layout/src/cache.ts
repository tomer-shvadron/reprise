import type { Id } from '@reprise/model';

import type { SystemPlan } from './breaking';
import type { BarMeasure } from './measure';
import type { Anchor, Primitive, System } from './types';

export interface CachedBar {
  /** What the measurement was made from, compared by identity: Immer keeps unchanged nodes. */
  inputs: readonly unknown[];
  measure: BarMeasure;
}

export interface CachedSystem {
  plan: SystemPlan;
  /** Master-bar ids from the system's first bar through the bar after its last. */
  barIds: (Id | undefined)[];
  verticalKey: string;
  system: System;
  primitives: Primitive[];
  anchors: Anchor[];
}

export interface CacheState {
  measureKey: string;
  systemKey: string;
  bars: Map<Id, CachedBar>;
  systems: CachedSystem[];
}

const states = new WeakMap<LayoutCache, CacheState>();

/**
 * Per-bar measurements and the systems built from them, carried between `layout()` calls of one
 * document so an edit re-measures only the bars it touched and re-breaks from the first of them.
 * Drop it with the document.
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
