import { layout, type LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';

import {
  uniformNotation,
  viewLayoutOptions,
  type NotationChoice,
  type ViewSettings,
} from '../view-options';

/** The roadmap's long score: 8 tracks, 300 bars, with tempo, key and section changes. */
export function longScore(): Score {
  return largeScore(8, 300, { structure: true });
}

let shared: Score | undefined;
const layouts = new Map<string, LayoutResult>();

/** The one long score `longLayout` lays out. */
export function sharedLongScore(): Score {
  shared ??= longScore();
  return shared;
}

/** A layout of one shared long score, computed once per view and notation. */
export function longLayout(view: ViewSettings, notation: NotationChoice = 'default'): LayoutResult {
  const score = sharedLongScore();
  const key = JSON.stringify([view, notation]);
  const cached = layouts.get(key);
  if (cached) return cached;
  const result = layout(
    score,
    viewLayoutOptions(view, { tracks: 'all', notation: uniformNotation(score, notation) }),
  );
  layouts.set(key, result);
  return result;
}
