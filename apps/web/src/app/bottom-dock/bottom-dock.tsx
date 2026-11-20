import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { ResizeHandle } from '@/app/resize-handle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  BOTTOM_PANEL_HEIGHT,
  BOTTOM_PANEL_TITLES,
  type BottomPanelView,
  type UiStore,
} from '@/state/ui';
import { cn } from 'cn';

/** The dock's views in tab order; a new view widens `BottomPanelView` and adds its title. */
const VIEWS = Object.keys(BOTTOM_PANEL_TITLES) as BottomPanelView[];

const tabId = (view: string) => `bottom-dock-tab-${view}`;
const PANEL_ID = 'bottom-dock-panel';

/**
 * The bottom region: always a tab strip with a collapse button, plus the view below it while it
 * is open. Tabs follow the WAI-ARIA pattern with automatic activation; picking one expands a
 * collapsed dock. The tabs carry no tooltip because their label is visible and no view has a
 * shortcut yet; a view that gets one shows it there.
 */
export function BottomDock({ ui, children }: { ui: UiStore; children?: ReactNode }) {
  const open = useStore(ui, (state) => state.bottomPanel.open);
  const view = useStore(ui, (state) => state.bottomPanel.view);
  const height = useStore(ui, (state) => state.bottomPanelHeight);
  const setHeight = useStore(ui, (state) => state.setBottomPanelHeight);
  const persistHeight = useStore(ui, (state) => state.persistBottomPanelHeight);
  const showView = useStore(ui, (state) => state.showBottomPanelView);
  const setOpen = useStore(ui, (state) => state.setBottomPanelOpen);
  const tabs = useRef(new Map<BottomPanelView, HTMLButtonElement>());

  const current = VIEWS.indexOf(view);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = VIEWS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? current === last
          ? 0
          : current + 1
        : event.key === 'ArrowLeft'
          ? current === 0
            ? last
            : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const target = next === undefined ? undefined : VIEWS[next];
    if (!target) return;
    event.preventDefault();
    showView(target);
    tabs.current.get(target)?.focus();
  };

  const toggleLabel = open ? 'Collapse bottom panel' : 'Expand bottom panel';
  const ToggleIcon = open ? ChevronDownIcon : ChevronUpIcon;

  return (
    <>
      {open && (
        <ResizeHandle
          label="Resize bottom panel"
          axis="y"
          value={height}
          min={BOTTOM_PANEL_HEIGHT.min}
          max={BOTTOM_PANEL_HEIGHT.max}
          direction={-1}
          onResize={setHeight}
          onResizeEnd={persistHeight}
        />
      )}
      <section
        aria-label={open ? BOTTOM_PANEL_TITLES[view] : 'Bottom panel'}
        className="bg-sidebar text-sidebar-foreground flex min-h-0 shrink-0 flex-col border-t"
        style={open ? { height } : undefined}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-1 pr-3">
          <div
            role="tablist"
            aria-label="Bottom panel views"
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            className="flex"
          >
            {VIEWS.map((id, index) => {
              // By index: with one view the types see `id === view` as always true.
              const selected = index === current;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    if (node) tabs.current.set(id, node);
                    else tabs.current.delete(id);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(id)}
                  aria-selected={selected}
                  aria-controls={selected && open ? PANEL_ID : undefined}
                  // The roving tab stop: only the selected tab is in the Tab order.
                  tabIndex={selected ? 0 : -1}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    showView(id);
                  }}
                  className={cn(
                    'text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mb-px border-b-2 border-transparent px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2',
                    selected && 'border-primary text-foreground',
                  )}
                >
                  {BOTTOM_PANEL_TITLES[id]}
                </button>
              );
            })}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={toggleLabel}
                aria-expanded={open}
                onMouseDown={keepFocus}
                onClick={() => {
                  setOpen(!open);
                }}
              >
                <ToggleIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{toggleLabel}</TooltipContent>
          </Tooltip>
        </div>
        {open && (
          <div
            role="tabpanel"
            id={PANEL_ID}
            aria-labelledby={tabId(view)}
            className="min-h-0 flex-1 overflow-auto"
          >
            {children}
          </div>
        )}
      </section>
    </>
  );
}
