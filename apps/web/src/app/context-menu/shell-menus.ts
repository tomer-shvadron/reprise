import type { HeaderElement, StatusSegmentName } from '@/state/menu-target';
import type { PanelView } from '@/state/ui';

import type { MenuContext, MenuContribution, MenuItemSpec } from './types';

const onHeader =
  (...elements: HeaderElement[]) =>
  ({ target }: MenuContext) =>
    target.kind === 'header' && elements.includes(target.element);

/** A status bar segment's own menu: the target names the segment. */
export const onStatus =
  (...segments: StatusSegmentName[]) =>
  ({ target }: MenuContext) =>
    target.kind === 'status' && segments.includes(target.segment);

const onPanel =
  (...views: PanelView[]) =>
  ({ target }: MenuContext) =>
    target.kind === 'panel' && target.view !== undefined && views.includes(target.view);

const showsPanel = ({ services }: MenuContext, view: PanelView) => {
  const { panels, rightPanelView } = services.ui.getState();
  return panels.rightPanel && rightPanelView === view;
};

/** For a tab whose command toggles: "Hide history" while it shows, "Show history" otherwise. */
export const toggleLabel = (view: PanelView, noun: string) => (at: MenuContext) =>
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

const hasScore = ({ services }: MenuContext) => services.document.getState().score !== undefined;
const noScore = (at: MenuContext) => !hasScore(at);
const play = ['play'] as const;

/** The empty paper's own items: the view with a score open, and a way to get one without. */
const paperItems: readonly MenuItemSpec[] = [
  { command: 'view.toggleViewMode', group: 'view', when: hasScore },
  { command: 'view.toggleMultitrack', group: 'view', when: hasScore },
  { command: 'view.zoomIn', group: 'view', when: hasScore },
  { command: 'view.zoomOut', group: 'view', when: hasScore },
  { command: 'view.zoomReset', group: 'view', when: hasScore },
  { command: 'view.followPlayback', group: 'view', when: hasScore },
  { command: 'file.print', group: 'export', when: hasScore },
  { command: 'file.new', group: 'edit', modes: play, when: noScore },
  { command: 'file.open', group: 'edit', modes: play, when: noScore },
  { command: 'library.importFiles', group: 'edit', modes: play, when: noScore },
  { command: 'library.show', group: 'view', modes: play, when: noScore },
];

/** The shell's own surfaces: the header, the right panel's tabs and rail, and the score's empty paper. */
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
      { command: 'app.settings', group: 'properties', when: onHeader('band') },
      { command: 'view.toggleTheme', group: 'properties', when: onHeader('band') },
    ],
  },
  {
    surface: 'status.segment',
    items: [
      { command: 'file.save', group: 'edit', when: onStatus('saved') },
      { command: 'file.saveAs', group: 'edit', when: onStatus('saved') },
      { command: 'file.export', group: 'export', when: onStatus('saved') },
      { command: 'sounds.show', group: 'view', when: onStatus('sound') },
      { command: 'library.show', group: 'view', when: onStatus('library') },
      // The edit state's items are editing commands, so the segment's menu is edit mode's alone.
      { command: 'editor.toggleInsertMode', group: 'edit', when: onStatus('edit') },
      { command: 'editor.editVoice1', group: 'edit', when: onStatus('edit') },
      { command: 'editor.editVoice2', group: 'edit', when: onStatus('edit') },
      { command: 'editor.durationLonger', group: 'note', when: onStatus('edit') },
      { command: 'editor.durationShorter', group: 'note', when: onStatus('edit') },
      { command: 'editor.toggleDot', group: 'note', when: onStatus('edit') },
      { command: 'editor.toggleTriplet', group: 'note', when: onStatus('edit') },
      { command: 'view.zoomIn', group: 'view', when: onStatus('zoom') },
      { command: 'view.zoomOut', group: 'view', when: onStatus('zoom') },
      { command: 'view.zoomReset', group: 'view', when: onStatus('zoom') },
      { command: 'view.toggleViewMode', group: 'view', when: onStatus('zoom') },
    ],
  },
  { surface: 'panel.tab', items: panelItems },
  { surface: 'panel.rail', items: panelItems },
  { surface: 'score.paper', items: paperItems },
];
