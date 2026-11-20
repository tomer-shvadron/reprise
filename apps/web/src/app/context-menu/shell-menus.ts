import type { HeaderElement } from '@/state/menu-target';
import type { PanelView } from '@/state/ui';

import type { MenuContext, MenuContribution, MenuItemSpec } from './types';

const onHeader =
  (...elements: HeaderElement[]) =>
  ({ target }: MenuContext) =>
    target.kind === 'header' && elements.includes(target.element);

const onPanel =
  (...views: PanelView[]) =>
  ({ target }: MenuContext) =>
    target.kind === 'panel' && target.view !== undefined && views.includes(target.view);

const showsPanel = ({ services }: MenuContext, view: PanelView) => {
  const { panels, rightPanelView } = services.ui.getState();
  return panels.rightPanel && rightPanelView === view;
};

/** For a tab whose command toggles: "Hide history" while it shows, "Show history" otherwise. */
const toggleLabel = (view: PanelView, noun: string) => (at: MenuContext) =>
  `${showsPanel(at, view) ? 'Hide' : 'Show'} ${noun}`;

const collapseLabel = ({ services }: MenuContext) =>
  services.ui.getState().panels.rightPanel ? 'Collapse panel' : 'Expand panel';

/**
 * The menu of a panel tab and of its rail button: the view's own command, its actions, and the
 * panel's fold. The fold button of the rail has no view and gets the fold alone.
 */
const panelItems: readonly MenuItemSpec[] = [
  { command: 'trainer.speedTrainerToggle', group: 'practice', when: onPanel('speedTrainer') },
  { command: 'trainer.speedTrainerReset', group: 'practice', when: onPanel('speedTrainer') },
  { command: 'trainer.tunerToggle', group: 'practice', when: onPanel('tuner') },
  { command: 'trainer.metronomeToggle', group: 'practice', when: onPanel('metronome') },
  {
    command: 'view.togglePanel',
    group: 'view',
    when: onPanel('mixer'),
    label: toggleLabel('mixer', 'mixer'),
  },
  { command: 'trainer.speedTrainer', group: 'view', when: onPanel('speedTrainer') },
  { command: 'trainer.tuner', group: 'view', when: onPanel('tuner') },
  { command: 'trainer.metronome', group: 'view', when: onPanel('metronome') },
  {
    command: 'editor.toggleEffectsPanel',
    group: 'view',
    when: onPanel('effects'),
    label: toggleLabel('effects', 'effects'),
  },
  {
    command: 'editor.showHistory',
    group: 'view',
    when: onPanel('history'),
    label: toggleLabel('history', 'history'),
  },
  { command: 'view.toggleRightPanel', group: 'view', label: collapseLabel },
];

/** The shell's own surfaces: the header and the right panel's tabs and rail. */
export const shellMenus: readonly MenuContribution[] = [
  {
    surface: 'header',
    items: [
      { command: 'library.show', group: 'view', when: onHeader('crumb') },
      { command: 'library.openRecent', group: 'view', when: onHeader('crumb') },
      { command: 'file.showImportDetails', group: 'properties', when: onHeader('crumb') },
      {
        command: 'editor.toggleMode',
        group: 'view',
        when: onHeader('mode'),
        label: ({ mode }) => (mode === 'edit' ? 'Play mode' : 'Edit mode'),
      },
      { command: 'view.toggleViewMode', group: 'view', when: onHeader('view') },
      { command: 'view.zoomIn', group: 'view', when: onHeader('view') },
      { command: 'view.zoomOut', group: 'view', when: onHeader('view') },
      { command: 'view.zoomReset', group: 'view', when: onHeader('view') },
      { command: 'app.commandPalette', group: 'view', when: onHeader('search', 'band') },
      { command: 'app.shortcuts', group: 'properties', when: onHeader('search', 'band') },
      { command: 'view.toggleTheme', group: 'properties', when: onHeader('band') },
    ],
  },
  { surface: 'panel.tab', items: panelItems },
  { surface: 'panel.rail', items: panelItems },
];
