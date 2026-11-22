import { useEffect, useRef } from 'react';

import { HintTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { seekToBar } from '@/features/transport';
import type { SectionInsight, SongInsights } from '@/lib/insights';

import { songScaleOf } from '../../fretboard/scale-overlay';
import { insightsFor } from '../insights-for';

import { InsightCard } from './card';
import { ScaleToggle } from './scale-toggle';

const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
};

const barsOf = ({ fromBar, toBar }: SectionInsight): string =>
  fromBar === toBar
    ? `Bar ${String(fromBar + 1)}`
    : `Bars ${String(fromBar + 1)}–${String(toBar + 1)}`;

function SoloBadge() {
  return (
    <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] uppercase">Solo</span>
  );
}

/**
 * One row per section: its bars, length, what differs from the song's key and scale, and the scale
 * each track plays in it. A section's name seeks to its first bar. `focus` is a request from the
 * section's context menu (or the palette): the row holding that bar scrolls in, takes focus and is
 * announced, and is tinted until the next key or pointer press.
 */
export function SectionsCard({
  insights,
  currentTrack,
  focus,
  marked: markedBar,
}: {
  insights: SongInsights;
  /** Index into `Score.tracks`, listed first in every section. */
  currentTrack: number | undefined;
  focus: { bar: number; request: number } | undefined;
  /** The bar to tint, from `focus` once it is acted on. */
  marked: number | undefined;
}) {
  const services = useAppServices();
  const root = useRef<HTMLDivElement>(null);
  const { sections, tracks } = insights;
  const songScale = songScaleOf(insights);

  useEffect(() => {
    if (!focus) return;
    const target = sections.find(
      ({ fromBar, toBar }) => focus.bar >= fromBar && focus.bar <= toBar,
    );
    if (!target) {
      insightsFor(services).getState().clearFocus();
      return;
    }
    const element = root.current?.querySelector<HTMLElement>(
      `[data-section-from="${String(target.fromBar)}"]`,
    );
    // jsdom has no scrollIntoView.
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
    element?.querySelector('button')?.focus({ preventScroll: true });
    services.transport
      .getState()
      .announce(
        `${target.name}, ${barsOf(target).toLowerCase()}${target.scale ? `, ${target.scale.name}` : ''}`,
      );
    insightsFor(services).getState().clearFocus();
  }, [focus, sections, services]);

  useEffect(() => {
    if (markedBar === undefined) return;
    const clear = () => {
      insightsFor(services).getState().unmark();
    };
    window.addEventListener('pointerdown', clear, { once: true });
    window.addEventListener('keydown', clear, { once: true });
    return () => {
      window.removeEventListener('pointerdown', clear);
      window.removeEventListener('keydown', clear);
    };
  }, [markedBar, services]);

  if (sections.length === 0) return null;
  return (
    <InsightCard title="Sections" data-insight-card="sections">
      <div ref={root}>
        <ul className="flex flex-col gap-2.5">
          {sections.map((section) => {
            const ordered = [...section.tracks].sort(
              (a, b) => Number(b.track === currentTrack) - Number(a.track === currentTrack),
            );
            const here =
              markedBar !== undefined && markedBar >= section.fromBar && markedBar <= section.toBar;
            // Only what differs from the song says anything: a modulation or another mode.
            const differs =
              section.key !== undefined &&
              (section.scale
                ? section.key.tonic !== songScale?.tonic || section.scale.id !== songScale.scaleId
                : !insights.key.found ||
                  section.key.tonic !== insights.key.tonic ||
                  section.key.quality !== insights.key.quality);
            return (
              <li
                key={section.fromBar}
                data-insight-section={section.name}
                data-section-from={section.fromBar}
                data-focused={here || undefined}
                className="data-[focused]:bg-accent flex flex-col gap-0.5 rounded-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <HintTooltip label={`Go to bar ${String(section.fromBar + 1)}`}>
                    <button
                      type="button"
                      aria-label={`${section.name}, go to bar ${String(section.fromBar + 1)}`}
                      className="text-sm font-medium underline-offset-2 hover:underline focus-visible:underline"
                      onClick={() => {
                        const { score } = services.document.getState();
                        // A bar that is never played announces itself; a refusal needs nothing more.
                        if (score)
                          seekToBar(services, score, { masterBarIndex: section.fromBar, tick: 0 });
                      }}
                    >
                      {section.name}
                    </button>
                  </HintTooltip>
                  {section.solo && <SoloBadge />}
                  <span className="text-muted-foreground text-xs">
                    {barsOf(section)}, {clock(section.seconds)}
                  </span>
                </div>
                {differs && section.key && (
                  <p className="text-xs">
                    {section.scale ? (
                      <ScaleToggle
                        tonic={section.key.tonic}
                        scaleId={section.scale.id}
                        name={section.scale.name}
                        whose={section.name}
                        songScale={songScale}
                      />
                    ) : (
                      <span className="text-muted-foreground">{section.key.name}</span>
                    )}
                  </p>
                )}
                {ordered.length > 0 && (
                  <ul className="flex flex-col gap-0.5 pt-0.5">
                    {ordered.map((entry) => {
                      const name = tracks[entry.track]?.name ?? `Track ${String(entry.track + 1)}`;
                      const whole = tracks[entry.track]?.scale;
                      // The Tracks card offers the track's own scale: only a different one is a control here.
                      const novel =
                        entry.scale !== undefined &&
                        (whole?.id !== entry.scale.id || whole.tonic !== entry.scale.tonic);
                      return (
                        <li
                          key={entry.track}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                          data-section-track={name}
                        >
                          <span className="font-medium">{name}</span>
                          {entry.solo && <SoloBadge />}
                          {entry.scale && novel ? (
                            <ScaleToggle
                              tonic={entry.scale.tonic}
                              scaleId={entry.scale.id}
                              name={entry.scale.name}
                              whose={`${name} in ${section.name}`}
                              songScale={songScale}
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              {entry.scale ? entry.scale.name : 'No scale fits'}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </InsightCard>
  );
}
