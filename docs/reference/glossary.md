# Glossary

Terms used across the docs, the model and the UI. When two names exist, the one in bold is the one we use in code.

- **Score**: a whole song file: metadata, master bars and tracks.
- **Track**: one instrument part. Kind is `fretted`, `drums` or `pitched`.
- **Master bar**: the per-position information shared by every track: time signature, key signature, tempo change, repeats, alternate endings, jumps, section. Guitar Pro calls this a "measure header".
- **Bar**: one track's content at one master bar position. Guitar Pro calls this a "measure".
- **Voice**: an independent rhythmic line within a bar. Guitar Pro stores four; we edit two.
- **Beat**: a rhythmic position in a voice holding zero or more notes. A rest is a beat with `rest: true`. Guitar Pro also calls this a beat.
- **Note**: one sounding pitch within a beat, on a string (fretted), or a MIDI note (drums, pitched).
- **String numbering**: string 1 is the highest-pitched string, as in Guitar Pro. Tuning arrays in the model are low to high, so `tuning[tuning.length - string]` is the string's open pitch.
- **Tick**: the time unit. 960 ticks per quarter note (PPQ). A whole note is 3840 ticks.
- **Playback tick**: a tick counted from the start of playback across every pass of the playback sequence, as opposed to a tick within a bar or in written order.
- **Tie chain**: a note and the notes tied to it in the following beats of its voice. A chain shares one pitch; the score model (`reference/score-model.md`) explains how edits keep it.
- **Duration**: a beat's base value as the denominator: 1 whole, 2 half, 4 quarter, 8 eighth, and so on, plus dots and an optional tuplet.
- **Tuplet**: `n` notes in the time of `of`: triplets are `{ n: 3, of: 2 }`.
- **Playback sequence**: the ordered list of master-bar passes after expanding repeats and jumps. The scheduler and the cursor follow it; the layout shows written order.
- **Tempo map**: the mapping from a position in the playback sequence to seconds, given tempo changes.
- **Alternate ending** (volta): the bracketed endings of a repeated section, numbered.
- **Jumps**: segno, coda, D.S. (dal segno), D.C. (da capo), al Coda, al Fine, Fine, To Coda, double coda.
- **Section**: a named marker on a master bar (Intro, Verse, Chorus) used for navigation.
- **Articulation**: a playing technique attached to a note or beat: bend, slide, hammer-on, pull-off, vibrato, palm mute, let ring, harmonic, dead note, tapping, tremolo picking, trill, grace note, staccato, accent, ghost note.
- **Rhythm notation under tab**: stems, beams and flags drawn below the tab staff so the tab carries timing. Always shown in tab mode; in both mode the standard staff carries the rhythm instead (ADR-0021).
- **System**: one line of music across all visible tracks. The layout breaks bars into systems and systems into pages.
- **Primitive**: a positioned drawable produced by layout: glyph, line, path or text.
- **Anchor**: a model node's bounding box in layout output, used for hit-testing and cursor placement.
- **GM**: General MIDI: 128 programs and a percussion map. The GM tier is the bundled soundfont.
- **SF2**: SoundFont 2, a single binary file of samples and mappings. Used for the GM tier.
- **SFZ**: a text file mapping key and velocity ranges to separate sample files. Used for the HQ tier.
- **Region**: one sample mapping in a soundfont: key range, velocity range, root key, loop, envelope.
- **Voice (audio)**: one playing instance of a sample in the sampler. Distinct from a notation voice.
- **Keyswitch**: a note outside the playable range that selects an articulation layer in an SFZ pack.
- **Lane**: one parallel stream of work owning one package and, where applicable, one feature folder.
- **Checkpoint**: a milestone where lane output is integrated into a usable app state: Player, Library, Trainer, Editor, HQ Sound, Release.
- **Work package** (WP): one unit of work in a phase plan, mapped to one GitHub issue.
