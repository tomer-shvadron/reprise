// The cursor, range and edit overlays (WP-080) and note entry (WP-081).
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
export { entryCommands, type EntryCommandId } from './entry-commands';
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
export { trackEditCommands, type TrackEditCommandId } from './track-commands';
export { EditorDialogs } from './editor-dialogs';
export { AddTrackButton, TrackRowMenu } from './track-menu';
export { createNewSong, startNewSong } from './new-song';
export { whenSaved } from './when-saved';
export { UnsavedChangesDialog } from './unsaved-dialog';
export { barCommands, type BarCommandId } from './bar-commands';
export { MasterBarDialog } from './master-bar-dialog';
export { barTarget, planDeleteBars, planInsertBar, type BarTarget } from './bar-edit';
export { masterBarEdits, formFromScore, type MasterBarForm } from './master-bar-form';
