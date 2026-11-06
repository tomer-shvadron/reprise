import type { StaffType } from '../types';
import { placeholderModule } from './placeholder';
import { percussionModule, standardModule } from './standard';
import type { StaffModule } from './staff-module';

export const STAFF_MODULES: Readonly<Record<StaffType, StaffModule>> = {
  tab: placeholderModule('tab'),
  standard: standardModule(),
  percussion: percussionModule(),
};

export type * from './staff-module';
