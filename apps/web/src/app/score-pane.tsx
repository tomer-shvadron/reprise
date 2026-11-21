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
import { playheadBar, seekToBar } from '@/features/transport';
import {
  adoptEditMenuTarget,
  adoptMenuTarget,
  cursorTick,
  createEditPointer,
  scoreKeyboardRequest,
  scoreMenuRequest,
  caretRect,
  useEditOverlays,
  WordField,
} from '@/features/editor';
import { FOLLOW_PLAYHEAD_SETTING } from '@/state/app-settings';
import { selectRunning } from '@/state/playback';
import { selectScoreZoom } from '@/state/ui';
import type { BarRange } from '@/state/selection';

import { PRACTICE_CAPSULE_CLEARANCE } from './practice-mode/clearance';
import { SelectionPill } from './selection-pill';
import { useBodyContextMenuFallback } from './context-menu/body-fallback';
import { useContextMenu, useStaticContextMenu } from './context-menu/use-context-menu';
import { detectKeyboardPlatform } from './keyboard';
import { startPlayhead, type PlayheadDriver } from './playhead-driver';
import type { AppServices } from './services';
import { useAppServices } from './services-context';
import { useSetting } from './use-setting';

function EmptyPaper({ children }: { children: ReactNode }) {
  const { ui } = useAppServices();
  const { zoom, paper } = useStore(
    ui,
    useShallow((state) => ({ zoom: selectScoreZoom(state), paper: state.view.paper })),
  );
  const size = PAGE_SIZES[paper];
  // The empty paper has a menu too: a way to open a song, before there is a score to act on.
  const menu = useStaticContextMenu({
    surface: 'score.paper',
    target: { kind: 'paper' },
    label: 'Score',
  });
  return (
    <div className="h-full overflow-auto" data-score-surface="" {...menu}>
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
  const { selection } = services;
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
  seekToBar(services, score, target);
}

function FollowButton() {
  const { playback, ui } = useAppServices();
  const running = useStore(playback, selectRunning);
  const following = useStore(ui, (state) => state.follow.on);
  const practising = useStore(ui, (state) => state.practiceMode.on);
  const followSetting = useSetting(FOLLOW_PLAYHEAD_SETTING);
  // With the setting off nothing follows, so while playing the button always offers a jump to the
  // playhead (one scroll); it is the only on-screen way back.
  if (!running || (following && followSetting)) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      // The practice capsule floats at the bottom; the button sits above it.
      className="absolute right-4 shadow-md"
      style={{ bottom: practising ? PRACTICE_CAPSULE_CLEARANCE : 16 }}
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
  const zoom = useStore(ui, selectScoreZoom);
  const practising = useStore(ui, (state) => state.practiceMode.on);
  const mode = useStore(ui, (state) => state.view.mode);
  const bars = useStore(selection, (state) => state.bars);
  const range = useStore(selection, (state) => state.range);
  const cursor = useStore(selection, (state) => state.cursor);
  const editing = useStore(services.editing, (state) => state.editing);
  const edit = useEditOverlays();
  const loop = useStore(playback, (state) => state.settings.loop);
  const [preview, setPreview] = useState<BarRange>();
  // An edit-mode drag over the score (a range being drawn) is unfinished.
  const [areaDragging, setAreaDragging] = useState(false);
  // On a Mac a Ctrl+click is a context click, in both modes: it opens the menu and neither seeks
  // nor selects. There only Cmd toggles a picked note.
  const [gestures] = useState(() =>
    createGestureTracker({ ctrlIsContextClick: () => detectKeyboardPlatform() === 'mac' }),
  );
  const editPointer = useMemo(
    () => createEditPointer({ selection, document }),
    [selection, document],
  );
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
    // A range draws its own boxes, which also cover a bars range, so its columns are not drawn too.
    // A column drag's preview always shows, over a range left from edit mode too.
    const selected = preview ?? (range ? undefined : bars);
    return {
      ...(selected && { selection: barColumns(result, score, selected) }),
      ...(loop && { loop: barColumns(result, score, loop) }),
      ...(edit.caret && { caret: edit.caret }),
      ...(edit.range && !preview && { range: edit.range }),
    };
  }, [result, score, preview, bars, range, loop, edit]);

  // The caret scrolls into view after each cursor move, not after a range or layout change.
  useEffect(() => {
    const rect = editing && edit.caret && caretRect(edit.caret);
    if (rect) handle.current?.revealRect(rect);
    // Keyed on the cursor on purpose: `edit` changes with the layout too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, editing]);

  const onScorePointer = (event: ScorePointerEvent) => {
    const gesture = gestures.handle(event, editing ? 'area' : 'columns');
    if (!gesture || !score) return;
    if (editing) {
      setAreaDragging(gesture.kind === 'area' && !gesture.done);
      const placed = editPointer(result, gesture);
      // Only a plain click also moves a stopped playhead to the cursor, so Play starts there; a
      // Shift or Cmd/Ctrl click, a drag and the keys leave it, and a click never ends a loop.
      const moved = selection.getState().cursor;
      const { shiftKey, metaKey, ctrlKey } = gesture.kind === 'click' ? gesture.event.event : {};
      const plain = gesture.kind === 'click' && !shiftKey && !metaKey && !ctrlKey;
      if (placed && plain && moved) {
        const tick = cursorTick(score, moved);
        if (tick !== undefined && !selectRunning(playback.getState())) {
          seekToBar(services, score, { masterBarIndex: moved.at.bar, tick }, true);
        }
      }
      return;
    }
    if (gesture.kind === 'cancel') {
      setPreview(undefined);
    } else if (gesture.kind === 'click') {
      clickBar(services, result, score, gesture.event, gesture.shift);
    } else if (gesture.kind === 'drag') {
      const range = orderedRange(score, gesture.from.id, gesture.to.id);
      if (!gesture.done) {
        setPreview(range);
        return;
      }
      setPreview(undefined);
      if (range) selection.getState().selectBars(range, gesture.from.id);
    }
  };

  const menuMode = editing ? 'edit' : 'play';
  const menu = useContextMenu((via, event) => {
    const view = handle.current;
    if (!view) return undefined;
    if (via === 'keyboard') {
      return scoreKeyboardRequest(services, result, (rect) => view.clientRect(rect), menuMode);
    }
    const open = scoreMenuRequest(view.hitAt(event.clientX, event.clientY), services, menuMode);
    // A right-click selects what it opened on, as a click would, but never seeks or moves a loop.
    if (open?.adopt) adoptMenuTarget(services, open.adopt);
    if (open) adoptEditMenuTarget(services, open, (hit) => editPointer.placeAt(result, hit));
    return open?.request;
  });

  const onUserScroll = (axis: ScrollAxis) => {
    if (axis === 'both' || axis === (mode === 'paged' ? 'y' : 'x')) ui.getState().pauseFollow();
  };

  // The edit status lives in the status bar, so entering edit mode adds no row under the score.
  return (
    <div className="relative h-full">
      <ScoreView
        ref={handle}
        layout={result}
        zoom={zoom}
        bottomInset={practising ? PRACTICE_CAPSULE_CLEARANCE : 0}
        label={label}
        overlays={overlays}
        onScorePointer={onScorePointer}
        onContextMenu={menu.onContextMenu}
        onUserScroll={onUserScroll}
        className="h-full focus-visible:-outline-offset-2"
      >
        <WordField />
        <SelectionPill
          view={handle}
          layout={result}
          zoom={zoom}
          dragging={preview !== undefined || areaDragging}
          edit={edit}
        />
      </ScoreView>
      <FollowButton />
    </div>
  );
}

export function ScorePane({ hint }: { hint: ReactNode }) {
  const { document, layout } = useAppServices();
  useBodyContextMenuFallback();
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
