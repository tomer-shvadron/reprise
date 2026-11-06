import type { LayoutSink } from '../../primitives';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import type { TabBar, TabOptions } from './analysis';

/** What drawing one tab bar needs at hand. */
export interface TabContext {
  input: StaffBar;
  placement: StaffBarPlacement;
  sink: LayoutSink;
  options: TabOptions;
  analysed: TabBar;
  space: number;
}

export function lineY({ placement }: TabContext, string: number): number {
  return placement.top + (string - 1) * placement.geometry.lineSpacing;
}
