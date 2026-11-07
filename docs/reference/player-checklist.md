# Player checklist

The real-file correctness pass (WP-054, #50): what to run, look at and listen for before a checkpoint is declared. Part A is automated by `pnpm check:files`; Parts B and C need ears, eyes and, for C, Guitar Pro; Part D turns findings into issues. Run it at each checkpoint: the player now, then the editor and the release.

## Before you start

- `pnpm install` and `pnpm sounds:fetch` (the audio check renders through GeneralUser GS and reports `soundfont-missing` without it).
- Put tabs in `local-tabs/`, in subfolders if you like. They are never committed, and never named in an issue, a PR or a comment: the repository is public. Refer to a local tab by its number from `.check-files/summary.md` (`local tab 3`).

## Part A: the automated pass

```sh
pnpm check:files                      # fixtures/ and local-tabs/
pnpm check:files local-tabs           # only your tabs
pnpm check:files local-tabs/song.gp5 --only audio   # one file, one project (formats, layout, audio)
```

Paths resolve against the directory you run it from. Folders are walked recursively for `.gp3`, `.gp4`, `.gp5`, `.gpx` and `.gp` files, in any case; an empty or missing `local-tabs/` is reported and skipped. A path that does not exist exits with code 2. The command exits 0 only when no check fails, crashes or leaves a known entry stale. CI runs `pnpm check:files fixtures` as the "Real-file pass" step and uploads `.check-files/` when it fails.

| Check | Where it runs | What it proves | What it cannot see |
| --- | --- | --- | --- |
| `read` | Node | The file reads through the app's own dispatcher with no `error`-severity warning. Records the version, counts, the features the listening sheet asks about, and a `.gp` export of our writer's output. | Whether what was read is what the author wrote; that is the oracle's job, and Guitar Pro's. |
| `oracle` | Node | The read matches alphaTab 1.8.4, except where `packages/formats/test/oracle/tolerances.ts` documents a difference. | Files alphaTab cannot read (skipped), and anything both readers get wrong the same way. |
| `order` | Node | The play order (repeats, voltas, jumps) matches alphaTab's MIDI generator, except for the documented deviations in the model README's "Deviations from alphaTab". | Whether alphaTab matches Guitar Pro; that is C1. |
| `tempo` | Node | Every pass lasts as long as alphaTab's, with the same tempo changes, except ramps, moved mid-beat changes and over-full bars (which last their longest voice here, while alphaTab plays the overflow over the following bars; #118). Runs only on an identical order. | How a ramp should sound. |
| `layout` | Chromium | On A4 pages in tab, standard and both: finite numbers, nothing outside the page or the margins, no overlapping anchors of one kind, no overlapping marks in a lane. | Collisions between voices' note heads or rests (#70), and anything inside a system that the anchors do not cover (#116). |
| `audio` | Chromium | A GM render with finite samples and no clipping, within the memory budget; every untied note of every pass reached the sampler once, on time to 1 ms; every strike found a region; every scheduled attack is audible. | Timbre, and whether an effect sounds right: that is Part B. |

Statuses, worst first: **fail** (a violation no known entry accepts, or a crash), **known** (every violation is a known issue), **skipped** (the check could not run, for example when alphaTab cannot read the file), **explained** (a documented difference only), **pass**.

Reports go to `.check-files/` at the repository root, which is gitignored and wiped on each run except `listening/`:

- `summary.md`: a file × check status table, the totals, stale known entries and the draft issues. Start here.
- `<file>.md` and `<file>.json`: the per-file report: header, status table, each check's sections (read warnings, the play order as runs of bars, render facts) and its findings. A file outside the repository is reported under `external/`.
- `drafts/NN-<check>-<code>.md`: one draft `type:bug` issue per group of unknown violations, also printed at the end of the run. Drafts never carry a local tab's file name, title or track names.
- `listening/<file>.md`: the sheet for Part B, created once and never overwritten.
- `exports/`: our writer's `.gp` output for each file, for C4.

The known list is `scripts/check-files/known.ts`: each entry names its open issue and the fixtures it must fire on. When a run covers one of those fixtures and the entry no longer fires there, the run fails as stale; the PR that fixes the issue deletes its entry.

Attack verification compares the spectral flux at each scheduled attack (clusters merged within 30 ms) with the median flux of the surrounding second. A ratio of 1.5 or more is heard, 1.2 to 1.5 weak (reported only), below 1.2 missed; the check fails when more than 2 % of clusters (and more than 2) are missed, or 3 in a row. The fixtures' smallest ratio is 1.32, on the overdriven guitar of `multivoice-rhythm.gp`, so the margin is narrow; the constants live in `packages/audio/src/test/real-file.ts` and may be retuned after the first local run.

## Part B: listening and looking

Per tab, in the app (`pnpm dev` and open the file, or the desktop build), with the sheet `.check-files/listening/<file>.md` open beside it. The sheet has a row for B1, B2, B3 and B7 always, and one for each feature the file has, with the first bars that carry it.

**How to mark:** write `pass`, `fail` or `n/a` in Result. For a fail, put the bar and what you heard in Note. Send the lead the `fail` rows; for a local tab, give its number from `summary.md`, not its name.

### B1 Opens

The file opens. The import-details panel shows only what the report's Read section lists. Track names, instruments and tunings look right.

### B2 Order

Follow the cursor through repeats, voltas and jumps, and compare with the report's Order section.

### B3 Tempo

Tempo changes happen at the listed bars, ramps glide, and the transport's BPM readout follows.

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

### B6 Tracks

The balance between tracks is sensible, pitched tracks without tab play at pitch, and the mute and solo flags stored in the file are respected.

### B7 Looking

In tab, standard and both:

- nothing overlaps: fret numbers, heads, rests, effect lanes, P.M. and let-ring dashes, chord names and diagrams, lyrics, tempo marks, sections, repeat and volta brackets;
- nothing is cut at a page edge;
- the cursor stays on screen while following.

Known exceptions to note, not refile: #107, #110, #116, #70's two-voice head collisions, and #115's rapid-seek scroll.

## Part C: Guitar Pro comparisons (optional, needs Guitar Pro 7 or 8)

These need Guitar Pro 7 or 8; a trial installation is enough. They are optional owner checks: skip them without Guitar Pro, and say which were done when recording the run.

- **C1:** the play order of `fixtures/gp5/directions.gp5` and `fixtures/gp5/repeat-close-alternate-endings.gp5` against the report's Order section. The model README says the expander follows Guitar Pro where Guitar Pro and alphaTab differ.
- **C2:** a real gpx with drums: the kick (36 against 35), the ride bell (GM 59 against 53) and the cowbells (56) (#50, the WP-043 comment; #76).
- **C3:** a gp3 file with an artificial harmonic: the tab number and the pitch in Guitar Pro against Reprise (#76).
- **C4:** open `.check-files/exports/<file>.gp` for two or three songs: one with drums, one with a tuning-less pitched track such as piano, one with several tracks. Check that each opens, then the drum kit, the instruments and the page layout (#50, the WP-044 comment; the #71 review).
- **C5:** any GP4 file with chord diagrams: the report's `version` (400 or 406), and whether the diagrams match Guitar Pro's (#50, comment (b)).
- **C6:** bar 24 of `fixtures/gp5/effects.gp5`: does Guitar Pro play all ten quarter notes of the over-full bar, and how long does the bar last? This is the evidence #118 needs.
- **C7:** play `fixtures/gp3/notes.gp3` (a single over-full bar) in Guitar Pro and in Reprise: does Guitar Pro stretch the bar to its longest voice, as Reprise does after #118, or play the overflow over what follows, as alphaTab does?

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
