import { ChevronDownIcon, PanelLeftIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BOTTOM_PANEL_HEIGHT, BOTTOM_PANEL_TITLES, PANEL_WIDTH, type UiStore } from '@/state/ui';

import { ResizeHandle } from './resize-handle';

interface AppFrameProps {
  ui: UiStore;
  /** The slim header band above everything else. */
  header?: ReactNode;
  /** The score region's content: the painter, or its empty state. */
  score: ReactNode;
  /** The footer's playback controls. */
  transport?: ReactNode;
  /** The left sidebar's content: the track list. */
  sidebar?: ReactNode;
  /** The right panel's content: its tab strip and the active view. */
  panel?: ReactNode;
  /** Called when a resize of the right panel ends, the moment to store its width. */
  onRightPanelResizeEnd?: () => void;
  /** The icon rail on the right panel's edge; it stays when the panel is collapsed. */
  rail?: ReactNode;
  /** A full-width strip above the panels, such as the library's "not in your library" banner. */
  banner?: ReactNode;
  /** The bottom region's content (the live fretboard); the region shows while `ui.bottomPanel.open`. */
  bottom?: ReactNode;
}

function TracksToggle({ ui }: { ui: UiStore }) {
  const open = useStore(ui, (state) => state.panels.sidebar);
  const togglePanel = useStore(ui, (state) => state.togglePanel);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle tracks"
          aria-pressed={open}
          onClick={() => {
            togglePanel('sidebar');
          }}
        >
          <PanelLeftIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle tracks</TooltipContent>
    </Tooltip>
  );
}

export function AppFrame({
  ui,
  header,
  score,
  transport,
  sidebar,
  panel,
  rail,
  onRightPanelResizeEnd,
  banner,
  bottom,
}: AppFrameProps) {
  const panels = useStore(ui, (state) => state.panels);
  const widths = useStore(ui, (state) => state.panelWidths);
  const zoom = useStore(ui, (state) => state.zoom);
  const setPanelWidth = useStore(ui, (state) => state.setPanelWidth);
  const bottomOpen = useStore(ui, (state) => state.bottomPanel.open);
  const bottomHeight = useStore(ui, (state) => state.bottomPanelHeight);
  const setBottomPanelHeight = useStore(ui, (state) => state.setBottomPanelHeight);
  const setBottomPanelOpen = useStore(ui, (state) => state.setBottomPanelOpen);
  const persistBottomPanelHeight = useStore(ui, (state) => state.persistBottomPanelHeight);
  const bottomTitle = useStore(ui, (state) => BOTTOM_PANEL_TITLES[state.bottomPanel.view]);
  const scoreRef = useRef<HTMLElement>(null);
  const focusBefore = useRef<Element | null>(null);

  useEffect(() => {
    if (bottomOpen) focusBefore.current = document.activeElement;
  }, [bottomOpen]);

  // The collapse button unmounts with the region, so focus goes back to where it was before the
  // region opened, or to the score when that element is gone.
  const collapse = () => {
    setBottomPanelOpen(false);
    const before = focusBefore.current;
    const target =
      before instanceof HTMLElement && before.isConnected && before !== document.body
        ? before
        : (scoreRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? scoreRef.current);
    target?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      {header}
      {banner}
      <div className="flex min-h-40 flex-1">
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
          ref={scoreRef}
          tabIndex={-1}
          aria-label="Score"
          className="bg-muted dark:bg-muted/40 relative min-w-0 flex-1 overflow-hidden outline-none"
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
              {...(onRightPanelResizeEnd && { onResizeEnd: onRightPanelResizeEnd })}
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
        {rail}
      </div>

      {bottomOpen && (
        <>
          <ResizeHandle
            label="Resize bottom panel"
            axis="y"
            value={bottomHeight}
            min={BOTTOM_PANEL_HEIGHT.min}
            max={BOTTOM_PANEL_HEIGHT.max}
            direction={-1}
            onResize={setBottomPanelHeight}
            onResizeEnd={persistBottomPanelHeight}
          />
          <section
            aria-label={bottomTitle}
            className="bg-sidebar text-sidebar-foreground flex min-h-0 flex-col border-t"
            style={{ height: bottomHeight }}
          >
            <header className="flex shrink-0 items-center justify-between border-b px-3 py-0.5">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {bottomTitle}
              </h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Collapse bottom panel"
                    onClick={collapse}
                  >
                    <ChevronDownIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse bottom panel</TooltipContent>
              </Tooltip>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">{bottom}</div>
          </section>
        </>
      )}

      <footer
        aria-label="Transport"
        className="bg-background flex h-14 shrink-0 items-center gap-2 border-t px-3"
      >
        <TracksToggle ui={ui} />
        <Separator orientation="vertical" className="h-6!" />
        {transport}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
      </footer>
    </div>
  );
}
