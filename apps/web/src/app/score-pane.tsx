import { loopRange, type TickRange } from '@reprise/audio';
import { PAGE_SIZES, type LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { LocateFixedIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  barColumns,
  createGestureTracker,
  pointerTarget,
  ScoreView,
  type ScoreOverlays,
  type ScorePointerEvent,
  type ScrollAxis,
  type ScoreViewHandle,
} from '@/features/score';
import { orderedRange } from '@/features/transport/bar-range';
import { loopBarNumbers } from '@/features/transport/loop';
import { seekTick } from '@/features/transport/seek';
import { playheadBar, playheadTick, seekTo } from '@/features/transport/seek-commands';
import { selectRunning } from '@/state/playback';
import type { BarRange } from '@/state/selection';
import { timelineOf } from '@/state/timeline';

import { startPlayhead, type PlayheadDriver } from './playhead-driver';
import type { AppServices } from './services';
import { useAppServices } from './services-context';

function EmptyPaper({ children }: { children: ReactNode }) {
  const { ui } = useAppServices();
  const { zoom, paper } = useStore(
    ui,
    useShallow((state) => ({ zoom: state.zoom, paper: state.view.paper })),
  );
  const size = PAGE_SIZES[paper];
  return (
    <div className="h-full overflow-auto">
      <div className="w-max min-w-full p-8">
        <div
          className="bg-paper text-ink mx-auto p-12 shadow-md"
          style={{ width: size.width * zoom, minHeight: size.height * zoom }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A click seeks; Shift+click selects from the anchor (or the playhead's bar) without seeking.
 * A click outside an active loop turns the loop off first.
 */
function clickBar(
  services: AppServices,
  result: LayoutResult,
  score: Score,
  event: ScorePointerEvent,
  shift: boolean,
): void {
  const { audio, playback, selection, transport } = services;
  const target = pointerTarget(result, score, event);
  if (!target) return;
  if (shift) {
    const from = selection.getState().barsAnchor ?? playheadBar(services) ?? target.masterBarId;
    const range = orderedRange(score, from, target.masterBarId);
    if (range) selection.getState().selectBars(range, from);
    return;
  }
  if (target.track !== undefined) selection.getState().setCurrentTrack(target.track);
  selection.getState().selectBars(undefined, target.masterBarId);

  const timeline = timelineOf(score);
  const at = playheadTick(services);
  const { loop } = playback.getState().settings;
  let inLoop: TickRange | undefined;
  const bars = loop && loopBarNumbers(score, loop);
  if (loop && bars) {
    const number = target.masterBarIndex + 1;
    if (number < bars.start || number > bars.end) {
      audio.setLoop(undefined);
    } else {
      try {
        inLoop = loopRange(timeline, loop, at);
      } catch {
        inLoop = undefined;
      }
    }
  }
  const tick = seekTick(timeline, target, at, inLoop);
  if (tick === undefined) {
    transport.getState().announce(`Bar ${String(target.masterBarIndex + 1)} is not played`);
    return;
  }
  seekTo(services, tick);
}

function FollowButton() {
  const { playback, ui } = useAppServices();
  const running = useStore(playback, selectRunning);
  const following = useStore(ui, (state) => state.follow.on);
  if (!running || following) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="absolute right-4 bottom-4 shadow-md"
      onClick={() => {
        ui.getState().requestFollow();
      }}
    >
      <LocateFixedIcon aria-hidden="true" />
      Follow playback
    </Button>
  );
}

function PlayingScore({ result, label }: { result: LayoutResult; label: string }) {
  const services = useAppServices();
  const { document, playback, selection, ui } = services;
  const score = useStore(document, (state) => state.score);
  const zoom = useStore(ui, (state) => state.zoom);
  const mode = useStore(ui, (state) => state.view.mode);
  const bars = useStore(selection, (state) => state.bars);
  const loop = useStore(playback, (state) => state.settings.loop);
  const [preview, setPreview] = useState<BarRange>();
  const [gestures] = useState(createGestureTracker);
  const handle = useRef<ScoreViewHandle>(null);
  const driver = useRef<PlayheadDriver>(undefined);

  useEffect(() => {
    const started = startPlayhead({ services, view: () => handle.current });
    driver.current = started;
    return () => {
      started.stop();
      driver.current = undefined;
    };
  }, [services]);

  // After the view's own layout effects, so the new geometry is in place.
  useLayoutEffect(() => {
    driver.current?.repaint();
  }, [result, zoom, mode]);

  const overlays = useMemo((): ScoreOverlays => {
    if (!score) return {};
    const selected = preview ?? bars;
    return {
      ...(selected && { selection: barColumns(result, score, selected) }),
      ...(loop && { loop: barColumns(result, score, loop) }),
    };
  }, [result, score, preview, bars, loop]);

  const onScorePointer = (event: ScorePointerEvent) => {
    const gesture = gestures.handle(event);
    if (!gesture || !score) return;
    if (gesture.kind === 'cancel') {
      setPreview(undefined);
    } else if (gesture.kind === 'click') {
      clickBar(services, result, score, gesture.event, gesture.shift);
    } else {
      const range = orderedRange(score, gesture.from.id, gesture.to.id);
      if (!gesture.done) {
        setPreview(range);
        return;
      }
      setPreview(undefined);
      if (range) selection.getState().selectBars(range, gesture.from.id);
    }
  };

  const onUserScroll = (axis: ScrollAxis) => {
    if (axis === 'both' || axis === (mode === 'paged' ? 'y' : 'x')) ui.getState().pauseFollow();
  };

  return (
    <>
      <ScoreView
        ref={handle}
        layout={result}
        zoom={zoom}
        label={label}
        overlays={overlays}
        onScorePointer={onScorePointer}
        onUserScroll={onUserScroll}
        className="h-full focus-visible:-outline-offset-2"
      />
      <FollowButton />
    </>
  );
}

export function ScorePane({ hint }: { hint: ReactNode }) {
  const { document, layout } = useAppServices();
  const { result, error } = useStore(
    layout,
    useShallow((state) => ({ result: state.result, error: state.error })),
  );
  const { opening, title, fileName } = useStore(
    document,
    useShallow((state) => ({
      opening: state.opening,
      title: state.score?.meta.title,
      fileName: state.file?.name,
    })),
  );

  if (error !== undefined) {
    return (
      <EmptyPaper>
        <p role="alert">
          This score could not be drawn. <span className="text-ink-muted">{error}</span>
        </p>
      </EmptyPaper>
    );
  }
  if (!result) {
    return (
      <EmptyPaper>
        {opening === undefined ? hint : <p className="text-ink-muted">Opening {opening}…</p>}
      </EmptyPaper>
    );
  }
  const name = title?.trim() ? title : (fileName ?? 'Untitled');
  return <PlayingScore result={result} label={`Score: ${name}`} />;
}
