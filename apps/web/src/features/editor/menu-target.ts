import { anchorBox, type LayoutResult, type Rect } from '@reprise/layout';
import type { Id, Score } from '@reprise/model';

import type { MenuMode, MenuRequest } from '@/app/context-menu/types';
import type { AppServices } from '@/app/services';
import { barColumns, scoreIndex, type ScoreHit } from '@/features/score';
import { playheadBar } from '@/features/transport';
import type { MenuTarget } from '@/state/menu-target';
import type { BarRange } from '@/state/selection';

type MenuServices = Pick<AppServices, 'document' | 'selection' | 'playback' | 'heard'>;

/**
 * A menu to open and what opening it adopts into the selection: the right-clicked bar becomes the
 * selected bar, as in Guitar Pro, so the user sees what the menu acts on. A click inside the
 * selection or on the paper adopts nothing. It never seeks and leaves the loop alone.
 */
export interface ScoreMenuOpen {
  request: MenuRequest;
  adopt?: { bars: BarRange; track: Id | undefined };
}

const barNumber = (score: Score, id: Id): number =>
  score.masterBars.findIndex((bar) => bar.id === id) + 1;

const barsLabel = (score: Score, bars: BarRange): string => {
  const start = barNumber(score, bars.startBar);
  const end = barNumber(score, bars.endBar);
  return start === end ? `Bar ${String(start)}` : `Bars ${String(start)} to ${String(end)}`;
};

const within = (score: Score, bars: BarRange, id: Id): boolean => {
  const at = barNumber(score, id);
  return at >= barNumber(score, bars.startBar) && at <= barNumber(score, bars.endBar);
};

/** The beat-level facts a target carries, from the score's index. */
function beatFacts(score: Score, beat: Id) {
  const info = scoreIndex(score).beats.get(beat);
  const track = info && score.tracks[info.trackIndex];
  const masterBar = info && score.masterBars[info.masterBarIndex];
  return track && masterBar ? { track: track.id, masterBar: masterBar.id } : undefined;
}

const paper = (): ScoreMenuOpen => ({
  request: { surface: 'score.paper', target: { kind: 'paper' }, label: 'Score' },
});

const adopted = (
  surface: 'score.note' | 'score.beat' | 'score.bar' | 'score.chord' | 'score.section',
  target: MenuTarget,
  score: Score,
  masterBar: Id,
  track: Id | undefined,
  what: string,
): ScoreMenuOpen => ({
  request: { surface, target, label: `${what}, bar ${String(barNumber(score, masterBar))}` },
  adopt: { bars: { startBar: masterBar, endBar: masterBar }, track },
});

/**
 * What a right-click on the score opens. The first match wins: a chord name, a section marker,
 * the paper outside every system, the selected bars, then the note, the beat and the bar under
 * the point. Play mode only for now: edit mode keeps the browser's menu until its own lands.
 */
export function scoreMenuRequest(
  hit: ScoreHit,
  services: MenuServices,
  mode: MenuMode,
): ScoreMenuOpen | undefined {
  if (mode !== 'play') return undefined;
  const { score } = services.document.getState();
  if (!score) return paper();
  const { anchor, column, mark } = hit;

  if (mark?.kind === 'chord') {
    const facts = beatFacts(score, mark.beat);
    if (facts) {
      return adopted(
        'score.chord',
        { kind: 'chord', beat: mark.beat, ...facts },
        score,
        facts.masterBar,
        facts.track,
        'Chord name',
      );
    }
  }
  if (mark?.kind === 'section') {
    const name = score.masterBars.find((bar) => bar.id === mark.masterBar)?.section?.name;
    return adopted(
      'score.section',
      { kind: 'section', masterBar: mark.masterBar },
      score,
      mark.masterBar,
      undefined,
      name?.trim() ? `Section ${name.trim()}` : 'Section',
    );
  }
  if (!anchor) return paper();

  const barId = anchor.masterBar ?? column?.id;
  const selected = services.selection.getState().bars;
  if (selected && barId !== undefined && within(score, selected, barId)) {
    return {
      request: {
        surface: 'score.range',
        target: { kind: 'range', bar: barId },
        label: barsLabel(score, selected),
      },
    };
  }

  const index = scoreIndex(score);
  const beatId =
    anchor.kind === 'beat'
      ? anchor.id
      : anchor.kind === 'note'
        ? index.noteBeat.get(anchor.id)
        : undefined;
  const facts = beatId === undefined ? undefined : beatFacts(score, beatId);
  if (beatId !== undefined && facts) {
    if (anchor.kind === 'note') {
      return adopted(
        'score.note',
        { kind: 'note', note: anchor.id, beat: beatId, ...facts },
        score,
        facts.masterBar,
        facts.track,
        'Note',
      );
    }
    return adopted(
      'score.beat',
      { kind: 'beat', beat: beatId, ...facts },
      score,
      facts.masterBar,
      facts.track,
      'Beat',
    );
  }
  if (barId === undefined) return paper();
  return adopted(
    'score.bar',
    { kind: 'bar', masterBar: barId, track: anchor.track },
    score,
    barId,
    anchor.track,
    'Bar',
  );
}

/**
 * What the keyboard's context-menu key opens on the score: the selected bars, else the bar the
 * playhead or the last click is in. `clientRect` puts a layout box in client px for the menu's
 * anchor.
 */
export function scoreKeyboardRequest(
  services: MenuServices,
  layout: LayoutResult,
  clientRect: (rect: Rect) => DOMRect,
  mode: MenuMode,
): MenuRequest | undefined {
  if (mode !== 'play') return undefined;
  const { score } = services.document.getState();
  if (!score) return paper().request;
  const { bars, barsAnchor, currentTrack } = services.selection.getState();
  const box = (range: BarRange) => {
    const [first] = barColumns(layout, score, range);
    return first && clientRect(anchorBox(layout, first));
  };
  if (bars) {
    const anchor = box(bars);
    return {
      surface: 'score.range',
      target: { kind: 'range' },
      label: barsLabel(score, bars),
      ...(anchor && { anchor }),
    };
  }
  const bar = barsAnchor ?? playheadBar(services) ?? score.masterBars[0]?.id;
  if (bar === undefined) return paper().request;
  const anchor = box({ startBar: bar, endBar: bar });
  return {
    surface: 'score.bar',
    target: { kind: 'bar', masterBar: bar, track: currentTrack },
    label: barsLabel(score, { startBar: bar, endBar: bar }),
    ...(anchor && { anchor }),
  };
}

/**
 * Makes the right-clicked bar the selection, and its track the current one; never moves the
 * playhead or an active loop (the selection is marked without re-looping, so the bar the menu
 * acts on is always drawn).
 */
export function adoptMenuTarget(
  services: Pick<AppServices, 'selection'>,
  adopt: NonNullable<ScoreMenuOpen['adopt']>,
): void {
  const { selection } = services;
  selection.getState().selectBars(adopt.bars, adopt.bars.startBar, { reloop: false });
  if (adopt.track !== undefined) selection.getState().setCurrentTrack(adopt.track);
}
