import {
  HistoryIcon,
  MusicIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SlidersVerticalIcon,
  SparklesIcon,
  TimerIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { keepFocus, tooltipText } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PanelView } from '@/state/ui';

import {
  PANEL_TABS,
  PRACTICE_VIEWS,
  tabOfView,
  type PanelTabId,
  type PracticeView,
} from './panel-views';
import { panelId, TabList } from './tab-list';

const TAB_ICONS: Record<PanelTabId, LucideIcon> = {
  mixer: SlidersVerticalIcon,
  practice: TimerIcon,
  effects: SparklesIcon,
  history: HistoryIcon,
  chords: MusicIcon,
};

const SUB_TAB_COMMANDS = {
  speedTrainer: 'trainer.speedTrainer',
  tuner: 'trainer.tuner',
  metronome: 'trainer.metronome',
} as const satisfies Record<PracticeView, string>;

const PANEL_PREFIX = 'right-panel';
const PRACTICE_PREFIX = 'practice';

function isPracticeView(view: PanelView): view is PracticeView {
  return tabOfView(view) === 'practice';
}

/** The tab strip over the panel's content; it reads and sets `rightPanelView` and holds no state. */
export function PanelTabs({ children }: { children: ReactNode }) {
  const { ui } = useAppServices();
  const view = useStore(ui, (state) => state.rightPanelView);
  const showPanelView = useStore(ui, (state) => state.showPanelView);
  const tab = tabOfView(view);

  return (
    <>
      <TabList
        label="Panel views"
        idPrefix={PANEL_PREFIX}
        items={PANEL_TABS}
        selected={tab}
        onSelect={(id) => {
          // Pressing the Practice tab while a practice tool shows keeps that tool.
          if (id === tab) return;
          const target = PANEL_TABS.find((item) => item.id === id);
          if (target) showPanelView(target.view);
        }}
      />
      <div
        role="tabpanel"
        id={panelId(PANEL_PREFIX)}
        aria-labelledby={`${PANEL_PREFIX}-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {isPracticeView(view) ? (
          <>
            <TabList
              label="Practice tools"
              idPrefix={PRACTICE_PREFIX}
              items={PRACTICE_VIEWS.map(({ view: id, label }) => ({
                id,
                label,
                view: id,
                command: SUB_TAB_COMMANDS[id],
              }))}
              selected={view}
              onSelect={showPanelView}
              className="bg-muted/40"
            />
            <div
              role="tabpanel"
              id={panelId(PRACTICE_PREFIX)}
              aria-labelledby={`${PRACTICE_PREFIX}-tab-${view}`}
              className="flex min-h-0 flex-1 flex-col"
            >
              {children}
            </div>
          </>
        ) : (
          children
        )}
      </div>
    </>
  );
}

function RailButton({ entry }: { entry: (typeof PANEL_TABS)[number] }) {
  const { ui } = useAppServices();
  const { id } = entry;
  const active = useStore(
    ui,
    (state) => state.panels.rightPanel && tabOfView(state.rightPanelView) === id,
  );
  const command = useCommand(entry.command);
  const menu = useStaticContextMenu({
    surface: 'panel.rail',
    target: { kind: 'panel', view: entry.view },
    label: `${entry.label} view`,
  });
  const Icon = TAB_ICONS[id];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={entry.label}
          aria-pressed={active}
          aria-keyshortcuts={command.ariaKeys}
          {...menu}
          onMouseDown={keepFocus}
          onClick={() => {
            const state = ui.getState();
            // The active view's icon folds the panel away; any other shows its view.
            if (active) state.setPanelOpen('rightPanel', false);
            else state.showPanelView(entry.view);
          }}
          className={active ? 'bg-accent text-accent-foreground' : undefined}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{tooltipText(entry.label, command.keys)}</TooltipContent>
    </Tooltip>
  );
}

/** The icon rail on the panel's edge: one click per view, and the fold control, always visible. */
export function PanelRail() {
  const { ui } = useAppServices();
  const open = useStore(ui, (state) => state.panels.rightPanel);
  const setPanelOpen = useStore(ui, (state) => state.setPanelOpen);
  const foldMenu = useStaticContextMenu({
    surface: 'panel.rail',
    target: { kind: 'panel', view: undefined },
    label: 'Right panel',
  });
  const verb = open ? 'Collapse panel' : 'Expand panel';
  const Icon = open ? PanelRightCloseIcon : PanelRightOpenIcon;

  return (
    <div
      role="group"
      aria-label="Panel rail"
      className="bg-sidebar text-sidebar-foreground flex w-10 shrink-0 flex-col items-center gap-1 border-l py-1.5"
    >
      {PANEL_TABS.map((item) => (
        <RailButton key={item.id} entry={item} />
      ))}
      <CommandTooltip command="view.toggleRightPanel" label={verb} side="left">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Right panel"
          aria-expanded={open}
          {...foldMenu}
          onMouseDown={keepFocus}
          onClick={() => {
            setPanelOpen('rightPanel', !open);
          }}
          className="mt-auto"
        >
          <Icon />
        </Button>
      </CommandTooltip>
    </div>
  );
}
