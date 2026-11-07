import { hitTest, type Anchor, type LayoutResult, type Rect } from '@reprise/layout';
import type { Id } from '@reprise/model';
import {
  startTransition,
  useCallback,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type UIEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import { cn } from '@/lib/utils';

import { describeLayout, type PlaybackCursor } from './anchors';
import { useScoreFonts } from './fonts';
import { FOLLOW_MARGIN, followBand, glide, pageTurn } from './follow';
import { OverlayLayer, type ScoreOverlays } from './overlay-layer';
import { pageFlow, toLayoutY, toViewRect, type PageFlow } from './page-flow';
import { nearestColumn, staffBand } from './playhead';
import { PlayheadLayer } from './playhead-layer';
import { ScorePage } from './score-page';
import {
  canvasOffset,
  centreFromScroll,
  clampScroll,
  contentSize,
  layoutExtent,
  mountedPages,
  mountedSystems,
  revealAxis,
  revealScroll,
  scrollFromCentre,
  toLayoutPoint,
  visibleWindow,
  type Point,
} from './viewport';

import './score.css';

export interface ScorePointerEvent {
  /** `cancel` ends a drag with no `up`: the OS or a touchpad gesture took the pointer. */
  type: 'down' | 'move' | 'up' | 'leave' | 'cancel';
  /** In layout px. */
  point: Point;
  /** What `hitTest` finds at the point; always undefined on `leave` and `cancel`. */
  anchor: Anchor | undefined;
  /**
   * The master-bar column at or nearest the point on the page under it, so a click between
   * systems or in a margin still names a bar; undefined on `leave` and `cancel`.
   */
  column: Anchor | undefined;
  /** The native event, for buttons and modifiers. */
  event: PointerEvent;
}

export interface ScoreViewHandle {
  /**
   * Scrolls the least distance that shows `rect` (layout px) with `margin`; no-op when it shows.
   * `system` is the rect's system index, which places a rect inside a system taller than its page.
   */
  revealRect(
    rect: Rect,
    options?: { margin?: number; behavior?: 'auto' | 'smooth'; system?: number },
  ): void;
  /** The visible window in layout px, from the live scroll position, on the page at its centre. */
  viewport(): Rect;
  /** Moves the playhead by writing its styles: no React state, no render. Undefined hides it. */
  setPlayhead(cursor: PlaybackCursor | undefined): void;
  /** Scrolls to keep the playhead in view by `policy`; see the feature README. */
  followPlayhead(policy: FollowPolicy): void;
}

export interface FollowPolicy {
  mode: 'paged' | 'continuous';
  /** Running follows every frame; otherwise the call is a request to reveal the playhead. */
  running: boolean;
  /** The followed track, whose staves stay in view when a system is taller than the window. */
  track?: Id | undefined;
  /** Re-evaluates a page turn even within the same system. */
  force?: boolean;
}

export type ScrollAxis = 'x' | 'y' | 'both';

export interface ScoreViewProps {
  layout: LayoutResult;
  /** Display scale, the ui store's zoom; never re-lays out. */
  zoom: number;
  overlays?: ScoreOverlays;
  onScorePointer?: (event: ScorePointerEvent) => void;
  /**
   * A hand scroll, told from input rather than `scroll` events, which following and zoom also
   * fire: the wheel, a scrollbar press, touch, and a scrolling key no command took.
   */
  onUserScroll?: (axis: ScrollAxis) => void;
  /** The score region's accessible name. */
  label?: string;
  className?: string;
  ref?: Ref<ScoreViewHandle>;
}

const DEFAULT_REVEAL_MARGIN = 24;
const CURSOR_WIDTH = 2;
/** Longer than any smooth scroll the browser runs; a turn not done by then was interrupted. */
const TURN_TIMEOUT = 1000;

const KEY_AXES: Readonly<Record<string, ScrollAxis>> = {
  ArrowLeft: 'x',
  ArrowRight: 'x',
  ArrowUp: 'y',
  ArrowDown: 'y',
  PageUp: 'y',
  PageDown: 'y',
  Home: 'y',
  End: 'y',
  ' ': 'y',
};

const noop = () => undefined;

function useClientSize(element: HTMLElement | null): { width: number; height: number } {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!element) return noop;
      const observer = new ResizeObserver(onChange);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    [element],
  );
  const width = useSyncExternalStore(subscribe, () => element?.clientWidth ?? 0);
  const height = useSyncExternalStore(subscribe, () => element?.clientHeight ?? 0);
  return useMemo(() => ({ width, height }), [width, height]);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function readScroll(target: HTMLElement): Point {
  return { x: target.scrollLeft, y: target.scrollTop };
}

/** Places the playhead's boxes by writing their styles; React never renders them again. */
function paintPlayhead(
  bar: HTMLElement | null,
  line: HTMLElement | null,
  cursor: PlaybackCursor | undefined,
  { zoom, flow, layout }: { zoom: number; flow: PageFlow; layout: LayoutResult },
): void {
  if (!bar || !line) return;
  if (!cursor) {
    bar.style.display = 'none';
    line.style.display = 'none';
    delete line.dataset['masterBar'];
    return;
  }
  const rect = toViewRect(flow, layout, cursor.bar.bbox, cursor.bar.system);
  const top = `${String(rect.y * zoom)}px`;
  const height = `${String(rect.height * zoom)}px`;
  bar.style.transform = `translate(${String(rect.x * zoom)}px, ${top})`;
  bar.style.width = `${String(rect.width * zoom)}px`;
  bar.style.height = height;
  line.style.transform = `translate(${String(cursor.x * zoom - CURSOR_WIDTH / 2)}px, ${top})`;
  line.style.height = height;
  line.dataset['masterBar'] = cursor.bar.id;
  bar.style.display = 'block';
  line.style.display = 'block';
}

/**
 * The scrolling score: paper for the pages in view or holding a mounted system, and SVG only for
 * the systems in view plus one either side. Pointer input is resolved from layout geometry on
 * the canvas alone.
 */
export function ScoreView({
  layout,
  zoom,
  overlays,
  onScorePointer,
  onUserScroll,
  label = 'Score',
  className,
  ref,
}: ScoreViewProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    setElement(node);
  }, []);
  const viewport = useClientSize(element);
  const [scrolledCentre, setCentre] = useState<Point>();
  /** The centre at the last scroll event; the state above lags it until the mounted set changes. */
  const liveCentre = useRef<Point | undefined>(undefined);
  const fontsReady = useScoreFonts();
  const descriptionId = useId();
  const barBox = useRef<HTMLDivElement | null>(null);
  const lineBox = useRef<HTMLDivElement | null>(null);
  const playhead = useRef<PlaybackCursor | undefined>(undefined);
  const followed = useRef<{
    system?: number;
    time?: number | undefined;
    x?: number;
    /** A smooth page turn in flight: where it is going, and when to stop waiting for it. */
    turn?: { x: number; y: number; until: number } | undefined;
  }>({});

  // Everything on screen is placed in the flow's view px; the public API speaks layout px.
  const flow = useMemo(() => pageFlow(layout), [layout]);
  const extent = useMemo(() => layoutExtent(flow), [flow]);
  const offset = canvasOffset(viewport, extent, zoom);
  const size = contentSize(offset, extent, zoom);
  // The browser clamps the scroll position, so a centre it cannot reach at this zoom moves too.
  const centre =
    scrolledCentre &&
    centreFromScroll(
      clampScroll(scrollFromCentre(scrolledCentre, viewport, zoom, offset), size, viewport),
      viewport,
      zoom,
      offset,
    );
  const visible = visibleWindow(centre, viewport, zoom, offset);
  const range = mountedSystems(flow.systems, visible);
  const pages = mountedPages(flow.pages, flow.systems, range, visible);

  // The centre a transition has set and not yet committed, with the mounted set it makes.
  const pending = useRef<{ centre: Point; range: typeof range; pages: number[] } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    if (pending.current?.centre === scrolledCentre) pending.current = undefined;
  }, [scrolledCentre]);
  // Its mounted set was for the old geometry.
  useLayoutEffect(() => {
    pending.current = undefined;
  }, [zoom, viewport, flow]);

  // Rendering only when the mounted systems or pages change keeps following, which scrolls
  // every frame, from re-rendering the view every frame. The comparison is with the set the last
  // requested centre makes, so a scroll back before that commits still wins.
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = centreFromScroll(readScroll(event.currentTarget), viewport, zoom, offset);
    liveCentre.current = next;
    const window = visibleWindow(next, viewport, zoom, offset);
    const nextRange = mountedSystems(flow.systems, window);
    const nextPages = mountedPages(flow.pages, flow.systems, nextRange, window);
    const shown = pending.current ?? { range, pages };
    if (
      nextRange.start === shown.range.start &&
      nextRange.end === shown.range.end &&
      nextPages.length === shown.pages.length &&
      nextPages.every((page, index) => page === shown.pages[index])
    ) {
      return;
    }
    pending.current = { centre: next, range: nextRange, pages: nextPages };
    startTransition(() => {
      setCentre(next);
    });
  };

  // Zoom keeps the notation at the viewport centre where it was.
  const anchorZoom = useEffectEvent(() => {
    const target = scroller.current;
    const at = liveCentre.current ?? centre;
    if (!target || !at) return;
    const scroll = scrollFromCentre(at, viewport, zoom, offset);
    target.scrollLeft = scroll.x;
    target.scrollTop = scroll.y;
  });
  useLayoutEffect(() => {
    anchorZoom();
  }, [zoom]);

  useLayoutEffect(() => {
    paintPlayhead(barBox.current, lineBox.current, playhead.current, { zoom, flow, layout });
  }, [zoom, flow, layout]);
  useLayoutEffect(() => {
    followed.current = {};
  }, [layout]);

  useImperativeHandle(ref, () => {
    const live = (target: HTMLElement) =>
      visibleWindow(
        centreFromScroll(readScroll(target), viewport, zoom, offset),
        viewport,
        zoom,
        offset,
      );
    const toLayoutWindow = (window: Rect): Rect => {
      const centre = { x: window.x + window.width / 2, y: window.y + window.height / 2 };
      const { point } = toLayoutY(flow, centre);
      return { ...window, y: window.y - centre.y + point.y };
    };
    const scrollTo = (target: HTMLElement, origin: Point, smooth: boolean) => {
      const scroll = clampScroll(
        { x: origin.x * zoom + offset.x, y: origin.y * zoom + offset.y },
        size,
        viewport,
      );
      if (
        Math.abs(scroll.x - target.scrollLeft) < 0.5 &&
        Math.abs(scroll.y - target.scrollTop) < 0.5
      ) {
        return;
      }
      if (smooth) {
        target.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'smooth' });
      } else {
        target.scrollLeft = scroll.x;
        target.scrollTop = scroll.y;
      }
    };
    return {
      setPlayhead: (cursor) => {
        playhead.current = cursor;
        paintPlayhead(barBox.current, lineBox.current, cursor, { zoom, flow, layout });
      },
      followPlayhead: ({ mode, running, track, force = false }) => {
        const target = scroller.current;
        const cursor = playhead.current;
        if (!target || !cursor) return;
        const window = live(target);
        const reduced = prefersReducedMotion();
        const memory = followed.current;
        const bandOf = (index: number): Rect | undefined => {
          const system = flow.systems[index];
          if (!system) return undefined;
          const staves = track === undefined ? undefined : staffBand(layout, track, index);
          return followBand(
            system.bbox,
            staves && toViewRect(flow, layout, staves, index),
            window.height,
          );
        };
        const index = cursor.bar.system;
        let { x, y } = window;
        let smooth = false;
        if (mode === 'paged') {
          const current = bandOf(index);
          if (!current) return;
          const now = performance.now();
          const previous = memory.turn;
          const flying =
            previous && now < previous.until && Math.abs(previous.y - window.y) * zoom >= 1
              ? previous
              : undefined;
          memory.turn = undefined;
          if (!running) {
            y = revealAxis(window.y, window.height, current.y, current.height, FOLLOW_MARGIN);
            smooth = !reduced;
          } else if (force || memory.system !== index) {
            const turn = pageTurn(window, current, bandOf(index + 1));
            if (turn) {
              y = turn.y;
              smooth = !turn.instant && !reduced;
            }
          } else if (flying) {
            // An instant write now would cancel the turn; reveal from where the turn ends instead.
            x = revealAxis(flying.x, window.width, cursor.x, 0, FOLLOW_MARGIN);
            memory.turn = flying;
            if (Math.abs(x - flying.x) * zoom < 0.5) return;
            memory.turn = { ...flying, x };
            scrollTo(target, { x, y: flying.y }, true);
            return;
          }
          memory.system = index;
          x = revealAxis(window.x, window.width, cursor.x, 0, FOLLOW_MARGIN);
          if (smooth && running) memory.turn = { x, y, until: now + TURN_TIMEOUT };
        } else if (running) {
          const now = performance.now();
          const dt = memory.time === undefined ? 0 : now - memory.time;
          // The browser rounds scrollLeft, so the glide keeps its own x while nothing else moved it.
          const from =
            memory.x !== undefined && Math.abs(memory.x - window.x) * zoom < 1.5
              ? memory.x
              : window.x;
          x = glide(from, window.width, cursor.x, dt, reduced);
          memory.time = now;
          memory.x = x;
        } else {
          x = revealAxis(window.x, window.width, cursor.x, 0, FOLLOW_MARGIN);
          smooth = !reduced;
          memory.time = undefined;
        }
        scrollTo(target, { x, y }, smooth);
      },
      viewport: () => toLayoutWindow(scroller.current ? live(scroller.current) : visible),
      revealRect: (rect, options = {}) => {
        const target = scroller.current;
        if (!target) return;
        const current = live(target);
        const origin = revealScroll(
          current,
          toViewRect(flow, layout, rect, options.system),
          options.margin ?? DEFAULT_REVEAL_MARGIN,
        );
        if (!origin) return;
        const left = origin.x * zoom + offset.x;
        const top = origin.y * zoom + offset.y;
        if (options.behavior === 'smooth' && !prefersReducedMotion()) {
          target.scrollTo({ left, top, behavior: 'smooth' });
        } else {
          target.scrollLeft = left;
          target.scrollTop = top;
        }
      },
    };
  }, [viewport, zoom, offset, size, visible, flow, layout]);

  const pointer =
    (type: ScorePointerEvent['type']) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onScorePointer) return;
      const element = event.currentTarget;
      // A drag keeps its moves, and its release outside the canvas still arrives.
      if (
        type === 'down' &&
        event.button === 0 &&
        typeof element.setPointerCapture === 'function'
      ) {
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // An id the browser no longer tracks; the press still counts.
        }
      }
      const canvas = element.getBoundingClientRect();
      const { point, page } = toLayoutY(
        flow,
        toLayoutPoint(
          { x: event.clientX, y: event.clientY },
          { x: canvas.left, y: canvas.top },
          zoom,
        ),
      );
      // Only the page under the pointer: an overflowing system shares layout y with the next page.
      const onPage = page && {
        ...layout,
        systems: layout.systems.slice(page.systems.start, page.systems.end),
      };
      const ended = type === 'leave' || type === 'cancel';
      const anchor = ended || !onPage ? undefined : hitTest(onPage, point.x, point.y);
      const column = ended
        ? undefined
        : nearestColumn(layout, onPage?.systems ?? layout.systems, point);
      onScorePointer({ type, point, anchor, column, event: event.nativeEvent });
    };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // Ctrl with the wheel is a pinch, which zooms.
    if (!onUserScroll || event.ctrlKey) return;
    const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    onUserScroll(sideways ? 'x' : 'y');
  };

  const onRegionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onUserScroll) return;
    if (event.button === 1) {
      onUserScroll('both');
      return;
    }
    // A press on the region itself, not the canvas, is a press on a scrollbar.
    if (event.target !== event.currentTarget) return;
    const { offsetX, offsetY } = event.nativeEvent;
    if (offsetX >= event.currentTarget.clientWidth) onUserScroll('y');
    else if (offsetY >= event.currentTarget.clientHeight) onUserScroll('x');
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const axis = KEY_AXES[event.key];
    if (!onUserScroll || !axis) return;
    const native = event.nativeEvent;
    // After the window's shortcut dispatcher, which prevents the keys a command took.
    setTimeout(() => {
      if (!native.defaultPrevented) onUserScroll(axis);
    }, 0);
  };

  return (
    <div
      ref={attach}
      role="region"
      aria-label={label}
      aria-roledescription="score"
      aria-busy={!fontsReady}
      aria-describedby={descriptionId}
      tabIndex={0}
      className={cn(
        'score-view focus-visible:outline-ring relative overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2',
        className,
      )}
      onScroll={onScroll}
      onWheel={onWheel}
      onPointerDown={onRegionPointerDown}
      onTouchMove={
        onUserScroll &&
        (() => {
          onUserScroll('both');
        })
      }
      onKeyDown={onKeyDown}
    >
      <p id={descriptionId} className="sr-only">
        {describeLayout(layout)}
      </p>
      <div className="score-sizer" style={{ width: size.width, height: size.height }}>
        <div
          className="score-canvas"
          style={{
            left: offset.x,
            top: offset.y,
            width: extent.width * zoom,
            height: extent.height * zoom,
          }}
          onPointerDown={pointer('down')}
          onPointerMove={pointer('move')}
          onPointerUp={pointer('up')}
          onPointerLeave={pointer('leave')}
          onPointerCancel={pointer('cancel')}
        >
          {pages.map((index) => {
            const page = layout.pages[index];
            const drawn = flow.pages[index];
            if (!page || !drawn) return null;
            const systems = fontsReady
              ? layout.systems
                  .slice(range.start, range.end)
                  .filter((system) => system.page === index)
              : [];
            return (
              <ScorePage
                key={index}
                page={page}
                systems={systems}
                primitives={layout.primitives}
                zoom={zoom}
                height={drawn.bbox.height}
                style={{
                  position: 'absolute',
                  left: drawn.bbox.x * zoom,
                  top: drawn.bbox.y * zoom,
                }}
              />
            );
          })}
          <OverlayLayer
            overlays={overlays}
            zoom={zoom}
            range={range}
            place={(rect, system) => toViewRect(flow, layout, rect, system)}
          />
          <PlayheadLayer bar={barBox} line={lineBox} />
        </div>
      </div>
    </div>
  );
}
