# Player checklist

The real-file correctness pass (WP-054, #50): what to run, look at and listen for before a checkpoint is declared. Part A is automated by `pnpm check:files`; Parts B and C need ears, eyes and, for C, Guitar Pro; Part D turns findings into issues. Run it at each checkpoint: the player now, then the editor and the release.

## Before you start

- `pnpm install` and `pnpm sounds:fetch` (the audio check renders through GeneralUser GS and without it, locally, the audio column is `skipped` with one note, `audio skipped: run \`pnpm sounds:fetch\``, and the exit code ignores it; on CI, where `CI` is set, the run stops with one line and exit code 1).
- Put tabs in `local-tabs/`, in subfolders if you like. They are never committed, and never named in an issue, a PR or a comment: the repository is public. The pass itself never names them either: a local tab is `local-3` with the start of its SHA-256 (`local-3 (sha256 1a2b3c4d5e6f)`), and no report, draft or output line carries its file name, title, artist, track names, lyrics or any other text from it. Numbers follow the files' order, so they shift when you add a tab; the hash does not (`find local-tabs -type f -exec shasum -a 256 {} +` shows which file is which).

## Listening to a tab, step by step

This is Part B in short; the sections below say what each row means.

1. In a terminal in the repository folder, run `pnpm check:files local-tabs`. It takes about a minute for a few tabs and ends with `check:files passed.` or `check:files FAILED.`; either way the reports are written.
2. Open the reports folder. It is `.check-files/` in the repository folder, which Finder hides because its name starts with a dot: press Cmd+Shift+. in Finder to show it, or run `open .check-files` in the terminal.
3. Open `summary.md` and pick a tab from the table, for example `local-3 (sha256 1a2b3c4d5e6f)`.
4. Open its listening sheet, `.check-files/listening/local/<hash>.md` (the hash from step 3), and its report, `.check-files/local/local-3.md`. The sheet links to the report and to this checklist.
5. Start the app: run `pnpm dev` and open the address it prints (usually `http://localhost:5173`) in Chrome, or start the desktop app (`pnpm desktop:dev`, or the installed build from `apps/desktop/release/` after `pnpm desktop:build`). Open the tab with Cmd+O, or drag it from `local-tabs/` onto the window.
6. Press play and go down the sheet's rows from the top. For each row, listen and look at the bars it lists, then write `pass`, `fail` or `n/a` (the tab does not have it after all) in Result. For a fail, write the bar number and what you heard or saw in Note, for example "bar 12: the bend jumps instead of gliding". Each row's link says what wrong sounds or looks like.
7. When the sheet is done, send the lead the `fail` rows with the tab's label from step 3, never its name. The sheet is kept between runs, so you can stop and continue later.

## Part A: the automated pass

```sh
pnpm check:files                      # fixtures/ and local-tabs/
pnpm check:files local-tabs           # only your tabs
pnpm check:files local-tabs/song.gp5 --only audio   # one file, one project (formats, layout, audio)
```

Paths resolve against the directory you run it from. Folders are walked recursively for `.gp3`, `.gp4`, `.gp5`, `.gpx` and `.gp` files, in any case; an empty `local-tabs/`, or a missing one when you give no path, is reported and skipped, and the previous run's reports are cleared. A path you give that does not exist exits with code 2. The command exits 0 only when no check fails, crashes or leaves a known entry stale. CI runs `pnpm check:files fixtures` as the "Real-file pass" step and uploads `.check-files/` when it fails.

| Check | Where it runs | What it proves | What it cannot see |
| --- | --- | --- | --- |
| `read` | Node | The file reads through the app's own dispatcher with no `error`-severity warning. Records the version, counts, the features the listening sheet asks about, and a `.gp` export of our writer's output. | Whether what was read is what the author wrote; that is the oracle's job, and Guitar Pro's. |
| `oracle` | Node | The read matches alphaTab 1.8.4, except where `packages/formats/test/oracle/tolerances.ts` documents a difference. | Files alphaTab cannot read (skipped), and anything both readers get wrong the same way. |
| `order` | Node | The play order (repeats, voltas, jumps) matches alphaTab's MIDI generator, except for the documented deviations in the model README's "Deviations from alphaTab". | Whether alphaTab matches Guitar Pro; that is C1. |
| `tempo` | Node | Every pass lasts as long as alphaTab's, with the same tempo changes, except ramps, moved mid-beat changes and over-full bars. An over-full bar is explained only when it lasts exactly its longest voice here and its written length in alphaTab, which plays the overflow over the following bars (#121); its tempo changes inside the written length are still compared, and those past it on neither side. Runs only on an identical order. | How a ramp should sound. |
| `layout` | Chromium | On A4 pages in tab, standard and both: finite numbers, nothing outside the page or the margins, no overlapping anchors of one kind, no overlapping marks in a lane. | Collisions between voices' note heads or rests (#70), and anything inside a system that the anchors do not cover (#116). |
| `audio` | Chromium | A GM render with finite samples and no clipping, within the memory budget; every untied note of every pass reached the sampler sink once, on time to 1 ms; the sampler struck each one on its track within 1 ms (within its beat when a grace or a stroke moves it; a legato destination continues the previous voice); every strike found a region; every scheduled attack is audible. | Timbre, and whether an effect sounds right: that is Part B. Attack verification works on the whole mix, so a quiet note under a loud one can pass, and it tolerates isolated misses: 2 % of the attacks, at least 2 and at most 10. |

Statuses, worst first: **fail** (a violation no known entry accepts, or a crash), **known** (every violation is a known issue), **skipped** (the check could not run, for example when alphaTab cannot read the file), **explained** (a documented difference only), **pass**.

Reports go to `.check-files/` at the repository root, which is gitignored and wiped on each run except `listening/`:

- `summary.md`: a file × check status table, the totals, stale known entries and the draft issues. Start here.
- `<fixture path>.md` and `.json`, and `local/local-<n>.md` and `.json` for every other file: the per-file report: header, status table, each check's sections (read warnings, the play order as runs of bars, render facts) and its findings. A local file's report leaves out the reader's warning messages and shows only numbers in an oracle difference (text becomes `<text>`).
- `drafts/NN-<check>-<code>.md`: one draft `type:bug` issue per group of unknown violations, also printed at the end of the run.
- `listening/<fixture path>.md` and `listening/local/<hash>.md`: the sheet for Part B, created once and never overwritten; a local tab's is keyed by its hash, so it stays with the tab when the numbers shift.
- `exports/`: our writer's `.gp` output for each file (`local-<n>.gp` for a local one), for C4.

The known list is `scripts/check-files/known.ts`: each entry names its open issue and the fixtures it must fire on. When a run covers one of those fixtures and the entry no longer fires there, the run fails as stale; the PR that fixes the issue deletes its entry.

Attack verification compares the spectral flux at each scheduled attack (clusters merged within 30 ms) with the median flux of the surrounding second. A ratio of 1.5 or more is heard, 1.2 to 1.5 weak (reported only), below 1.2 missed; the check fails when more missed than 2 % of the clusters (at least 2, at most 10), or 3 in a row. The constants live in `packages/audio/src/test/real-file.ts` and may be retuned after the first local run, from the attack-ratio table `summary.md` prints for the local tabs. What they are calibrated on is thin:

- the fixtures' smallest ratio is 1.32, on the overdriven guitar of `multivoice-rhythm.gp` (6 of 37 weak), so the missed line has a 10 % margin there and the heard line is already crossed; the next are the `effects.*` files at 1.55;
- 10 of the 27 fixtures schedule no notes;
- only `track-volume.gp` has more than one sounding track, so nothing calibrates a band mix, which is what most local tabs are.

## Part B: listening and looking

Per tab, in the app, with its listening sheet open beside it; [the steps above](#listening-to-a-tab-step-by-step) say where everything is. The sheet has a row for B1, B2, B3 and B7 always, and one for each feature the file has, with the first bars that carry it.

**How to mark:** write `pass`, `fail` or `n/a` in Result. For a fail, put the bar and what you heard in Note. Send the lead the `fail` rows; for a local tab, give its label from `summary.md`, not its name.

### B1 Opens

The file opens and the score appears, with the tracks, their names and their instruments you expect.

Wrong if: an error appears instead of the score; a track is missing; a track plays as the wrong kind of instrument (a guitar part as a piano); or the **Import details** panel says something was lost and you can see it missing from the score.

### B2 Order

Play through the whole tab and watch the cursor at repeats, alternate endings (1., 2.) and jumps (D.C., D.S., To Coda, Fine). The report's "Play order" section lists the bars in the order they play, as runs: `1–8, 1–7, 9` means bars 1 to 8, then back to 1 to 7, then 9.

Wrong if: a section repeats too often or not at all, an ending is skipped or played on the wrong pass, a jump lands somewhere else, or the song stops early.

### B3 Tempo

Listen at the bars the sheet lists. The tempo field in the transport shows the current BPM.

Wrong if: the speed changes at a different bar or not at all, a gradual change (a ramp) jumps in one step, or the BPM shown does not follow what you hear.

### B4 Effects

| Effect | Listen for | Wrong if |
| --- | --- | --- |
| Bend, release, pre-bend | glides to the target within the note (full = a tone, half = a semitone); a release glides back; a pre-bend starts bent | it jumps, overshoots, never arrives, or stays flat |
| Whammy dive, dip, return | the whole beat's pitch moves smoothly by the written amount | no movement, or a step |
| Vibrato slight / wide | an even wobble; wide is clearly deeper | none, or erratic |
| Shift slide | glides into the next note, which is struck again | no glide |
| Legato slide | glides, and the next note is **not** struck again | struck again |
| Slide in or out (below, above, down, up) | a short glide into or out of the note | none |
| Hammer-on, pull-off | the second note sounds without a pick attack | picked again, or silent |
| Natural harmonic | a bell tone: 12th fret = octave, 7th = octave + fifth, 5th = two octaves | sounds as the fretted note |
| Artificial, pinch, tapped, semi harmonic | a glassy note at the written harmonic above the fret (A.H. +12 = an octave) | the fretted pitch or a wrong interval (C3) |
| Palm mute | short, damped | rings |
| Let ring | keeps sounding under later notes until the bar ends | cut short |
| Dead note | a percussive click with no pitch | pitched |
| Ghost note | clearly quieter | same level |
| Accent, heavy accent | louder; heavy is louder still | no change |
| Staccato | shortened | full length |
| Dynamics | the level steps at each mark | flat |
| Tremolo picking | rapid repeats at the written value | one long note |
| Trill | fast alternation with the written note | none |
| Grace notes | a quick note just before the beat (or on it, when written so) | full length or missing |
| Brush and arpeggio strokes | spread; down = low to high, up = high to low | struck together |
| Tapping, slapping, popping | play as notes; the GM tier has no special timbre | missing |
| Fade in, fade out, volume swell | volume ramps across the note | flat |
| Ties | one sustained note with no new attack; struck again after a repeat jump back | re-attacked mid-tie, or silent after the jump |
| Triplet feel | pairs played long-short | straight |
| Mixer changes | the instrument, volume or pan changes at the bar | no change |

### B5 Drums

Every piece sounds as itself; the audio report lists every GM note struck. Pay attention to the kick (MIDI 36 in files against 35 in the GP6 table), the ride bell and the cowbells (#76; compare in C2).

Wrong if: a piece is silent, or sounds as a different piece (a snare as a tom, a ride bell as a cymbal crash).

### B6 Tracks

The balance between tracks is sensible, pitched tracks without tab play at pitch, and the mute and solo flags stored in the file are respected.

Wrong if: one track drowns the others or cannot be heard, a piano or string part plays at the wrong pitch, or a track the file has muted plays.

### B7 Looking

In tab, standard and both:

- nothing overlaps: fret numbers, heads, rests, effect lanes, P.M. and let-ring dashes, chord names and diagrams, lyrics, tempo marks, sections, repeat and volta brackets;
- nothing is cut at a page edge;
- the cursor stays on screen while following.

Wrong if: two things are drawn on top of each other so you cannot read them, something runs off the page, or the cursor leaves the screen while playing.

Already known, so note them but do not report them again:

- two notes of the same pitch on different strings are drawn on top of each other in standard notation (#110);
- something drawn inside a system that the overlap check does not cover, such as a slur or a bend arrow, collides with another mark (#116);
- note heads or rests of two voices collide in standard notation (#70);
- after several quick bar jumps (Cmd+Right) the cursor is left off screen (#122).

## Part C: Guitar Pro comparisons (optional, needs Guitar Pro 7 or 8)

These need Guitar Pro 7 or 8; a trial installation is enough. They are optional owner checks: skip them without Guitar Pro, and say which were done when recording the run.

- **C1:** the play order of `fixtures/gp5/directions.gp5` and `fixtures/gp5/repeat-close-alternate-endings.gp5` against the report's Order section. The model README says the expander follows Guitar Pro where Guitar Pro and alphaTab differ.
- **C2:** a real gpx with drums: the kick (36 against 35), the ride bell (GM 59 against 53) and the cowbells (56) (#50, the WP-043 comment; #76).
- **C3:** a gp3 file with an artificial harmonic: the tab number and the pitch in Guitar Pro against Reprise (#76).
- **C4:** open `.check-files/exports/<file>.gp` for two or three songs: one with drums, one with a tuning-less pitched track such as piano, one with several tracks. Check that each opens, then the drum kit, the instruments and the page layout (#50, the WP-044 comment; the #71 review).
- **C5:** any GP4 file with chord diagrams: the report's `version` (400 or 406), and whether the diagrams match Guitar Pro's (#50, comment (b)).
- **C6:** an over-full bar, `fixtures/gp3/notes.gp3` (one bar) and bar 24 of `fixtures/gp5/effects.gp5` (ten quarter notes in a bar of eight), in Guitar Pro and in Reprise: does Guitar Pro stretch the bar to its longest voice and play every note, as Reprise does since #121, play the overflow over the following bars, as alphaTab does, or drop it? The model README's "Deviations from alphaTab" row calls Guitar Pro's behaviour unverified. Also a `.gp` export of a bar with a tempo change on an overflow beat (#123): does Guitar Pro apply the automation written at a `Position` past 1 at that beat? Ask the same of a program change at a `Position` past 1.

## Part D: from findings to issues

The lead files each draft after searching for a duplicate:

```sh
export GH_TOKEN="$(gh auth token --user tomer-shvadron)"
f=.check-files/drafts/01-layout-outside-page.md
gh issue list --label type:bug --search "$(sed -n 's/^search first: //p' "$f")"
gh issue create --title "$(sed -n 's/^title: //p' "$f")" --label "$(sed -n 's/^labels: //p' "$f")" --milestone Player --body "$(sed '1,/^---$/d' "$f")"
```

- The owner's `fail` rows become bugs from the Bug template. Lanes: effects and drums go to audio, unless the report shows the effect was not read (then formats); order and tempo to the lead; looking to score; opening, transport and cursor to the lead.
- A bug a local tab exposes is reproduced in a fixture or a hand-built score before its test.
- The PR that fixes a known issue deletes its entry in `scripts/check-files/known.ts`.

## Recording a run

One comment on the checkpoint's issue (#50 for the player) with the commit, a table of anonymized tabs × statuses, the issues filed, and the Part C items done.
