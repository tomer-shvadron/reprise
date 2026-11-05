# Scope for v1

The 80/20 cut of each product. "v1" is what ships at the release checkpoint. "Deferred" is agreed as wanted but not in v1. "Dropped" is agreed as out, so nobody re-litigates it by accident.

## Player

| v1                                                                                                                                                                              | Deferred                                        | Dropped                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| Transport: play, pause, stop, click any bar to seek, cursor following the music with auto-scroll, space bar toggles play                                                         | Audio export to wav or mp3                      | Live audio input through an amp sim   |
| Tempo as absolute BPM or as a percentage of the written tempo, roughly 25% to 200%, with no pitch change                                                                         | Per-track effects editing beyond preset choice  | Video or audio backing-track sync     |
| Loop a selected bar range                                                                                                                                                       | Virtual piano keyboard view for keyboard tracks | RSE-style band accompaniment generators |
| Count-in bar, toggleable on or off                                                                                                                                              |                                                 |                                       |
| Metronome with its own volume                                                                                                                                                   |                                                 |                                       |
| Mixer: volume, pan, mute and solo per track, master volume, per-track instrument sound override                                                                                 |                                                 |                                       |
| Correct playback of real files: tempo, time-signature and key-signature changes mid-song, repeats with alternate endings, D.S., D.C. and coda jumps                             |                                                 |                                       |
| Note effects rendered and heard: bends, slides, hammer-ons and pull-offs, vibrato, palm mute, let ring, natural and artificial harmonics, dead notes, tapping, tremolo picking, trills, grace notes, ties, dots, tuplets, rests |                                                 |                                       |
| Section markers for navigation, chord names and diagrams where the file has them, lyrics                                                                                         |                                                 |                                       |
| Paged layout and continuous horizontal scroll, zoom, all-tracks or single-track view                                                                                            |                                                 |                                       |
| Live fretboard view highlighting the notes being played on the selected track                                                                                                   |                                                 |                                       |
| Sound tiers: GM pack for every track out of the box, per-track switch to an HQ pack once downloaded, default effects preset derived from the track's GM program                  |                                                 |                                       |
| Printing                                                                                                                                                                        |                                                 |                                       |

## Trainer

| v1                                                                                                                           | Deferred                                   | Dropped                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Speed trainer: pick a loop range, start tempo, step every N repetitions, target tempo                                         | Scale and arpeggio overlay on the fretboard | Rocksmith-style note detection and scoring    |
| Tuner using the built-in mic, cents offset display, reference from the current track's tuning and capo                        | Chord library and chord lookup             |                                               |
| Standalone metronome with BPM, time signature and downbeat accent, usable without a song open                                 | Practice goals and streaks                 |                                               |
| Practice log per song: time spent, loops worked on, highest clean tempo per section, shown on the song's page in the library | Recording yourself alongside playback      |                                               |

## Editor

| v1                                                                                                                                                       | Deferred                                                    | Dropped |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- |
| Track management: add, remove, reorder; properties: name, instrument, string count and tuning, capo, color                                               | Custom bend curve editor with drag points                   | None    |
| Bar management: insert and delete bars, time signature, key signature, tempo marks, repeats and alternate endings, section markers                        | Chord diagram editor                                        |         |
| Guitar Pro style note entry: cursor on string and beat, type fret number, arrow keys move, keys for duration, rest, dot, tie, tuplet; mouse click works too; the note sounds when entered | Drum track editing (drums are read and played in v1)        |         |
| All player note effects applied from keyboard or a palette; bends limited to presets: quarter, half, full, with or without release                       | Editing voices three and four                               |         |
| Two voices per track editable; four stored                                                                                                               | Automation lanes for volume, pan and tempo curves           |         |
| Copy, cut and paste of beats and bars across tracks                                                                                                      | Manual overrides of stem direction and beaming              |         |
| Unlimited undo and redo                                                                                                                                  | Page layout customization: margins, fonts, spacing          |         |
| Chord names as text above a beat; lyrics as text aligned to beats                                                                                        | Engraving extras such as ossia staves and cue notes         |         |
| Move a selection up or down a string; transpose a selection by semitones                                                                                 |                                                             |         |
| Autosave of drafts for crash recovery                                                                                                                    |                                                             |         |

## Formats

| v1                                             | Deferred            | Dropped                         |
| ---------------------------------------------- | ------------------- | ------------------------------- |
| Read gp3, gp4, gp5, gp, gpx                    | Export gp5          | Write gpx, gp3, gp4             |
| Save native `.reprise`                         | MusicXML read/write | MIDI import                     |
| Export gp with a lossy-export warning          |                     | ASCII tab import                |

## Platform and app

| v1                                                                 | Deferred                 | Dropped                 |
| ------------------------------------------------------------------ | ------------------------ | ----------------------- |
| macOS build, unsigned                                              | Code signing and notarization | Phone and tablet   |
| Windows build in CI                                                | Auto-update              | Touch editing           |
| Library with import, search, sort, recent, open-without-import     | Linux build              | Telemetry               |
| Dark theme default, light theme                                    | Localization             |                         |
| Command palette and full keyboard shortcut map                     |                          |                         |
| Sound pack manager with downloads and license display              |                          |                         |
