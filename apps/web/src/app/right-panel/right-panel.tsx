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

import { keepFocus } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';

import {
  PANEL_TABS,
  PRACTICE_VIEWS,
  SONG_VIEWS,
  tabOfView,
  type PanelTabId,
  type PracticeView,
  type SongView,
} from './panel-views';
import { panelId, TabList } from './tab-list';

const TAB_ICONS: Record<PanelTabId, LucideIcon> = {
  mixer: SlidersVerticalIcon,
  practice: TimerIcon,
  effects: SparklesIcon,
  history: HistoryIcon,
  song: MusicIcon,
};

const SUB_TAB_COMMANDS = {
  speedTrainer: 'trainer.speedTrainer',
  tuner: 'trainer.tuner',
  metronome: 'trainer.metronome',
  insights: 'trainer.insights',
  chords: 'trainer.chords',
} as const satisfies Record<PracticeView | SongView, string>;

const PANEL_PREFIX = 'right-panel';

/** The tabs that hold several views, each with its own strip under the tab list. */
const SUB_TABS: Partial<
  Record<
    PanelTabId,
    {
      label: string;
      prefix: string;
      views: readonly { view: PracticeView | SongView; label: string }[];
    }
  >
> = {
  practice: { label: 'Practice tools', prefix: 'practice', views: PRACTICE_VIEWS },
  song: { label: 'Song views', prefix: 'song', views: SONG_VIEWS },
};

/** The tab strip over the panel's content; it reads and sets `rightPanelView` and holds no state. */
export function PanelTabs({ children }: { children: ReactNode }) {
  const { ui } = useAppServices();
  const view = useStore(ui, (state) => state.rightPanelView);
  const showPanelView = useStore(ui, (state) => state.showPanelView);
  const tab = tabOfView(view);
  const sub = SUB_TABS[tab];

  return (
    <>
      <TabList
        label="Panel views"
        idPrefix={PANEL_PREFIX}
        items={PANEL_TABS}
        selected={tab}
        onSelect={(id) => {
          // Pressing a tab that holds several views while one of them shows keeps that view.
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
        {sub ? (
          <>
            <TabList
              label={sub.label}
              idPrefix={sub.prefix}
              items={sub.views.map(({ view: id, label }) => ({
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
              id={panelId(sub.prefix)}
              aria-labelledby={`${sub.prefix}-tab-${view}`}
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
  const menu = useStaticContextMenu({
    surface: 'panel.rail',
    target: { kind: 'panel', view: entry.view },
    label: `${entry.label} view`,
  });
  const Icon = TAB_ICONS[id];

  return (
    <CommandTooltip command={entry.command} label={entry.label} side="left">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={entry.label}
        aria-pressed={active}
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
    </CommandTooltip>
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
