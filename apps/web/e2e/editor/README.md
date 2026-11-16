# Editor flows

End-to-end flows of the editor, in the same Playwright Test suite as the player flows ([`../player/README.md`](../player/README.md)): one config, one worker, the production build in the Chromium headless shell ([ADR-0025](../../../../docs/decisions/0025-end-to-end-on-the-web-build-in-chromium.md)). `pnpm e2e editor/` runs only these. The rules there hold here too, above all that a test waits on app state and never on time.

The specs import the `app` fixture, `expect` and the generated scores from `../player/test/`; nothing is copied. What is specific to editing is in `test/`:

- `editor.ts`: `palette()` runs a command and returns once keys reach the page again (Radix keeps the palette's input focused through its close animation); `savedToLibrary()` runs a Save and reads the score from `library/songs/<id>.reprise`, where a new song's first Save puts it; `saveAndRead()` does the same for a file opened in place.
- `riff.ts`: the `Riff` builder, which records the keys of a typed riff and the bars they must produce.
- `score-shape.ts`: `shapeOf`, a score's musical content without ids and defaults.

## What a flow can observe

No page hook is needed. Read the status line (`edit-status`), the History region (its `option` rows, `aria-current="step"`, the Undo and Redo buttons), the Effects panel's `aria-pressed`, a dialog's `role="alert"`, `app.description()` for the bar count, saved bytes (after `waitForWrite`) and exported bytes. A control without an accessible name gets an `aria-label` in `features/editor`, never a `window` hook.

## Fixtures

Songs typed in the app, the generated `song.reprise` and `song.gp`, and the committed fixtures only; never `local-tabs/`. Compare a round trip through gp on the fields the flow touched (see `chosenFields` in `round-trip.spec.ts`), not whole scores: a gp file normalises ids and defaults.

## Specs

| Spec            | What                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `new-song`      | New song from the palette, and the first Save into the library                                                |
| `note-entry`    | A sixteen-bar riff from the keyboard alone, one undo step per entry                                           |
| `bar-structure` | A song built from the bar dialogs, saved with its repeats, endings and jumps, and played in order             |
| `clipboard`     | A four-bar cross-track paste is one History row, and one undo restores the score and the cursor               |
| `round-trip`    | WP-086's chain: effects, bars, a paste, History undo and redo, a gp export and its reopening, on a typed riff |
