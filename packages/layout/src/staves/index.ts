import type { StaffType } from '../types';
import { placeholderModule } from './placeholder';
import type { StaffModule } from './staff-module';

export const STAFF_MODULES: Readonly<Record<StaffType, StaffModule>> = {
  tab: placeholderModule('tab'),
  standard: placeholderModule('standard'),
  percussion: placeholderModule('percussion'),
};

export type * from './staff-module';
