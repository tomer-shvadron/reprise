import type { MenuTarget } from '@/state/menu-target';

import type { AppServices } from '../services';
import type { RegisteredCommandId } from '../use-command';

/** Practice mode (#341) counts as `play`; it can widen this if it wants a menu of its own. */
export type MenuMode = 'play' | 'edit';

export const MENU_SURFACES = [
  'score.note',
  'score.beat',
  'score.bar',
  'score.range',
  'score.section',
  'score.chord',
  'score.paper',
  'track.row',
  'mixer.strip',
  'mixer.master',
  'transport.loop',
  'transport.tempo',
  'transport.countIn',
  'transport.metronome',
  'panel.tab',
  'panel.rail',
  'dock.tab',
  'fretboard',
  'header',
  'status.segment',
  'library.song',
  'sounds.pack',
] as const;
export type MenuSurface = (typeof MENU_SURFACES)[number];

/** The display order of the groups; a separator sits between two non-empty ones. */
export const MENU_GROUPS = [
  'play',
  'practice',
  'edit',
  'note',
  'effects',
  'beat',
  'bar',
  'clipboard',
  'track',
  'view',
  'export',
  'properties',
  'danger',
] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];

/** What an item's predicates and label read: the services, what was clicked and the mode. */
export interface MenuContext {
  services: AppServices;
  target: MenuTarget;
  mode: MenuMode;
}

export interface MenuItemSpec {
  /** The command, or platform twins (`...Mac`, `...Windows`): the first one bound on this platform shows its keys. */
  command: RegisteredCommandId | readonly RegisteredCommandId[];
  group: MenuGroup;
  /** Defaults: `['edit']` for a `context: 'editing'` command, else both modes. Listing `play` for an editing command throws. */
  modes?: readonly MenuMode[];
  /** Defaults to the command's title. */
  label?: string | ((at: MenuContext) => string);
  /** False hides the item. */
  when?: (at: MenuContext) => boolean;
  /** Renders a checkbox item with this state. */
  checked?: (at: MenuContext) => boolean;
}

export interface MenuContribution {
  surface: MenuSurface;
  items: readonly MenuItemSpec[];
}

/** What a surface asks the host to open. */
export interface MenuRequest {
  surface: MenuSurface;
  target: MenuTarget;
  /** The menu's accessible name: "Bar 12", "Track Lead guitar". */
  label: string;
  /** Where a keyboard open puts the menu; defaults to the focused element's bottom-left corner. */
  anchor?: DOMRect;
}

/** The score's levels nest: a menu on a note also offers its beat's and its bar's items. */
export const SURFACE_PARENTS: Partial<Record<MenuSurface, readonly MenuSurface[]>> = {
  'score.note': ['score.beat', 'score.bar'],
  'score.chord': ['score.beat', 'score.bar'],
  'score.beat': ['score.bar'],
  'score.section': ['score.bar'],
};

/** The title of the submenu a parent level becomes in edit mode. */
export const SURFACE_SUBMENU_TITLES: Partial<Record<MenuSurface, string>> = {
  'score.beat': 'Beat',
  'score.bar': 'Bar',
};
