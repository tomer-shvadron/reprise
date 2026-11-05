# Fixture licenses

Every file in this directory comes from the test data of [alphaTab](https://github.com/CoderLine/alphaTab),
taken unmodified from tag `v1.8.4`, commit `022a45c8e42370f9e12e68949d11eada370da83d`, matching the
`@coderline/alphatab@1.8.4` oracle that describes them. alphaTab is licensed under the Mozilla Public
License 2.0; a copy is in [`MPL-2.0.txt`](MPL-2.0.txt), and the source form of each file is at the URL
in the table.

**Provenance.** Each file is one of alphaTab's own small feature tests: its score metadata carries no
title, artist, transcriber or copyright (checked with alphaTab), except `Effects` as the title of the
`effects` files. Files in alphaTab's test data that are transcriptions of real songs or carry a
third-party transcriber (`fade-to-black.gp4`, `nightwish.gp5`, `canon.gp5`, `serenade.*`,
`chord-name-overflow.gp5`, `orphan-tempo-automation.gp`, `visual-tests/special-tracks/grand-staff.gp`,
`full-song.*`, and others) were deliberately left out.

**TuxGuitar** ([helge17/tuxguitar](https://github.com/helge17/tuxguitar), LGPL) was checked at
`master`, commit `9f2647dfc216401cc70569f1ab25ad03e18cab5b`: its test resources are TuxGuitar's own
`.tg` format only, with no Guitar Pro files, so nothing is taken from it.

| Fixture                                        | Source (alphaTab, MPL-2.0)                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gp3/effects.gp3`                              | [`guitarpro3/effects.gp3`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro3/effects.gp3)                                                           |
| `gp3/notes.gp3`                                | [`guitarpro3/notes.gp3`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro3/notes.gp3)                                                               |
| `gp3/time-signatures.gp3`                      | [`guitarpro3/time-signatures.gp3`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro3/time-signatures.gp3)                                           |
| `gp4/colors.gp4`                               | [`guitarpro4/colors.gp4`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro4/colors.gp4)                                                             |
| `gp4/effects.gp4`                              | [`guitarpro4/effects.gp4`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro4/effects.gp4)                                                           |
| `gp4/notes.gp4`                                | [`guitarpro4/notes.gp4`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro4/notes.gp4)                                                               |
| `gp4/time-signatures.gp4`                      | [`guitarpro4/time-signatures.gp4`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro4/time-signatures.gp4)                                           |
| `gp5/bass-tuning.gp5`                          | [`guitarpro5/bass-tuning.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/bass-tuning.gp5)                                                   |
| `gp5/chords.gp5`                               | [`guitarpro5/chords.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/chords.gp5)                                                             |
| `gp5/directions.gp5`                           | [`guitarpro5/directions.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/directions.gp5)                                                     |
| `gp5/effects.gp5`                              | [`guitarpro5/effects.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/effects.gp5)                                                           |
| `gp5/key-signatures.gp5`                       | [`guitarpro5/key-signatures.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/key-signatures.gp5)                                             |
| `gp5/percussion-all.gp5`                       | [`guitarpro5/percussion-all.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/percussion-all.gp5)                                             |
| `gp5/repeat-close-alternate-endings.gp5`       | [`guitarpro5/repeat-close-alternate-endings.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/repeat-close-alternate-endings.gp5)             |
| `gp5/staves.gp5`                               | [`guitarpro5/staves.gp5`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro5/staves.gp5)                                                             |
| `gpx/chords.gpx`                               | [`guitarpro6/chords.gpx`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro6/chords.gpx)                                                             |
| `gpx/effects.gpx`                              | [`guitarpro6/effects.gpx`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro6/effects.gpx)                                                           |
| `gpx/key-signatures.gpx`                       | [`guitarpro6/key-signatures.gpx`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro6/key-signatures.gpx)                                             |
| `gpx/layout-configuration-multi-track-all.gpx` | [`guitarpro6/layout-configuration-multi-track-all.gpx`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro6/layout-configuration-multi-track-all.gpx) |
| `gpx/repeat-close-alternate-endings.gpx`       | [`guitarpro6/repeat-close-alternate-endings.gpx`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro6/repeat-close-alternate-endings.gpx)             |
| `gp/beat-lyrics.gp`                            | [`guitarpro7/beat-lyrics.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro7/beat-lyrics.gp)                                                     |
| `gp/beat-tempo-change.gp`                      | [`guitarpro8/beat-tempo-change.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro8/beat-tempo-change.gp)                                         |
| `gp/drum-tabs.gp`                              | [`visual-tests/special-tracks/drum-tabs.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/visual-tests/special-tracks/drum-tabs.gp)                       |
| `gp/multivoice-rhythm.gp`                      | [`visual-tests/guitar-tabs/multivoice-rhythm.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/visual-tests/guitar-tabs/multivoice-rhythm.gp)             |
| `gp/sustain.gp`                                | [`visual-tests/effects-and-annotations/sustain.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/visual-tests/effects-and-annotations/sustain.gp)         |
| `gp/timer.gp`                                  | [`guitarpro8/timer.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro8/timer.gp)                                                                 |
| `gp/track-volume.gp`                           | [`guitarpro7/track-volume.gp`](https://github.com/CoderLine/alphaTab/blob/022a45c8e42370f9e12e68949d11eada370da83d/packages/alphatab/test-data/guitarpro7/track-volume.gp)                                                   |

Fixtures are data: nothing reads them except a parser. Adding one means fetching it from an open
source, checking through alphaTab that its score metadata, track names and beat text or lyrics name
no song, artist or transcriber (`strings` cannot see inside gpx and gp), adding its row here, and
running `pnpm fixtures:describe`; commercial tabs never belong here (they go in `local-tabs/`).
