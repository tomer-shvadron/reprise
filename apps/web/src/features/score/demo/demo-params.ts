import { ZOOM } from '@/state/ui';
import type { Theme } from '@/state/theme';

import type { NotationChoice, PaperSize, ViewSettings } from '../view-options';

/** The generated long score rather than a file under fixtures/. */
export const LONG_FIXTURE = 'long';

export type DemoView = 'scroll' | 'pages';

export interface DemoParams {
  fixture: string;
  mode: ViewSettings['mode'];
  paper: PaperSize;
  notation: NotationChoice;
  zoom: number;
  theme: Theme;
  view: DemoView;
}

const MODES: readonly ViewSettings['mode'][] = ['paged', 'continuous'];
const PAPERS: readonly PaperSize[] = ['a4', 'letter'];
const NOTATIONS: readonly NotationChoice[] = ['default', 'tab', 'standard', 'both'];
const THEMES: readonly Theme[] = ['dark', 'light'];
const VIEWS: readonly DemoView[] = ['scroll', 'pages'];

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback;
}

function zoomOf(value: string | null): number {
  const zoom = Number(value ?? Number.NaN);
  return Number.isFinite(zoom) ? Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) : ZOOM.default;
}

/** The demo's whole state, from the URL query; anything invalid falls back to its default. */
export function parseDemoParams(search: string, theme: Theme): DemoParams {
  const query = new URLSearchParams(search);
  const fixture = query.get('fixture');
  return {
    fixture: fixture !== null && fixture !== '' ? fixture : LONG_FIXTURE,
    mode: oneOf(MODES, query.get('mode'), 'paged'),
    paper: oneOf(PAPERS, query.get('paper'), 'a4'),
    notation: oneOf(NOTATIONS, query.get('notation'), 'default'),
    zoom: zoomOf(query.get('zoom')),
    theme: oneOf(THEMES, query.get('theme'), theme),
    view: oneOf(VIEWS, query.get('view'), 'scroll'),
  };
}

export function serializeDemoParams(params: DemoParams): string {
  const { fixture, mode, paper, notation, zoom, theme, view } = params;
  return `?${new URLSearchParams({
    fixture,
    mode,
    paper,
    notation,
    zoom: String(zoom),
    theme,
    view,
  }).toString()}`;
}

export const DEMO_CHOICES = { MODES, PAPERS, NOTATIONS, THEMES, VIEWS };
