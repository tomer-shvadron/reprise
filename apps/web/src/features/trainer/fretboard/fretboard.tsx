import { XIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';

import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { CommandTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { selectRunning } from '@/state/playback';
import { startPositionReader } from '@/state/position-reader';

import {
  boardOf,
  createBeatIndex,
  dotLabel,
  fretMarker,
  signature,
  tuningNames,
  type BoardShape,
  type Dot,
} from './fretboard-model';
import { geometryOf, type Geometry } from './fretboard-geometry';
import { scaleDots, scaleLabel } from './scale-dots';
import { scaleOverlayFor, type ScaleOverlay } from './scale-overlay';
import { ScalePicker } from './scale-picker';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_RADIUS = 10;
/** A scale ring sits this far outside a lit dot, so a lit scale tone keeps its halo. */
const RING_GAP = 1.5;

/** The part that never changes during playback: strings, frets, markers and the capo. */
function StaticBoard({
  board,
  geometry,
  names,
}: {
  board: BoardShape;
  geometry: Geometry;
  names: readonly string[];
}) {
  const { lineX, stringY, wireTop: top, wireBottom: bottom, stringGap } = geometry;
  const strings = Array.from({ length: board.strings }, (_, index) => index + 1);
  const frets = Array.from({ length: board.frets }, (_, index) => index + 1);
  return (
    <g aria-hidden>
      {strings.map((string) => (
        <text
          key={`name-${String(string)}`}
          x={geometry.nameX}
          y={stringY(string) + 3.5}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.7}
        >
          {names[names.length - string]}
        </text>
      ))}
      {strings.map((string) => (
        <line
          key={string}
          x1={lineX(board.drone?.string === string ? board.drone.fret : 0)}
          x2={lineX(board.frets)}
          y1={stringY(string)}
          y2={stringY(string)}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1 + (string - 1) * 0.15}
        />
      ))}
      <line
        x1={lineX(0)}
        x2={lineX(0)}
        y1={top}
        y2={bottom}
        stroke="currentColor"
        strokeWidth={4}
      />
      {frets.map((fret) => (
        <g key={fret}>
          <line
            x1={lineX(fret)}
            x2={lineX(fret)}
            y1={top}
            y2={bottom}
            stroke="currentColor"
            strokeOpacity={0.35}
          />
          {fretMarker(fret) > 0 && (
            <circle
              cx={geometry.dotX(fret)}
              cy={(top + bottom) / 2 + (fretMarker(fret) === 2 ? -stringGap : 0)}
              r={3}
              fill="currentColor"
              fillOpacity={0.25}
            />
          )}
          {fretMarker(fret) === 2 && (
            <circle
              cx={geometry.dotX(fret)}
              cy={(top + bottom) / 2 + stringGap}
              r={3}
              fill="currentColor"
              fillOpacity={0.25}
            />
          )}
          <text
            x={geometry.dotX(fret)}
            y={bottom + 14}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.55}
          >
            {fret}
          </text>
        </g>
      ))}
      {board.capo > 0 && (
        <rect
          data-capo
          x={Math.min(lineX(board.capo), lineX(board.capo - 1)) + 2}
          y={top}
          width={Math.abs(lineX(board.capo) - lineX(board.capo - 1)) - 4}
          height={bottom - top}
          rx={4}
          fill="currentColor"
          fillOpacity={0.18}
        />
      )}
    </g>
  );
}

/**
 * The scale's tones as hollow tinted rings under the lit notes, so a played note stays on top.
 * The tonic has a heavier ring and a tint. Drawn once per board, geometry and scale, so a
 * playback tick never touches it.
 */
const ScaleLayer = memo(function ScaleLayer({
  board,
  tuning,
  geometry,
  overlay,
}: {
  board: BoardShape;
  tuning: readonly number[];
  geometry: Geometry;
  overlay: ScaleOverlay;
}) {
  const dots = useMemo(() => scaleDots(board, tuning, overlay), [board, tuning, overlay]);
  return (
    <g data-fretboard-scale role="img" aria-label={scaleLabel(overlay)} className="text-primary">
      {dots.map((dot) => {
        const x = geometry.dotX(dot.absolute);
        const y = geometry.stringY(dot.string);
        return (
          <g key={`${String(dot.string)}.${String(dot.absolute)}`} data-scale-tone={dot.degree}>
            <circle
              cx={x}
              cy={y}
              r={DOT_RADIUS + RING_GAP}
              fill="currentColor"
              fillOpacity={dot.tonic ? 0.35 : 0.12}
              stroke="currentColor"
              strokeWidth={dot.tonic ? 2.5 : 1}
              strokeOpacity={dot.tonic ? 1 : 0.7}
              data-scale-tonic={dot.tonic ? '' : undefined}
            />
            <text
              x={x}
              y={y + 3.5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={dot.tonic ? 700 : 500}
              fill="var(--color-foreground, currentColor)"
              aria-hidden="true"
            >
              {dot.name}
            </text>
          </g>
        );
      })}
    </g>
  );
});

/** Replaces the lit dots' elements; the board and everything else is left alone. */
function paintDots(layer: SVGGElement, dots: readonly Dot[], geometry: Geometry) {
  const doc = layer.ownerDocument;
  layer.replaceChildren(
    ...dots.map((dot) => {
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'img');
      group.setAttribute('aria-label', dotLabel(dot));
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(geometry.dotX(dot.absolute)));
      circle.setAttribute('cy', String(geometry.stringY(dot.string)));
      circle.setAttribute('r', String(DOT_RADIUS));
      circle.setAttribute('fill', 'var(--color-primary, #2563eb)');
      const label = doc.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(geometry.dotX(dot.absolute)));
      label.setAttribute('y', String(geometry.stringY(dot.string) + 3.5));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', 'var(--color-primary-foreground, #fff)');
      label.setAttribute('aria-hidden', 'true');
      label.textContent = dot.name;
      group.append(circle, label);
      return group;
    }),
  );
}

/**
 * The current track's neck with the notes of the beat being heard lit and named. In edit mode,
 * while the transport is stopped, the beat under the edit cursor is lit instead. The board is
 * drawn once per track and handedness; a playback tick only swaps the few lit dots, from the
 * position reader and outside React, and only when the lit set changes. Nothing is a live
 * region, so the changing highlights are not announced.
 */
export function Fretboard() {
  const services = useAppServices();
  const { document, selection, playback, editing, heard } = services;
  const score = useStore(document, (state) => state.score);
  const currentTrack = useStore(selection, (state) => state.currentTrack);
  const { ui } = services;
  const leftHanded = useStore(ui, (state) => state.fretboardLeftHanded);
  const menu = useStaticContextMenu({
    surface: 'fretboard',
    target: { kind: 'dock', view: 'fretboard' },
    label: 'Fretboard',
  });

  const track = useMemo(
    () => score?.tracks.find((candidate) => candidate.id === currentTrack) ?? score?.tracks[0],
    [score, currentTrack],
  );
  const board = boardOf(track);
  const index = useMemo(
    () => (score && track && board ? createBeatIndex(track, score.masterBars) : undefined),
    // `board` is derived from `track`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [score, track],
  );
  const geometry = useMemo(
    () => (board ? geometryOf(board, leftHanded) : undefined),
    // The shape is read through its parts so an unrelated score edit keeps the same board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board?.strings, board?.frets, board?.capo, leftHanded],
  );
  // The shape is read through its parts, like the geometry, so an unrelated edit keeps the layer.
  const stableBoard = useMemo(
    () => board,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board?.strings, board?.frets, board?.capo, board?.drone?.string, board?.drone?.fret],
  );
  const tuning = track?.tuning;
  const names = useMemo(() => (tuning ? tuningNames({ tuning }) : []), [tuning]);
  const layer = useRef<SVGGElement>(null);
  const scales = scaleOverlayFor(services);
  const overlay = useStore(scales, (state) => state.overlay);
  const clearScale = useCommand('trainer.fretboardClearScale');
  const scaleTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = layer.current;
    if (!target || !index || !geometry) return;
    let shown: string | undefined;
    let lastEvent = playback.getState().position;
    const show = (dots: readonly Dot[]) => {
      const key = signature(dots);
      if (key === shown) return;
      shown = key;
      paintDots(target, dots, geometry);
    };
    const update = () => {
      const state = playback.getState();
      const { cursor } = selection.getState();
      if (
        cursor &&
        editing.getState().editing &&
        !selectRunning(state) &&
        cursor.track === track?.id
      ) {
        show(index.dotsOfBeat(cursor.masterBar, cursor.beat));
        return;
      }
      // While running, the drawn playhead's position, which already allows for the output
      // latency; otherwise the engine's, which a seek or a stop has just moved.
      const at = selectRunning(state) ? heard.current : undefined;
      if (at) show(index.dotsAt(at.masterBarId, at.tick));
      else if (lastEvent) show(index.dotsAt(lastEvent.masterBarId, lastEvent.position.tick));
      else show([]);
    };
    const reader = startPositionReader(playback, (event) => {
      lastEvent = event;
      update();
    });
    const unsubscribers = [
      selection.subscribe((state, previous) => {
        if (state.cursor !== previous.cursor) update();
      }),
      editing.subscribe((state, previous) => {
        if (state.editing !== previous.editing) update();
      }),
    ];
    update();
    return () => {
      reader.stop();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [index, geometry, playback, selection, editing, heard, track?.id]);

  const title = track && board ? `${track.name} fretboard` : 'Fretboard';
  if (!track || !board || !geometry) {
    return (
      <div
        {...menu}
        data-fretboard-empty
        className="text-muted-foreground flex h-full items-center justify-center p-4 text-sm"
      >
        No fretted track selected. Pick a guitar or bass track to see its fretboard.
      </div>
    );
  }

  return (
    <div {...menu} className="flex h-full flex-col gap-1 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {board.strings} strings, tuning {names.join(' ')}
          {board.capo > 0 ? `, capo ${String(board.capo)}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {overlay && (
            <span
              data-scale-chip
              className="bg-muted text-foreground flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2"
            >
              {overlay.none ? 'Song scale: none found' : `Scale: ${overlay.label}`}
              <CommandTooltip command="trainer.fretboardClearScale" label="Hide the scale">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Hide the scale"
                  onClick={() => {
                    clearScale.run();
                    // The chip is about to unmount with the focus on it.
                    scaleTrigger.current?.focus();
                  }}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </CommandTooltip>
            </span>
          )}
          <ScalePicker store={scales} triggerRef={scaleTrigger} />
        </div>
        <label className="flex items-center gap-2">
          Left-handed
          <Switch
            size="sm"
            checked={leftHanded}
            onCheckedChange={(checked) => {
              ui.getState().setFretboardLeftHanded(checked);
            }}
          />
        </label>
      </div>
      <svg
        role="group"
        aria-label={title}
        viewBox={`0 0 ${String(geometry.width)} ${String(geometry.height)}`}
        className="text-foreground min-h-0 w-full flex-1"
        preserveAspectRatio="xMidYMid meet"
        data-fretboard
        data-left-handed={leftHanded}
      >
        <StaticBoard board={board} geometry={geometry} names={names} />
        {overlay && !overlay.none && tuning && stableBoard && (
          <ScaleLayer board={stableBoard} tuning={tuning} geometry={geometry} overlay={overlay} />
        )}
        <g ref={layer} data-fretboard-notes />
      </svg>
    </div>
  );
}
