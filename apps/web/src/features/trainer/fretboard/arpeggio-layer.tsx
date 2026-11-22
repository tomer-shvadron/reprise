import { XIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useStore } from 'zustand';

import { CommandTooltip } from '@/app/command-tooltip';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';

import type { ScaleId } from '@/lib/insights';

import {
  arpeggioDots,
  arpeggioLabel,
  arpeggioOf,
  type Arpeggio,
  type ArpeggioDot,
} from './arpeggio-dots';
import type { ArpeggioOverlayStore, ShownChord } from './arpeggio-overlay';
import type { BoardShape } from './fretboard-model';
import type { Geometry } from './fretboard-geometry';
import { DOT_RADIUS, RING_GAP } from './layer-metrics';
import type { ScaleOverlay } from './scale-overlay';

/** The chip's words for what the overlay shows, `Arpeggio: Am7 · inferred`. */
export function chipText(shown: ShownChord): string {
  switch (shown.kind) {
    case 'chord':
      return shown.source === 'written'
        ? `Arpeggio: ${shown.name}`
        : `Arpeggio: ${shown.name} · ${shown.source}`;
    case 'finding':
      return 'Arpeggio: finding chords…';
    case 'none-here':
      return 'Arpeggio: no chord here';
    case 'unavailable':
      return 'Arpeggio: chords unavailable';
    case 'no-chords':
      return 'Arpeggio: no chords in this song';
    case 'pick':
      return 'Arpeggio: pick a chord';
  }
}

/**
 * The chip beside the scale chip. It subscribes to the store itself, so a chord change redraws
 * only it and the layer, never the board, the scale layer or the header.
 */
export function ArpeggioChip({
  store,
  triggerRef,
}: {
  store: ArpeggioOverlayStore;
  triggerRef: { current: HTMLButtonElement | null };
}) {
  const on = useStore(store, (state) => state.on);
  const shown = useStore(store, (state) => state.shown);
  const clear = useCommand('trainer.fretboardArpeggio');
  if (!on) return null;
  const text =
    shown.kind === 'chord' && arpeggioOf(shown.name) === undefined
      ? `Arpeggio: ${shown.name} not recognised`
      : chipText(shown);
  return (
    <span
      data-arpeggio-chip
      className="bg-muted text-foreground flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2"
    >
      {text}
      <CommandTooltip command="trainer.fretboardArpeggio" label="Hide the arpeggio">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide the arpeggio"
          onClick={() => {
            clear.run();
            // The chip is about to unmount with the focus on it.
            triggerRef.current?.focus();
          }}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </CommandTooltip>
    </span>
  );
}

const placements = new WeakMap<readonly number[], Map<string, ArpeggioDot[]>>();

/** A song reuses a handful of chords: each is placed once per neck and scale. */
function placedDots(
  board: BoardShape,
  tuning: readonly number[],
  name: string,
  arpeggio: Arpeggio,
  scale: { tonic: number; scaleId: ScaleId } | undefined,
): ArpeggioDot[] {
  let byKey = placements.get(tuning);
  if (!byKey) {
    byKey = new Map();
    placements.set(tuning, byKey);
  }
  const key = [
    name,
    board.strings,
    board.frets,
    board.capo,
    board.drone?.string,
    board.drone?.fret,
    scale?.tonic,
    scale?.scaleId,
  ].join('|');
  let dots = byKey.get(key);
  if (!dots) {
    dots = arpeggioDots(board, tuning, arpeggio, scale);
    byKey.set(key, dots);
  }
  return dots;
}

/** A long gap: at the board's real size (about two thirds of its viewBox) a short one reads as solid. */
const OUTSIDE_DASH = '3 4';

const TONE = 'var(--color-arpeggio)';

/**
 * The chord's tones as tinted rings on the scale ring's radius, over the scale layer and under
 * the lit notes. Each ring first covers what is under it with the dock's surface colour, so the
 * scale's note name never shows through. A tone outside the scale is dashed as well as tinted.
 * It draws only while on and showing a chord, and subscribes to the store itself.
 */
export const ArpeggioLayer = memo(function ArpeggioLayer({
  store,
  board,
  tuning,
  geometry,
  scale,
}: {
  store: ArpeggioOverlayStore;
  board: BoardShape;
  tuning: readonly number[];
  geometry: Geometry;
  scale: Pick<ScaleOverlay, 'tonic' | 'scaleId'> | undefined;
}) {
  const on = useStore(store, (state) => state.on);
  const shown = useStore(store, (state) => state.shown);
  const labels = useStore(store, (state) => state.labels);
  const name = shown.kind === 'chord' ? shown.name : undefined;
  const tonic = scale?.tonic;
  const scaleId = scale?.scaleId;
  const placed = useMemo(() => {
    if (!name) return undefined;
    const arpeggio = arpeggioOf(name);
    if (!arpeggio) return undefined;
    const scaleSpec = tonic !== undefined && scaleId !== undefined ? { tonic, scaleId } : undefined;
    return { arpeggio, dots: placedDots(board, tuning, name, arpeggio, scaleSpec) };
  }, [name, board, tuning, tonic, scaleId]);
  if (!on || !placed) return null;
  return (
    <g
      data-fretboard-arpeggio={name}
      role="img"
      aria-label={arpeggioLabel(placed.arpeggio)}
      style={{ color: TONE }}
    >
      {placed.dots.map((dot) => {
        const x = geometry.dotX(dot.absolute);
        const y = geometry.stringY(dot.string);
        return (
          <g key={`${String(dot.string)}.${String(dot.absolute)}`} data-arpeggio-tone={dot.degree}>
            <circle cx={x} cy={y} r={DOT_RADIUS + RING_GAP} fill="var(--color-sidebar)" />
            <circle
              cx={x}
              cy={y}
              r={DOT_RADIUS + RING_GAP}
              fill="currentColor"
              fillOpacity={dot.root ? 0.45 : 0.22}
              stroke="currentColor"
              strokeWidth={dot.root ? 3 : 2}
              strokeDasharray={dot.outsideScale ? OUTSIDE_DASH : undefined}
              data-arpeggio-root={dot.root ? '' : undefined}
              data-outside-scale={dot.outsideScale ? '' : undefined}
            />
            <text
              x={x}
              y={y + 3.5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={dot.root ? 700 : 500}
              fill="var(--color-foreground, currentColor)"
              aria-hidden="true"
            >
              {labels === 'degree' ? dot.degree : dot.name}
            </text>
          </g>
        );
      })}
    </g>
  );
});
