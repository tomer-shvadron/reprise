import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { CommandTooltip, HintTooltip } from '@/app/command-tooltip';
import { useContextMenu } from '@/app/context-menu/use-context-menu';
import { ResizeHandle } from '@/app/resize-handle';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  BOTTOM_PANEL_HEIGHT,
  BOTTOM_PANEL_TITLES,
  BOTTOM_PANEL_VIEWS,
  type BottomPanelView,
  type UiStore,
} from '@/state/ui';
import { cn } from 'cn';

const VIEWS = BOTTOM_PANEL_VIEWS;

const VIEW_COMMANDS = {
  fretboard: 'trainer.showFretboard',
} satisfies Record<BottomPanelView, RegisteredCommandId>;

/** The tab's tooltip, titled by the view's own command so the two cannot drift. */
function DockTabTip({
  view,
  children,
}: {
  view: BottomPanelView;
  children: ReactElement<Record<string, unknown>>;
}) {
  const { title } = useCommand(VIEW_COMMANDS[view]);
  return (
    <CommandTooltip command={VIEW_COMMANDS[view]} label={title} whenUnbound="none">
      {children}
    </CommandTooltip>
  );
}

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
  const toggle = useRef<HTMLButtonElement>(null);
  const tabs = useRef(new Map<BottomPanelView, HTMLButtonElement>());

  const current = VIEWS.indexOf(view);
  // One handler for the strip: the tab under the pointer, else the one focused, names the menu.
  const menu = useContextMenu((_via, event) => {
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (!tab) return undefined;
    const id = VIEWS.find((candidate) => tabId(candidate) === tab.id);
    return id === undefined
      ? undefined
      : {
          surface: 'dock.tab',
          target: { kind: 'dock', view: id },
          label: `${BOTTOM_PANEL_TITLES[id]} tab`,
        };
  });

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
    // With one view an arrow key lands on the same tab, and that must not open a collapsed dock.
    if (next !== current) showView(target);
    tabs.current.get(target)?.focus();
  };

  // The view and the resize handle unmount on collapse; the chevron stays, so it takes the focus
  // they had (a mouse click on it keeps focus where it was).
  const collapse = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.closest('[role="tabpanel"]') || active.getAttribute('role') === 'separator')
    ) {
      toggle.current?.focus();
    }
    setOpen(false);
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
        aria-label="Bottom panel"
        // Open, the dock gives way before the transport is clipped (#206); the strip never shrinks.
        className={cn(
          'bg-sidebar text-sidebar-foreground flex min-h-0 flex-col border-t',
          !open && 'shrink-0',
        )}
        style={open ? { height } : undefined}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-1 pr-3">
          <div
            role="tablist"
            aria-label="Bottom panel views"
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            {...menu}
            className="flex"
          >
            {VIEWS.map((id, index) => {
              // By index: with one view the types see `id === view` as always true.
              const selected = index === current;
              const tab = (
                <button
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
                    'text-muted-foreground hover:text-foreground focus-visible:ring-ring -mb-px border-b-2 border-transparent px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    // No underline while collapsed: nothing is showing.
                    selected && 'text-foreground',
                    selected && open && 'border-primary',
                  )}
                >
                  {BOTTOM_PANEL_TITLES[id]}
                </button>
              );
              // Its text names the view, so the tooltip shows only once a key is bound.
              return (
                <DockTabTip key={id} view={id}>
                  {tab}
                </DockTabTip>
              );
            })}
          </div>
          <HintTooltip label={toggleLabel}>
            <Button
              ref={toggle}
              variant="ghost"
              size="icon-sm"
              aria-label={toggleLabel}
              aria-expanded={open}
              onMouseDown={keepFocus}
              onClick={() => {
                if (open) collapse();
                else setOpen(true);
              }}
            >
              <ToggleIcon />
            </Button>
          </HintTooltip>
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
