# Editor

**Owner**: the score lane (`[P:score]`, with `packages/layout`). **Filled by**: WP-080 (hit-testing
and selection model), WP-081 (note entry), WP-082 (effects palette), WP-083 (bar and track
management), WP-084 (clipboard and undo UI), WP-085 (chord names, lyrics, transposition) and WP-086
(editor end-to-end).

Today it holds only what the lead added in WP-056:

| Export                          | What it is                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `editorCommands` (`./commands`) | `editor.toggleMode` ("Toggle edit mode"), which flips `editing` while a score is open. |

## What it can rely on

- `editing` (`state/editing.ts`): the edit-mode flag, `editing`, `setEditing` and `toggle`. It is off
  at the start of every document. Read it to switch clicks from seeking to editing.
- `selection` (`state/selection.ts`) for the current track and bar range. The edit cursor and range
  selection of WP-080 extend it, which is a contract change for the lead (#203).
- `document.apply(command)` for every edit, so each is one undo step through the history.
- `audio.previewTrack`, and `previewNote` once #204 exposes it through the audio service, so an entry sounds.

Entry state that no other feature reads (duration, voice, insert versus overwrite) belongs to a
store under this folder. The edit cursor does not: WP-080 says it goes in the selection store, which
the lane may not edit, so WP-080 opens a `type:contract` issue for the lead before it adds the
cursor.
