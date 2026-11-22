import { useEffect, useRef } from 'react';

import { useAppServices } from '@/app/services-context';
import { seekToBar } from '@/features/transport';
import type { SectionInsight, SongInsights } from '@/lib/insights';

import { InsightCard } from './card';
import { ShowScaleButton } from './show-scale-button';

const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
};

const barsOf = ({ fromBar, toBar }: SectionInsight): string =>
  fromBar === toBar
    ? `Bar ${String(fromBar + 1)}`
    : `Bars ${String(fromBar + 1)}–${String(toBar + 1)}`;

/**
 * One row per section: its bars, length, key and scale, and the scale each track plays in it. A
 * section's name seeks to its first bar. `focus` is a request from the section's context menu: the
 * row holding that bar scrolls into view.
 */
export function SectionsCard({
  insights,
  currentTrack,
  focus,
}: {
  insights: SongInsights;
  /** Index into `Score.tracks`, listed first in every section. */
  currentTrack: number | undefined;
  focus: { bar: number; request: number } | undefined;
}) {
  const services = useAppServices();
  const root = useRef<HTMLDivElement>(null);
  const handled = useRef<number>(0);
  const { sections, tracks } = insights;
  const tonicOfSong = insights.key.found ? insights.key.tonic : undefined;

  useEffect(() => {
    if (!focus || focus.request === handled.current) return;
    handled.current = focus.request;
    const row = root.current?.querySelector<HTMLElement>(
      `[data-section-bar="${String(focus.bar)}"]`,
    );
    // jsdom has no scrollIntoView.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [focus, sections]);

  if (sections.length === 0) return null;
  return (
    <InsightCard title="Sections" data-insight-card="sections">
      <div ref={root}>
        <ul className="flex flex-col gap-2.5">
          {sections.map((section) => {
            const tonic = section.key?.tonic ?? tonicOfSong;
            const ordered = [...section.tracks].sort(
              (a, b) => Number(b.track === currentTrack) - Number(a.track === currentTrack),
            );
            const here =
              focus !== undefined && focus.bar >= section.fromBar && focus.bar <= section.toBar;
            return (
              <li
                key={section.fromBar}
                data-insight-section={section.name}
                data-section-bar={section.fromBar}
                data-focused={here || undefined}
                className="data-[focused]:bg-accent flex flex-col gap-0.5 rounded-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <button
                    type="button"
                    className="text-sm font-medium underline-offset-2 hover:underline focus-visible:underline"
                    onClick={() => {
                      const { score } = services.document.getState();
                      if (score)
                        seekToBar(services, score, { masterBarIndex: section.fromBar, tick: 0 });
                    }}
                  >
                    {section.name}
                  </button>
                  {section.solo && (
                    <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] uppercase">
                      Solo
                    </span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {barsOf(section)}, {clock(section.seconds)}
                  </span>
                </div>
                {section.key && (
                  <p className="text-muted-foreground text-xs">
                    {section.key.name}
                    {section.scale ? `, ${section.scale.name}` : ''}
                  </p>
                )}
                {section.scale && section.key && (
                  <ShowScaleButton
                    tonic={section.key.tonic}
                    scaleId={section.scale.id}
                    what={`${section.scale.name} in ${section.name}`}
                  />
                )}
                {ordered.length > 0 && (
                  <ul className="flex flex-col gap-0.5 pt-0.5">
                    {ordered.map((entry) => {
                      const name = tracks[entry.track]?.name ?? `Track ${String(entry.track + 1)}`;
                      return (
                        <li
                          key={entry.track}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                          data-section-track={name}
                        >
                          <span className="font-medium">{name}</span>
                          {entry.solo && (
                            <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] uppercase">
                              Solo
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {entry.scale ? entry.scale.name : 'No scale fits'}
                          </span>
                          {entry.scale && tonic !== undefined && (
                            <ShowScaleButton
                              tonic={tonic}
                              scaleId={entry.scale.id}
                              what={`${entry.scale.name} for ${name} in ${section.name}`}
                            />
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
