# Transport

The bar in the footer: play and stop, the position readout, tempo, loop, count-in, metronome and master volume.

- **Commands first.** Every button and toggle runs a command from `commands.ts` through `useCommand`, so a click, its shortcut and the palette share one path, and tooltips and `aria-keyshortcuts` come from the registry. Sliders and the BPM field carry values and call the audio service directly; their discrete steps are commands.
- **Position never goes through React state.** The engine writes `playback.position` every animation frame. `startPositionReader` (`state/position-reader.ts`) coalesces that to one call per frame while playing and one per change otherwise, and the readout writes its spans' `textContent`. WP-053's cursor and WP-074's fretboard should read position the same way.
- **Tempo is one percent factor** over the song's written tempo map (`audio.setTempo('percent', p)`). The BPM field is a view of it at the playhead: `round(written × p / 100)`, and typing a BPM sets `p` from the written tempo there. Time is the song's own clock at the written tempo, whatever the speed. The speed resets to 100% for a different song and comes back for the same file reopened in the session.
- **Master volume** is `settings.masterVolume` and `audio.setMasterVolume(volume)` (0 to 1, on the sampler's master bus, so it scales the metronome too). WP-052's mixer binds the same field and method.
- **Preferences** (count-in, metronome on and volume, master volume) persist in `localStorage` under `reprise.transport`; WP-060 moves them into Dexie's `settings` table. Tempo and loop are per song and are not persisted.
