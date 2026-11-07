import { hitTest, type Anchor, type LayoutResult, type Rect } from '@reprise/layout';
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
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type UIEvent,
} from 'react';

import { cn } from '@/lib/utils';

import { describeLayout } from './anchors';
import { useScoreFonts } from './fonts';
import { OverlayLayer, type ScoreOverlays } from './overlay-layer';
import { ScorePage } from './score-page';
import {
  canvasOffset,
  centreFromScroll,
  clampScroll,
  contentSize,
  layoutExtent,
  mountedPages,
  mountedSystems,
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
  /** The native event, for buttons and modifiers. */
  event: PointerEvent;
}

export interface ScoreViewHandle {
  /** Scrolls the least distance that shows `rect` (layout px) with `margin`; no-op when it shows. */
  revealRect(rect: Rect, options?: { margin?: number; behavior?: 'auto' | 'smooth' }): void;
  /** The visible window in layout px, from the live scroll position. */
  viewport(): Rect;
}

export interface ScoreViewProps {
  layout: LayoutResult;
  /** Display scale, the ui store's zoom; never re-lays out. */
  zoom: number;
  overlays?: ScoreOverlays;
  onScorePointer?: (event: ScorePointerEvent) => void;
  /** The score region's accessible name. */
  label?: string;
  className?: string;
  ref?: Ref<ScoreViewHandle>;
}

const DEFAULT_REVEAL_MARGIN = 24;

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
  const fontsReady = useScoreFonts();
  const descriptionId = useId();

  const extent = useMemo(() => layoutExtent(layout), [layout]);
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
  const range = mountedSystems(layout.systems, visible);
  const pages = mountedPages(layout.pages, layout.systems, range, visible);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = centreFromScroll(readScroll(event.currentTarget), viewport, zoom, offset);
    startTransition(() => {
      setCentre(next);
    });
  };

  // Zoom keeps the notation at the viewport centre where it was.
  const anchorZoom = useEffectEvent(() => {
    const target = scroller.current;
    if (!target || !centre) return;
    const scroll = scrollFromCentre(centre, viewport, zoom, offset);
    target.scrollLeft = scroll.x;
    target.scrollTop = scroll.y;
  });
  useLayoutEffect(() => {
    anchorZoom();
  }, [zoom]);

  useImperativeHandle(ref, () => {
    const live = (target: HTMLElement) =>
      visibleWindow(
        centreFromScroll(readScroll(target), viewport, zoom, offset),
        viewport,
        zoom,
        offset,
      );
    return {
      viewport: () => (scroller.current ? live(scroller.current) : visible),
      revealRect: (rect, options = {}) => {
        const target = scroller.current;
        if (!target) return;
        const current = live(target);
        const origin = revealScroll(current, rect, options.margin ?? DEFAULT_REVEAL_MARGIN);
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
  }, [viewport, zoom, offset, visible]);

  const pointer =
    (type: ScorePointerEvent['type']) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onScorePointer) return;
      const canvas = event.currentTarget.getBoundingClientRect();
      const point = toLayoutPoint(
        { x: event.clientX, y: event.clientY },
        { x: canvas.left, y: canvas.top },
        zoom,
      );
      const anchor =
        type === 'leave' || type === 'cancel' ? undefined : hitTest(layout, point.x, point.y);
      onScorePointer({ type, point, anchor, event: event.nativeEvent });
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
            if (!page) return null;
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
                style={{
                  position: 'absolute',
                  left: page.bbox.x * zoom,
                  top: page.bbox.y * zoom,
                }}
              />
            );
          })}
          <OverlayLayer overlays={overlays} zoom={zoom} range={range} />
        </div>
      </div>
    </div>
  );
}
