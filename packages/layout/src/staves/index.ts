import type { StaffType } from '../types';
import { placeholderModule } from './placeholder';
import type { StaffModule } from './staff-module';
import { tabModule } from './tab';

export const STAFF_MODULES: Readonly<Record<StaffType, StaffModule>> = {
  tab: tabModule(),
  standard: placeholderModule('standard'),
  percussion: placeholderModule('percussion'),
};

export type * from './staff-module';
