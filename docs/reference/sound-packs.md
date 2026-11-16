# Sound packs: sources and licenses

What Reprise plays with, where it comes from, and what each license allows. Verified 2026-11-05 from secondary sources; **confirm each license on its own download page before adding a pack to the curated manifest** (WP-091). The packs of the curated list below were confirmed that way on 2026-11-16. Nothing here is committed to git; the GM soundfont is bundled into the app build, everything else is downloaded or user-supplied.

## How Guitar Pro does it, for reference

Guitar Pro's RSE is multi-sampled instruments with articulation layers, run through an effects chain of amp drive, cabinet simulation, EQ, delay and reverb. Its non-RSE mode is General MIDI through the OS synth. Reprise mirrors both: an HQ tier of SFZ packs with effects, and a GM tier from a soundfont.

## GM tier

| Pack           | Format | Size    | License                                  | Notes                                                                                                    |
| -------------- | ------ | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GeneralUser GS | SF2    | ~30 MB  | Free use and redistribution with notice  | **Default bundled soundfont.** Good balance of size and quality; full GM set including guitar variants.  |
| FluidR3 GM     | SF2    | ~140 MB | MIT                                      | Higher quality for some instruments, too large to bundle. Candidate for an optional download.            |
| TimGM6mb       | SF2    | ~6 MB   | GPL                                      | Tiny; only if a minimal install matters. GPL would constrain redistribution; not a default.               |

## HQ tier candidates

Electric guitar:

| Pack                              | Format   | License                 | Articulations                                                        | Direct download |
| --------------------------------- | -------- | ----------------------- | -------------------------------------------------------------------- | --------------- |
| Unreal Instruments Standard Guitar | SFZ/FLAC | Free; terms on site, Japanese | Sustain, palm mute, natural harmonics, hammer-on, pull-off via keyswitches | Verify          |
| Unreal Instruments Metal GTX      | SFZ/FLAC | Free; terms on site     | 7-string, 20+ articulations                                          | Verify          |
| Karoryfer Emilyguitar             | SFZ      | Free, open source       | Electric guitar, several articulations                               | Likely          |

Bass:

| Pack                                 | Format | License | Notes                      |
| ------------------------------------ | ------ | ------- | -------------------------- |
| Karoryfer Black and Blue Basses      | SFZ    | CC0     | Two 5-string basses        |
| Karoryfer Swagbass                   | SFZ    | CC0     | Simple electric bass       |
| Karoryfer Growlybass                 | SFZ    | Free    | Electric bass              |

Drums:

| Pack              | Format | License        | Notes                                   |
| ----------------- | ------ | -------------- | --------------------------------------- |
| Salamander Drumkit | SFZ   | CC-BY          | Standard acoustic kit                   |
| SM Drums          | SFZ    | Free           | Listed by the Ardour community          |
| AVL Drumkits      | SFZ    | CC-BY          | Several kits                            |

Keys and orchestral:

| Pack                        | Format | License | Notes                                        |
| --------------------------- | ------ | ------- | -------------------------------------------- |
| Salamander Grand Piano      | SFZ    | CC-BY   | The standard free piano, 16 velocity layers  |
| Sonatina Symphonic Orchestra | SFZ   | CC      | Strings, winds, brass                        |
| Virtual Playing Orchestra   | SFZ    | Verify  | Orchestral                                   |

Acoustic guitar is the weak spot: Pianobook's MDM Acoustic Guitar exists with a license to verify; otherwise the GM tier fills in.

## The curated list

`apps/web/src/features/sounds/curated-packs.ts` is what the Sounds screen offers. A pack is listed
only when its licence is confirmed on its own source page, and `directDownload` also needs an open
licence, a stable archive URL, and a SHA-256 and size measured from one real download (the three
archives below were downloaded once into the gitignored `local-sounds/`, installed through the
real installer, and every entry passed `checkSfzFile`). The list's test requires every listed
pack to appear in this document with its hash. Ids are fixed (a song names a pack by id) and never
change. See [ADR-0028](../decisions/0028-sound-packs-stored-under-data-sounds-and-a-curated-list-of-confirmed-licences.md).

| Pack                  | Id             | Version | Licence (confirmed 2026-11-16)                                                    | Archive (size)  | SHA-256                                                            |
| --------------------- | -------------- | ------- | --------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Karoryfer Swagbass    | `HetrHZohZ3oo` | 1.001   | CC0 1.0, the `LICENSE` of [the repository](https://github.com/sfzinstruments/karoryfer.swagbass) | 144,579,232 B   | `4b4db964413be99a597da246651961e1c4dbb0004db49daccd11387c5f9a535a` |
| Karoryfer Growlybass  | `oP2Y6UriacYx` | 1.002   | CC0 1.0, the `LICENSE` of [the repository](https://github.com/sfzinstruments/karoryfer.growlybass) | 167,454,256 B   | `b92dca75494fa39d6e8d8b8addaabfe70c5aaa59b5f9a0f624be6de51a2374bc` |
| Karoryfer Emilyguitar | `qxmLveBRBWt8` | 1.001   | CC0 1.0, the `LICENSE` of [the repository](https://github.com/sfzinstruments/karoryfer.emilyguitar) | 103,484,350 B   | `ffef3b28972763820bee73660a25cf47ea6e13b184342fd5d325a5631598cacb` |

The archives are the GitHub release assets (a 302 to the release CDN; the desktop download follows
https redirects only). Installed size is the sum of the copied files: 174,246,979, 190,765,319 and
125,538,629 bytes. Each pack's own `readme.txt` also says "Royalty-free for all commercial and
non-commercial use". The instruments listed are the mappings that play per note: Growlybass's
"strange" (release samples only) and Emilyguitar's two chord mappings are left out.

Not listed, with the reason:

- **Karoryfer Black and Blue Basses** (CC0 on its repository): a 1.0 GB archive, which was not measured here. It is a candidate for a follow-up with the hash and entries measured.
- **Unreal Instruments** (Standard Guitar, Metal GTX): the terms are on a Japanese site and were not confirmed. Drop-only when added.
- **Pianobook MDM Acoustic Guitar**: needs a login to download; drop-only when its terms are confirmed.
- **Salamander Grand Piano, Salamander Drumkit, AVL Drumkits, SM Drums, Sonatina Symphonic Orchestra, Virtual Playing Orchestra**: not confirmed on their source pages yet, so not listed. A user can still drop any of them as a custom pack.
- **Impulse responses**: out of scope for the pack manager (decision 11 on #195).

A custom pack (any folder or zip of an SFZ instrument, not in the list) installs through the same
pipeline: it gets a new id, one instrument per root-level `.sfz` that passes the check, and no
licence record. The installer copies only `.sfz`, `.sfzh`, `.inc`, `.wav`, `.flac`, `.ogg`, `.oga`,
`.opus`, `.txt`, `.md` and `LICENSE`/`README` files.

### Articulation sets (WP-093)

An instrument's `entries` map an articulation set (`ARTICULATION_SETS` in `@reprise/audio`) to an
SFZ file; `default` is required. A pack can also carry its sets as labelled keyswitch layers in one
file (`sw_label`), which the engine reads at load with no entry.

- **Growlybass**: `staccato` is `growlybass_vicious.sfz` on `dirty` and `clean`. `angry` and
  `excessive` already layer staccato samples into every note, `vicious` is staccato
  already, so the other sounds list no set. Emilyguitar and Swagbass list no articulation files: their
  palm-mute, dead and harmonic sounds are not separate files, and their dead-note noise keys are
  left to #286. No curated pack has a keyswitch library.
- **Installed copies** keep the manifest of their install, so a same-version copy takes its
  instruments from the list on every scan (the files are the same). A listed file the copy lacks
  drops that set, or that instrument when it is the default, and the Sounds screen says so and
  suggests removing the pack and downloading it again.
- **Custom packs**: a `.sfz` named as another `.sfz` in the same folder (the root, when any
  `.sfz` sits there) plus an articulation tail is that instrument's file for the set, not an
  instrument: `guitar.sfz`, `guitar_pm.sfz`, `guitar harm.sfz` become one instrument `guitar` with
  `default`, `palmMute` and `harmonic`. The tail is the last one or two words after `_`, `-` or a
  space, and all of it must be a whole articulation name: `pm`, `palm mute`, `dead`, `harm`,
  `harmonics`, `nh`, `pinch`, `artificial harmonics`, `legato`, `hammer on`, `ho`, `stacc`,
  `staccato`, `tap`, `slap`. `trumpet_mute`, `piano_hammer`, `piano_tape`, `synth_pop` and
  `guitar_slapback` are instruments. A file already grouped never serves as a base (so
  `guitar_pm_harm.sfz` stays an instrument), a second file for a taken set, and a tail whose base is
  not there or did not pass the check, stay instruments. There is no mapping UI.

## Impulse responses

- **Cabinets**: free packs exist (God's Cab, Metal Cabs by Erik Ekholm, Origin Effects' library, forward audio faIR) but their terms are "free to use", not "free to redistribute". They are user-downloaded through the pack manager, never bundled.
- **Bundled impulse responses**: the defaults are generated, not sourced (WP-092). Three cabinets (`open-1x12`, `closed-2x12`, `closed-4x12`) and one stereo room (1.4 s) are generated at runtime by `packages/audio/src/effects/impulses.ts` from fixed seeds, at the audio context's sample rate. No recording, no third-party material and no file is committed or fetched, so no licence entry is needed (`fixtures/LICENSES.md` does not apply: these are not fixtures). They hold under 2 MB resident.
- **Reverb**: the bundled room is the generated one above. The OpenAIR library is Creative Commons and a user-download option for a recorded room; confirm the specific license per file before using one.

## Pack manifest fields (for WP-091)

`schema` (1), `id` (12 letters or digits), `name`, `family` (electric-guitar, acoustic-guitar, bass, drums, keys, orchestral, other), `gmPrograms` it can stand in for, `format` (`sfz`), `version`, `sourceUrl`, `licenseName`, `licenseUrl`, `directDownload` (boolean), `download` (`url`, `sha256` and `sizeBytes` of the archive, and the `root` folder inside it), `sizeBytes` (installed), and `instruments`: each a `key`, a `name` and `entries` (articulation set name to SFZ path, `default` required). The schema is `features/sounds/manifest.ts`; `pack.json` adds `curated`, `source`, `installedAt` and the file index.

## Sources consulted

- Bedroom Producers Blog on free guitar samples: https://bedroomproducersblog.com/2020/02/19/free-guitar-samples/
- KVR thread on Unreal Instruments: https://www.kvraudio.com/forum/viewtopic.php?p=7264812
- sfzinstruments bass list: https://sfzinstruments.github.io/basses
- Ardour community SFZ/SF2 source list: https://discourse.ardour.org/t/best-sfz-sf2-instrument-sources-open-source-free-and-commercial-and-related-misc-as-of-june-2023/108831
- LinuxAudio free audio data wiki: https://wiki.linuxaudio.org/wiki/free_audio_data
- Pianobook MDM Acoustic Guitar: https://www.pianobook.co.uk/packs/mdm-acoustic-guitar-v10-f/
- spessasynth_lib (evaluated, not used; see ADR-0004): https://github.com/spessasus/spessasynth_lib
- Origin Effects free IR library: https://www.soundonsound.com/news/origin-effects-launch-free-ir-cab-library
- Metal Cabs free IRs: https://bedroomproducersblog.com/?p=15976
