# Sound packs: sources and licenses

What Reprise plays with, where it comes from, and what each license allows. Verified 2026-11-05 from secondary sources; **confirm each license on its own download page before adding a pack to the curated manifest** (WP-091). Nothing here is committed to git; the GM soundfont is bundled into the app build, everything else is downloaded or user-supplied.

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

## Impulse responses

- **Cabinets**: free packs exist (God's Cab, Metal Cabs by Erik Ekholm, Origin Effects' library, forward audio faIR) but their terms are "free to use", not "free to redistribute". They are user-downloaded through the pack manager, never bundled. For the bundled defaults, generate a few synthetic cabinet-like responses (filtered noise bursts with a short decay) or source CC0 ones and record their provenance here.
- **Reverb**: the OpenAIR library is Creative Commons; confirm the specific license per file before bundling one small room response.

## Pack manifest fields (for WP-091)

`id`, `name`, `family` (electric-guitar, acoustic-guitar, bass, drums, keys, orchestral, other), `gmPrograms` it can stand in for, `format`, `sourceUrl`, `licenseName`, `licenseUrl`, `directDownload` (boolean), `sizeBytes`, `entries` (articulation set name to SFZ path), `sha256` of the archive when known.

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
