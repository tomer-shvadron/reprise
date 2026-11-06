import { LayoutCache, layout, type Anchor, type LayoutResult } from '@reprise/layout';
import { applyCommand, setNote, type Id, type Score } from '@reprise/model';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';

import { cursorAt } from '../anchors';
import { useScoreFonts } from '../fonts';
import type { ScoreOverlays } from '../overlay-layer';
import { ScorePages } from '../score-page';
import { ScoreView, type ScorePointerEvent, type ScoreViewHandle } from '../score-view';
import { uniformNotation, viewLayoutOptions } from '../view-options';
import { intersects } from '../viewport';
import { DEMO_CHOICES, LONG_FIXTURE, serializeDemoParams, type DemoParams } from './demo-params';
import { FIXTURES, loadFixture } from './fixtures';
import { PerfPanel } from './perf-panel';
import { changedSystems, frameStats, type PaintRecord, type ScrollRecord } from './perf-stats';

interface Doc {
  score: Score;
  cache: LayoutCache;
  result: LayoutResult;
}

interface PendingPaint {
  label: string;
  layoutMs: number;
  /** When React was handed the layout. */
  handedAt: number;
  observer?: MutationObserver;
}

const SCROLL_SPEED = 2000;
const SCROLL_MS = 10_000;
const MAX_FRET = 25;

async function loadScore(fixture: string): Promise<Score> {
  if (fixture === LONG_FIXTURE) {
    // Dev-only: the generated long score comes from the test builders, never from the app build.
    const { longScore } = await import('../test/long-score');
    return longScore();
  }
  return loadFixture(fixture);
}

const nextFrame = () =>
  new Promise<number>((resolve) => {
    requestAnimationFrame(resolve);
  });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Choice<T extends string>(props: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={props.label}>
      <select
        className="bg-background rounded border px-1 py-0.5"
        value={props.value}
        onChange={(event) => {
          const value = props.values.find((candidate) => candidate === event.target.value);
          if (value !== undefined) props.onChange(value);
        }}
      >
        {props.values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </Field>
  );
}

function regionIn(frame: HTMLElement | null): HTMLElement | null {
  return frame?.querySelector<HTMLElement>('[role="region"]') ?? null;
}

/** The budget's measure: every element under the score region. */
function countElements(frame: HTMLElement | null): number {
  return regionIn(frame)?.querySelectorAll('*').length ?? 0;
}

/** Beat anchors of each system's first staff, in reading order: the Step cursor's path. */
function cursorPath(result: LayoutResult): Anchor[] {
  return result.systems.flatMap((system) => {
    const staff = system.staves[0];
    if (!staff) return [];
    return result.anchors
      .slice(system.anchors.start, system.anchors.end)
      .filter((a) => a.kind === 'beat' && a.track === staff.track && a.staff === staff.type)
      .sort((a, b) => a.bbox.x - b.bbox.x);
  });
}

/** The `/dev/score` page: any fixture or the long score, every view option, and measurements. */
export function ScoreDemo({ initial }: { initial: DemoParams }) {
  const [params, setParams] = useState(initial);
  const [doc, setDoc] = useState<Doc>();
  const [error, setError] = useState<string>();
  const [overlays, setOverlays] = useState<ScoreOverlays>({});
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [paints, setPaints] = useState<PaintRecord[]>([]);
  const [scrolls, setScrolls] = useState<ScrollRecord[]>([]);
  const [elements, setElements] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const fontsReady = useScoreFonts();
  const handle = useRef<ScoreViewHandle>(null);
  const frame = useRef<HTMLDivElement>(null);
  const pending = useRef<PendingPaint>(undefined);
  const edits = useRef(0);

  const region = () => regionIn(frame.current);

  const relayout = (
    score: Score,
    cache: LayoutCache,
    label: string,
    next: DemoParams,
    dirtyBars?: readonly Id[],
  ) => {
    const options = viewLayoutOptions(next, {
      tracks: 'all',
      notation: uniformNotation(score, next.notation),
    });
    const result = layout(score, dirtyBars ? { ...options, dirtyBars } : options, cache);
    pending.current = { label, layoutMs: result.metrics.layoutMs, handedAt: performance.now() };
    setDoc({ score, cache, result });
    setOverlays({});
    setCursorIndex(-1);
  };

  const onLoaded = useEffectEvent((score: Score) => {
    setError(undefined);
    relayout(score, new LayoutCache(), 'first paint', params);
  });

  useEffect(() => {
    let cancelled = false;
    loadScore(params.fixture).then(
      (score) => {
        if (!cancelled) onLoaded(score);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [params.fixture]);

  useEffect(() => {
    window.history.replaceState(null, '', serializeDemoParams(params));
    document.documentElement.dataset['theme'] = params.theme;
  }, [params]);

  // Measures a paint: the frame after the commit that put the new layout's systems in the DOM.
  useLayoutEffect(() => {
    const job = pending.current;
    if (!job || !doc || !fontsReady) return;
    pending.current = undefined;
    const committedAt = performance.now();
    requestAnimationFrame(() => {
      setTimeout(() => {
        const now = performance.now();
        const changed = job.observer && changedSystems(job.observer.takeRecords());
        job.observer?.disconnect();
        const record: PaintRecord = {
          label: job.label,
          layoutMs: job.layoutMs,
          commitMs: committedAt - job.handedAt,
          frameMs: now - committedAt,
          totalMs: job.layoutMs + now - job.handedAt,
          ...(changed !== undefined && { changedSystems: changed }),
          elements: countElements(frame.current),
        };
        console.table([record]);
        setPaints((list) => [...list, record]);
        setElements(record.elements);
      });
    });
  }, [doc, fontsReady]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setElements(countElements(frame.current));
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [params.zoom, params.view]);

  const update = (change: Partial<DemoParams>) => {
    const next = { ...params, ...change };
    setParams(next);
    const relays = (['mode', 'paper', 'notation'] as const).some((key) => key in change);
    if (doc && relays && next.fixture === params.fixture) {
      relayout(doc.score, doc.cache, `relayout ${next.mode} ${next.notation}`, next);
    }
  };

  const editOneNote = () => {
    if (!doc) return;
    const window = handle.current?.viewport();
    const system =
      (window && doc.result.systems.find(({ bbox }) => intersects(bbox, window))) ??
      doc.result.systems[0];
    const trackIndex = doc.score.tracks.findIndex((track) => track.tuning.length > 0);
    const beat =
      system && doc.score.tracks[trackIndex]?.bars[system.bars.start]?.voices[0]?.beats[0];
    if (!beat) {
      setError('No fretted beat to edit in this system');
      return;
    }
    edits.current += 1;
    const { score, change } = applyCommand(
      doc.score,
      setNote({ beatId: beat.id }, { string: 1, fret: edits.current % MAX_FRET }),
    );
    const target = region();
    const observer = new MutationObserver(() => undefined);
    if (target) {
      observer.observe(target, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    relayout(score, doc.cache, 'edit one note', params, change.touchedBars);
    if (pending.current) pending.current.observer = observer;
  };

  const path = useMemo(() => (doc ? cursorPath(doc.result) : []), [doc]);

  const stepCursor = () => {
    if (!doc || path.length === 0) return;
    const index = (cursorIndex + 1) % path.length;
    const anchor = path[index];
    const cursor = anchor && cursorAt(doc.result, anchor);
    setCursorIndex(index);
    if (!cursor) return;
    setOverlays((current) => ({ ...current, cursor }));
    handle.current?.revealRect(cursor.bar.bbox);
  };

  const autoScroll = async () => {
    const target = region();
    if (!target || scrolling) return;
    setScrolling(true);
    const vertical = params.mode === 'paged' || params.view === 'pages';
    const intervals: number[] = [];
    const start = await nextFrame();
    const from = vertical ? target.scrollTop : target.scrollLeft;
    let last = start;
    for (let now = await nextFrame(); now - start < SCROLL_MS; now = await nextFrame()) {
      intervals.push(now - last);
      last = now;
      const position = from + (SCROLL_SPEED * (now - start)) / 1000;
      if (vertical) target.scrollTop = position;
      else target.scrollLeft = position;
    }
    const record: ScrollRecord = {
      label: `${params.mode} ${params.notation} ×${String(params.zoom)}`,
      ...frameStats(intervals),
      elements: countElements(frame.current),
    };
    console.table([record]);
    setScrolls((list) => [...list, record]);
    setElements(record.elements);
    setScrolling(false);
  };

  const onScorePointer = ({ type, anchor }: ScorePointerEvent) => {
    if (type === 'move' || type === 'leave') {
      if (overlays.hover === anchor) return;
      setOverlays((current) => {
        const next = { ...current };
        if (anchor) next.hover = anchor;
        else delete next.hover;
        return next;
      });
    } else if (type === 'down' && anchor && doc) {
      const cursor = cursorAt(doc.result, anchor);
      setOverlays((current) => ({
        ...current,
        selection: [anchor],
        ...(cursor && { cursor }),
      }));
    }
  };

  const fixtures = [LONG_FIXTURE, ...FIXTURES];

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b p-2">
        <Choice
          label="Fixture"
          value={params.fixture}
          values={fixtures}
          onChange={(fixture) => {
            update({ fixture });
          }}
        />
        <Choice
          label="Mode"
          value={params.mode}
          values={DEMO_CHOICES.MODES}
          onChange={(mode) => {
            update({ mode });
          }}
        />
        <Choice
          label="Paper"
          value={params.paper}
          values={DEMO_CHOICES.PAPERS}
          onChange={(paper) => {
            update({ paper });
          }}
        />
        <Choice
          label="Notation"
          value={params.notation}
          values={DEMO_CHOICES.NOTATIONS}
          onChange={(notation) => {
            update({ notation });
          }}
        />
        <Choice
          label="Theme"
          value={params.theme}
          values={DEMO_CHOICES.THEMES}
          onChange={(theme) => {
            update({ theme });
          }}
        />
        <Choice
          label="View"
          value={params.view}
          values={DEMO_CHOICES.VIEWS}
          onChange={(view) => {
            update({ view });
          }}
        />
        <Field label={`Zoom ${params.zoom.toFixed(2)}`}>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.05}
            value={params.zoom}
            onChange={(event) => {
              update({ zoom: Number(event.target.value) });
            }}
          />
        </Field>
        <Button size="sm" variant="outline" onClick={editOneNote} disabled={!doc}>
          Edit one note
        </Button>
        <Button size="sm" variant="outline" onClick={stepCursor} disabled={!doc}>
          Step cursor
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void autoScroll()}
          disabled={!doc || scrolling}
        >
          {scrolling ? 'Scrolling…' : 'Auto-scroll'}
        </Button>
        {error && <span className="text-destructive text-xs">{error}</span>}
      </header>
      <div className="flex min-h-0 flex-1">
        <div ref={frame} className="flex min-w-0 flex-1 flex-col">
          {doc &&
            (params.view === 'pages' ? (
              <div
                role="region"
                aria-label="Score pages"
                aria-busy={!fontsReady}
                className="min-h-0 flex-1 overflow-auto py-8"
              >
                <ScorePages layout={doc.result} zoom={params.zoom} />
              </div>
            ) : (
              <ScoreView
                ref={handle}
                layout={doc.result}
                zoom={params.zoom}
                overlays={overlays}
                onScorePointer={onScorePointer}
                className="min-h-0 flex-1"
              />
            ))}
        </div>
        <PerfPanel paints={paints} scrolls={scrolls} elements={elements} />
      </div>
    </div>
  );
}
