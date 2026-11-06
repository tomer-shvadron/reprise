import type { LayoutResult } from '@reprise/layout';
import { PanelLeftIcon, PanelRightIcon, PlayIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScoreView } from '@/features/score';
import { PANEL_WIDTH, type PanelId, type UiStore } from '@/state/ui';

import { ResizeHandle } from './resize-handle';

// A4 at 96 dpi, the size the paper surface is laid out at 100% zoom.
const PAGE = { width: 794, height: 1123 };

interface AppFrameProps {
  ui: UiStore;
  /** The laid-out score to paint; none until WP-050 feeds it from the document store. */
  layout?: LayoutResult | undefined;
  /** What the score region shows while there is no score. */
  placeholder: ReactNode;
}

function PanelToggle({ ui, panel, label }: { ui: UiStore; panel: PanelId; label: string }) {
  const open = useStore(ui, (state) => state.panels[panel]);
  const togglePanel = useStore(ui, (state) => state.togglePanel);
  const Icon = panel === 'sidebar' ? PanelLeftIcon : PanelRightIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={open}
          onClick={() => {
            togglePanel(panel);
          }}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppFrame({ ui, layout, placeholder }: AppFrameProps) {
  const panels = useStore(ui, (state) => state.panels);
  const widths = useStore(ui, (state) => state.panelWidths);
  const zoom = useStore(ui, (state) => state.zoom);
  const setPanelWidth = useStore(ui, (state) => state.setPanelWidth);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {panels.sidebar && (
          <>
            <aside
              aria-label="Tracks"
              className="bg-sidebar text-sidebar-foreground flex shrink-0 flex-col border-r"
              style={{ width: widths.sidebar }}
            >
              <h2 className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase">
                Tracks
              </h2>
            </aside>
            <ResizeHandle
              label="Resize tracks"
              value={widths.sidebar}
              min={PANEL_WIDTH.sidebar.min}
              max={PANEL_WIDTH.sidebar.max}
              direction={1}
              onResize={(width) => {
                setPanelWidth('sidebar', width);
              }}
            />
          </>
        )}

        <main aria-label="Score" className="bg-muted dark:bg-muted/40 min-w-0 flex-1">
          {layout ? (
            <ScoreView layout={layout} zoom={zoom} className="h-full" />
          ) : (
            <ScrollArea className="h-full">
              <div className="w-max min-w-full p-8">
                <div
                  className="bg-paper text-ink mx-auto p-12 shadow-md"
                  style={{ width: PAGE.width * zoom, minHeight: PAGE.height * zoom }}
                >
                  {placeholder}
                </div>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </main>

        {panels.rightPanel && (
          <>
            <ResizeHandle
              label="Resize panel"
              value={widths.rightPanel}
              min={PANEL_WIDTH.rightPanel.min}
              max={PANEL_WIDTH.rightPanel.max}
              direction={-1}
              onResize={(width) => {
                setPanelWidth('rightPanel', width);
              }}
            />
            <aside
              aria-label="Panel"
              className="bg-sidebar text-sidebar-foreground flex shrink-0 flex-col border-l"
              style={{ width: widths.rightPanel }}
            >
              <h2 className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase">
                Fretboard · Mixer · Trainer
              </h2>
            </aside>
          </>
        )}
      </div>

      <footer
        aria-label="Transport"
        className="bg-background flex h-14 shrink-0 items-center gap-2 border-t px-3"
      >
        <PanelToggle ui={ui} panel="sidebar" label="Toggle tracks" />
        <Separator orientation="vertical" className="h-6!" />
        <Button variant="ghost" size="icon-sm" aria-label="Play" disabled>
          <PlayIcon />
        </Button>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Separator orientation="vertical" className="h-6!" />
        <PanelToggle ui={ui} panel="rightPanel" label="Toggle panel" />
      </footer>
    </div>
  );
}
