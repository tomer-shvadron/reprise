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
export { trackEditCommands, type TrackEditCommandId } from './track-commands';
export { EditorDialogs } from './editor-dialogs';
export { AddTrackButton, TrackRowMenu } from './track-menu';
export { createNewSong, startNewSong } from './new-song';
export { UnsavedChangesDialog } from './unsaved-dialog';
