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

/** A layout of one shared long score, computed once per view and notation. */
export function longLayout(view: ViewSettings, notation: NotationChoice = 'default'): LayoutResult {
  shared ??= longScore();
  const key = JSON.stringify([view, notation]);
  const cached = layouts.get(key);
  if (cached) return cached;
  const result = layout(
    shared,
    viewLayoutOptions(view, { tracks: 'all', notation: uniformNotation(shared, notation) }),
  );
  layouts.set(key, result);
  return result;
}
