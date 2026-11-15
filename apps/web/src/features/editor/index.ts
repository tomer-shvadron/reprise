// WP-081 adds the entry handling to the cursor, range and edit overlays WP-080 provides.
export { editorCommands, type EditorCommandId } from './commands';
export { cursorFromHit, locate, stringAt, type EditHit } from './locate';
export {
  clampString,
  cursorAtPosition,
  cursorAtTick,
  cursorTick,
  firstStop,
  reconcile,
  resolveCursor,
  stopCount,
} from './cursor';
export { cursorOnTrack, move, movePage, moveString, moveTrack, type Step } from './navigation';
export {
  barRangeOf,
  editTarget,
  endOf,
  extendBeatsTo,
  extendRange,
  extendRangeTo,
  rangeBars,
  rangeBetween,
  rangeBeats,
  rangePatch,
  rangeSpan,
  type ExtendStep,
  type RangeSpan,
  type RangeVoice,
} from './range';
export { caretBoxes, caretRect, rangeBoxes } from './geometry';
export { createEditPointer, type EditPointerDeps } from './edit-pointer';
export { installEditor } from './install-editor';
export { navigationCommands, type NavigationCommandId } from './navigation-commands';
export { useEditOverlays, useEditOverlaysFor } from './use-edit-overlays';
export { visibleTracks } from './visible';
export { commitEdit, landingCursor, type CommitDeps } from './commit';
export { describeRefusal } from './refusal';
export { createEntryStore, type EntryMode, type EntryState, type EntryStore } from './entry-store';
export {
  TWO_DIGIT_MS,
  entryController,
  installEntry,
  type EntryController,
  type EntryDeps,
} from './entry-controller';
export { planAppendBar, planEntry, roomLeft, type EntryAction, type EntryPlan } from './entry';
export { rhythmLabel, type Rhythm } from './rhythm';
export { EditStatusLine, type EditStatusLineProps } from './status-line';
