# Editor

**Owner**: the score lane (`[P:score]`, with `packages/layout`). **Filled by**: WP-080 (hit-testing
and selection model), WP-081 (note entry), WP-082 (effects palette), WP-083 (bar and track
management), WP-084 (clipboard and undo UI), WP-085 (chord names, lyrics, transposition) and WP-086
(editor end-to-end).

What it holds, after WP-056 (the mode toggle) and WP-080 (hit-testing and the selection model):

| Export                                                              | What it is                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorCommands` (`./commands`)                                     | `editor.toggleMode` and the navigation commands below.                                                                                                                                |
| `locate`, `cursorFromHit`, `stringAt`                               | A pointer event to an `EditHit` (track, bar, voice, staff, beat or end slot, note, string, grace) and the cursor it puts down (`locate.ts`).                                          |
| `resolveCursor`, `reconcile`, `cursorAtTick`, ...                   | Cursor indices from ids with the `at` fallback, the store patch that keeps cursor, range and picked ids valid after an edit or undo, and the cursor at a bar and onset (`cursor.ts`). |
| `move`, `moveString`, `moveTrack`, `movePage`                       | Pure cursor moves over a voice's stops (`navigation.ts`).                                                                                                                             |
| `rangeSpan`, `rangeBeats`, `rangeBars`, `extendRange`, `editTarget` | The time span of an `EditRange`, the beats it covers, its bars, extending it and the one selection a command acts on (`range.ts`).                                                    |
| `caretBoxes`, `rangeBoxes`, `caretRect`                             | Overlay geometry in layout space (`geometry.ts`).                                                                                                                                     |
| `createEditPointer`                                                 | Click, Shift, Cmd/Ctrl and drag handling over the selection store (`edit-pointer.ts`).                                                                                                |
| `installEditor`                                                     | Keeps the cursor honest across edits, undo and track changes, and places it when edit mode turns on; `services.ts` calls it (`install-editor.ts`).                                    |
| `navigationCommands`                                                | The cursor commands, bound with `context: 'editing'` (`navigation-commands.ts`).                                                                                                      |
| `useEditOverlays`                                                   | The caret (editing only) and range boxes for the open score (`use-edit-overlays.ts`).                                                                                                 |

## The model, in short

- **Stops.** A voice's stops are its beats, then one end slot when the bar is not full; an empty voice has only the end slot. The cursor walks stops bar after bar, in its own track and voice (`EditCursor.at.beat` indexes them).
- **The cursor holds ids** (`track`, `masterBar`, `beat`), so an edit, undo or redo leaves it on its beat. `reconcile` runs on each edit: a removed beat moves it to the stop at the old index, a removed bar to the first stop of the bar at the old index, a removed track to the current track; the string is clamped; a range end whose beat is gone widens to its bar, and one whose bar or track is gone clears the range. Undo restores a beat with its id, but the cursor has already moved to a beat that exists and stays there.
- **A click** resolves through `locate`: a note anchor gives its note, string and beat (a grace note maps to its parent beat); a beat anchor gives the beat, with the string read from the tab line nearest the click (`stringAt`: `clamp(round((y - top) / spacing) + 1, 1, n)` on the track's tab staff in that system, `n` the tuning length), or the cursor's string on a standard staff; a gap in a track's bar gives the nearest beat by x, or the end slot past the last one; the clef area gives the staff's first stop; a margin or gap between systems gives the nearest column's bar in the current track. Everything is in layout space, so paged, continuous and split systems share one path.
- **Ranges** compare `(bar index, tick in bar)` pairs, never absolute ticks, so pickups and over-full bars need no case. A `beats` range covers every voice of the tracks between its ends, from the earlier onset to the end of the later beat; a `bars` range takes whole master bars. Each write goes through `rangePatch`, which keeps the transport's `bars` and `barsAnchor` in step.
- **`editTarget`** is what a command acts on: the range's beats, else the picked notes, else the note on the cursor's beat and string, else the cursor's beat, else nothing.
- **Mouse**: a click places the cursor, picks the note under it and, in the app, seeks a stopped playhead to it; Shift+click extends a beat range from the cursor; Cmd/Ctrl+click toggles a note in the picked set; a drag makes a range (previewed, restored on cancel); a press in a column's own area, above the staves where the bar number sits, takes whole bars.
- **Keyboard** (edit mode only, `context: 'editing'`): arrows move by stop and string, Home and End by bar, Ctrl/Cmd with them by bar and score, PageUp and PageDown by system (a continuous layout's segment), Shift extends a beat range (up and down by track), Ctrl/Cmd+Shift extends by bar, Escape clears the range and picked notes. A plain move clears both. The full list is in [keyboard-shortcuts.md](../../../../../docs/reference/keyboard-shortcuts.md).
- **Demo**: `/dev/score?edit=1` (see the score demo's README for how to serve it; it takes the same `fixture`, `mode` and `notation` parameters) mounts `demo/edit-demo.tsx`, the cursor and range over a fixture or the long score with no app around it.

## What it can rely on

- `editing` (`state/editing.ts`): the edit-mode flag, `editing`, `setEditing` and `toggle`. It is off
  at the start of every document. Read it to switch clicks from seeking to editing.
- `selection` (`state/selection.ts`) for the current track, the edit cursor, the range and the picked notes, written only through `setEdit`.
- `document.apply(command)` for every edit, so each is one undo step through the history.
- `audio.previewTrack`, and `previewNote` once #204 exposes it through the audio service, so an entry sounds.

Entry state that no other feature reads (duration, voice, insert versus overwrite) belongs to a store under this folder; the edit cursor does not, it lives in the selection store.
