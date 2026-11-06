import type { StaffType, TiedNotes } from '../types';
import { placeholderModule } from './placeholder';
import type { StaffModule } from './staff-module';
import { tabModule } from './tab';

export const STAFF_MODULES: Readonly<Record<StaffType, StaffModule>> = {
  tab: tabModule(),
  standard: placeholderModule('standard'),
  percussion: placeholderModule('percussion'),
};

/** The layout options a module draws by. */
export interface StaffDisplay {
  tiedNotes: TiedNotes;
}

/** The module for a staff type: the tab module is built from the display options, the others are fixed. */
export function staffModule(type: StaffType, display: StaffDisplay): StaffModule {
  return type === 'tab' ? tabModule(display) : STAFF_MODULES[type];
}

export type * from './staff-module';
