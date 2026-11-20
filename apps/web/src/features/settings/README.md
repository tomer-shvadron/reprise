# Settings

The Settings dialog (⌘, or Ctrl+,, "Settings…" in the palette and the desktop menu): a vertical list of sections on the left, the section's rows on the right. Owner lane: app. Work packages: #343 (the shell and the first sections), #344 (Keyboard), #346 (Sounds), #347 (Notation).

- **Changes apply at once.** There is no OK or Cancel; every control writes its handle through `services.settings`, which persists it ([architecture.md](../../../../../docs/specs/architecture.md), "Changed by #343"). Each section has a "Restore defaults" button that resets the keys in its `settings` list.
- **The shell never changes for a new section.** `app/settings-sections.ts` lists them in order; `checkSections` throws on a repeated id or a key two sections reset.
- **`openSettings(section?)`** (on the ui store) opens the dialog at a section id. An unknown or absent id shows the first.

## Adding a section

1. Define the handles in your own folder with `defineSetting` from `@/state/settings`. Keys are dotted camelCase (`score.defaultZoom`), unique app-wide, and are the Dexie row key.
2. Add a sample for each key to `SAMPLES` in `features/library/db/settings-backend.test.ts`, and your handles to what `REGISTERED` lists; the relaunch test fails with "add a sample for `<key>`" until you do.
3. Write the section: `{ id, title, settings, Component }`, composing `SwitchSetting`, `ChoiceSetting` and `SliderSetting` from `setting-rows.tsx` (the label is the control's accessible name, so tests use `getByRole('switch', { name: 'Count-in' })`), and export it from your feature's `index.ts`.
4. Add it to `SETTINGS_SECTIONS` in `app/settings-sections.ts`.
5. If the value must reach something that is not React (the ui store, the audio service), apply it from an `install*` function in `app/`, subscribing to the handle, as `install-view-defaults.ts` does.
