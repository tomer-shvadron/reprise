import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { loopBars } from '@/app/palette/actions';
import { useAppServices } from '@/app/services-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCommand } from '@/app/use-command';
import { sectionAt, sectionBars, sectionsOf, type ScoreSection } from '@/features/transport';
import { cn } from 'cn';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The song's sections as one row of toggles above the score: a click loops the section, a click on
 * the looped one ends the loop, and the section under the playhead is underlined. Nothing renders
 * for a song without markers. Plain tab stops: the arrows stay with the playhead.
 */
export function SectionStrip() {
  const services = useAppServices();
  const { document, playback } = services;
  const score = useStore(document, (state) => state.score);
  const loop = useStore(playback, (state) => state.settings.loop);
  // A number, so the strip renders once per bar rather than per frame.
  const barIndex = useStore(playback, (state) => state.position?.position.masterBarIndex);
  const toggleLoop = useCommand('transport.toggleLoop');
  const refs = useRef(new Map<number, HTMLButtonElement>());
  // Memoized, so the sections are the same objects until the score changes.
  const all = useMemo(() => (score ? sectionsOf(score) : []), [score]);
  const playing = barIndex === undefined ? undefined : sectionAt(all, barIndex);

  // Keyed by the start bar, so the scroll runs when the playing section changes, not per render.
  const playingStart = playing?.startIndex;
  useEffect(() => {
    if (playingStart === undefined) return;
    refs.current.get(playingStart)?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    });
  }, [playingStart]);

  if (!score || all.length === 0) return null;

  const looped = (section: ScoreSection) =>
    loop !== undefined &&
    loop.startBar === score.masterBars[section.startIndex]?.id &&
    loop.endBar === score.masterBars[section.endIndex]?.id;

  return (
    <nav aria-label="Sections" className="bg-background shrink-0 border-b">
      <ul className="flex h-9 items-stretch gap-1 overflow-x-auto px-3">
        {all.map((section) => {
          const pressed = looped(section);
          const current = section === playing;
          return (
            <li key={section.startIndex} className="flex shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={(node) => {
                      if (node) refs.current.set(section.startIndex, node);
                      else refs.current.delete(section.startIndex);
                    }}
                    type="button"
                    aria-pressed={pressed}
                    aria-current={current ? 'true' : undefined}
                    aria-label={`${section.label}, ${sectionBars(section)}`}
                    data-section={section.label}
                    onMouseDown={keepFocus}
                    onClick={() => {
                      if (pressed) {
                        toggleLoop.run();
                      } else {
                        loopBars(services, section.startIndex, section.endIndex, section.label);
                      }
                    }}
                    className={cn(
                      'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring my-1 rounded-md border-b-2 border-transparent px-2.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2',
                      'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary',
                      'aria-current:border-primary aria-pressed:aria-current:border-primary-foreground',
                    )}
                  >
                    {section.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{sectionBars(section)}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
