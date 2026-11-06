import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PANEL_WIDTH, type PanelId, type UiStore } from '@/state/ui';

import { ResizeHandle } from './resize-handle';

interface AppFrameProps {
  ui: UiStore;
  /** The score region's content: the painter, or its empty state. */
  score: ReactNode;
  /** The footer's playback controls. */
  transport?: ReactNode;
  /** The left sidebar's content: the track list. */
  sidebar?: ReactNode;
  /** The right panel's content: the mixer. */
  panel?: ReactNode;
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

export function AppFrame({ ui, score, transport, sidebar, panel }: AppFrameProps) {
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
              {sidebar ?? (
                <h2 className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase">
                  Tracks
                </h2>
              )}
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

        <main
          aria-label="Score"
          className="bg-muted dark:bg-muted/40 relative min-w-0 flex-1 overflow-hidden"
        >
          {score}
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
              {panel ?? (
                <h2 className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase">
                  Mixer
                </h2>
              )}
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
        {transport}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Separator orientation="vertical" className="h-6!" />
        <PanelToggle ui={ui} panel="rightPanel" label="Toggle mixer" />
      </footer>
    </div>
  );
}
