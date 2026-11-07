import { layout, type LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';

import {
  uniformNotation,
  viewLayoutOptions,
  type NotationChoice,
  type ViewSettings,
} from '../view-options';

/** Big enough to scroll past and virtualize (14 systems on 7 A4 pages), cheap enough for unit tests. */
export function smallScore(): Score {
  return largeScore(2, 40);
}

/** Eight tracks in both notations: every system is split across two A4 pages (#85). */
export function tallScore(): Score {
  return largeScore(8, 6);
}

const layouts = new Map<string, LayoutResult>();

export function viewLayout(
  which: 'small' | 'tall',
  view: ViewSettings,
  notation: NotationChoice = 'default',
): LayoutResult {
  const key = JSON.stringify([which, view, notation]);
  const cached = layouts.get(key);
  if (cached) return cached;
  const score = which === 'small' ? smallScore() : tallScore();
  const result = layout(
    score,
    viewLayoutOptions(view, { tracks: 'all', notation: uniformNotation(score, notation) }),
  );
  layouts.set(key, result);
  return result;
}
