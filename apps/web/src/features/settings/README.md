# Settings

The Settings dialog (⌘, or Ctrl+,, "Settings…" in the palette and the desktop menu): a vertical list of sections on the left, the section's rows on the right. Owner lane: app. Work packages: #343 (the shell and the first sections), #344 (Keyboard), #346 (Sounds), #347 (Notation).

- **Changes apply at once.** There is no OK or Cancel; every control writes its handle through `services.settings`, which persists it ([architecture.md](../../../../../docs/specs/architecture.md), "Changed by #343"). Each section has a "Restore defaults" button that resets the keys in its `settings` list.
- **The shell never changes for a new section.** `app/settings-sections.ts` lists them in order; `checkSections` throws on a repeated id or a key two sections reset.
- **`openSettings(section?)`** (on the ui store) opens the dialog at a section id. An absent id shows the section shown last (the first, on the first open); an unknown id shows the first.

- **Escape inside a section.** Radix closes the dialog on Escape in the capture phase. A control that handles Escape itself (the Keyboard section's key recorder and its swap prompt) carries `data-escape-local`, and the dialog's `onEscapeKeyDown` leaves it to that control, as `app-sheet.tsx` does with `data-sheet-escape-local`.
- **Keyboard** (`sections/keyboard/`) needs a `CommandSourceContext` above the dialog, for the registry and the platform; `App` and the dialog test provide it.

## Adding a section

1. Define the handles in your own folder with `defineSetting` from `@/state/settings`. Keys are dotted camelCase (`score.defaultZoom`), unique app-wide, and are the Dexie row key.
2. Add a sample for each key to `SAMPLES` in `src/test/setting-samples.ts`. `REGISTERED` there gathers the handles from `SETTINGS_SECTIONS` by itself, so the relaunch test and the restore-defaults test (which also checks that your `settings` list is exactly the handles your controls show) cover them; both fail with "add a sample for `<key>`" until you do.
3. Write the section: `{ id, title, settings, Component }`, composing `SwitchSetting`, `ChoiceSetting` and `SliderSetting` from `setting-rows.tsx` (the label is the control's accessible name, so tests use `getByRole('switch', { name: 'Count-in' })`), and export it from your feature's `index.ts`.
4. Add it to `SETTINGS_SECTIONS` in `app/settings-sections.ts`.
5. If the value must reach something that is not React (the ui store, the audio service), apply it from an `install*` function in `app/`, subscribing to the handle, as `install-view-defaults.ts` does.
