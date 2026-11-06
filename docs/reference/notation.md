# Notation rules

The engraving rules `@reprise/layout` follows, collected as the score lane implements them. Each section names the work package that introduced it; the code is the authority when the two disagree, and a disagreement is a bug in one of them.

## Staves (WP-020)

- A five-line staff has its lines one staff space apart. A tab staff has one line per string, 1.5 staff spaces apart so fret numbers fit between them; string 1, the highest, is the top line.
- A track shows a tab staff, a standard staff, or both with the standard staff on top. Drums always read from a five-line percussion staff.
- Staff positions count from the bottom line: 0 is the bottom line, 8 the top line of a five-line staff, odd numbers are spaces (the model's `staffPosition` uses the same numbering).

## Clefs (WP-020)

| Clef         | Glyph                       | Sits on       |
| ------------ | --------------------------- | ------------- |
| `treble`     | `gClef`                     | position 2 (G4) |
| `bass`       | `fClef`                     | position 6 (F3) |
| `alto`       | `cClef`                     | position 4 (C4) |
| `tenor`      | `cClef`                     | position 6 (C4) |
| `percussion` | `unpitchedPercussionClef1`  | centred       |

- A bar's `clef` holds until the next bar that sets one; the first bar starts from the track's `display.clef`, or treble when that is absent (percussion on a drum track).
- `Track.display.octaveShift` is written minus sounding pitch, so a guitar's 1 is the treble clef with an 8 below (`gClef8vb`): the music sounds an octave lower than written. Two octaves use the `15mb` forms, negative shifts the `8va` and `15ma` forms. C clefs have only an 8-below form.
- A tab staff opens with the six-string TAB clef from five strings up and the four-string one below that, scaled down if it would overflow the lines.
- A clef change inside a system is drawn at three quarters of the size, before the key and time signatures of that bar.

## Key signatures (WP-020)

Standard staves only, in the order sharps (F C G D A E B) or flats (B E A D G C F) are added, at these staff positions:

| Clef   | Sharps                | Flats                 |
| ------ | --------------------- | --------------------- |
| treble | 8 5 9 6 3 7 4         | 4 7 3 6 2 5 1         |
| bass   | 6 3 7 4 1 5 2         | 2 5 1 4 0 3 −1        |
| alto   | 7 4 8 5 2 6 3         | 3 6 2 5 1 4 0         |
| tenor  | 2 6 3 7 4 8 5         | 5 8 4 7 3 6 2         |

- A key change inside a system cancels the old key with naturals before the new signature (WP-023): every accidental of the old key when the new one is C or changes between sharps and flats, the dropped ones when it keeps fewer of the same kind. The naturals sit at the old accidentals' positions. A line that opens with the new key shows only the new key.
- **Courtesy signatures** (WP-023): a paged system whose next system opens with a key or time change ends with that key (its cancelling naturals included, standard staves only) and time signature after its last bar line, the staff lines running on under them. Continuous mode has no line ends and no courtesy signatures. Clef changes get no courtesy clef yet.

## Time signatures (WP-020)

- Shown at the first bar and wherever the signature changes, on every staff, tab included. Numerator above the middle, denominator below, each digit glyph centred on its row.
- On a tab staff the digits grow with the staff, up to half again their size, so they span it.

## Bar lines and repeats (WP-020)

- At the end of a bar, in priority order: a repeat end (light-heavy with dots in front), the score's final bar line (light-heavy), a double bar (two light lines), a single line. Thicknesses and separations are Bravura's engraving defaults.
- A start repeat (heavy-light with dots after) follows the bar's clef change, key and time signature.
- A system with two or more staves opens with a bar line joining them; a single staff starts without one.
- The end bar lines of a track shown on two staves (standard above tab) run on through the gap between them (WP-023); repeat dots stay inside each staff. Separate tracks keep separate bar lines.
- Repeat dots sit in the two spaces either side of the staff's middle; on a staff with an even number of lines, one line spacing either side of the middle.
- A section played more than twice shows `xN` above the end repeat, in a lane of its own above the system's first staff (WP-022).

## Header markings (WP-020)

Drawn above a system's first staff, in bands that exist only when a bar of the system needs them, top to bottom:

1. **Sections**: the letter boxed, then the name; a name without a letter is boxed itself.
2. **Tempo**: the mark's label, a metronome note for its unit (dotted for the dotted units) and `= n`, where `n` is the quarter-note `bpm` converted to the unit.
3. **Directions**: segno and coda symbols at the bar start (doubled for segno segno and double coda); `Fine` and the jump instructions (`D.S. al Coda`, `To Coda`, ...) in italics, right-aligned at the bar end, since jumps are read there.
4. **Voltas**: one bracket per run of bars with the same endings, labelled `1., 2.`, with a hook down at the start and, when the run ends on a repeat, at the end. A bracket that continues into the next system carries on without a hook or label.

## Spacing (WP-020)

- Every onset of every visible voice and track gets one column, so simultaneous beats align vertically across tracks and voices.
- The width from one onset to the next follows the shortest beat starting at the onset, scaled by the fraction of that beat before the next onset. Up to a quarter it is logarithmic (Gourlay): a 64th is one staff space and each doubling adds 0.7, so a quarter is 3.8. Beyond a quarter it follows Guitar Pro's feel, `3.8 × q^0.85` spaces for `q` quarters: a half is 6.8 and a whole 12.3, where the logarithm would give 4.5 and 5.2, so a 4/4 bar of one whole note is about 15 spaces of content. The curve is the engine's and holds on every staff (WP-027), so switching notation keeps bar widths; a bar with no beats spaces like a whole-bar note. Nothing is narrower than its contents need.
- A pickup bar (anacrusis) is as wide as what it holds; any other bar spans its whole time signature, so an incomplete bar keeps its empty space.

## Tab staff (WP-021)

The tab module is `packages/layout/src/staves/tab/`; every size below is in staff spaces and lives in its `TAB` table.

- **Fret numbers** are UI-font text, 1.3 spaces, centred on their string at the onset (string 1 on the top line). Each sits on a filled `paper` knockout rectangle 0.12 em wider and 0.09 em taller than the number on each side, so the string line stops short of the digits; the painter fills it with the paper colour. Numbers of any width (`12`, `24`) are centred the same way and widen their onset's room.
- **Note forms**: a dead note is `x`, a ghost note `(5)`, a tied note `(5)`, a dead ghost note `(x)`. `LayoutOptions.tiedNotes: 'hidden'` hides tied notes instead: nothing is drawn on the string, the tie and the note anchor stay.
- **Grace notes** are fret numbers at 0.7 of the size, one column per grace beat, left of the main number with 0.25 spaces between columns, each on a stem two spaces long (0.7 of the thickness) with its flag at 0.6 of the size.
- **Rests** are the SMuFL rest glyphs, centred on the onset and on the staff's middle; dots follow 0.3 spaces after the glyph. A rest alone in its voice is centred in the bar, as Guitar Pro draws a whole-bar rest. The rests of an upper voice sit in that voice's rhythm area above the staff.
- **Two voices.** Voice 1 stems down below the tab; voices 2 to 4 stem up above it whenever voice 1 is present, Guitar Pro's convention for tab. A voice alone stems down. A voice is present only when it has a note or a rest: Guitar Pro's unused voices hold empty beats, and those draw nothing and reserve nothing.
- **Words.** In lanes above the staff, outside the effect lanes (see [Note effects](#note-effects-wp-022)): chord names (1.2 spaces, starting at the left edge of the beat's numbers), left- and right-hand fingering stacked one per fingered note in string order (`T 1 2 3 4`, then `p i m a c`), then beat text. Below the rhythm notation and the dynamics: one lyric row per line used, each syllable centred on its beat. A lane exists in a system when a bar of it has the row, and every bar of the system writes it at the same height (WP-022).
- **Dynamics** are the Bravura dynamic glyphs at 0.8 size, centred on the beat in a dynamics lane below the rhythm notation, by the rule every staff shares (see [Dynamics](#dynamics-wp-022)).
- **Both mode.** Under a standard staff (`StaffBar.staves` holds `standard`) the tab shows fret numbers, grace numbers, ties, chord names, beat text, lyrics and the note effects (lanes, bends, slides, hammer-ons) only: stems, flags, beams, dots, tuplets, rests, dynamics, fingering, articulations and tremolo strokes are the standard staff's, Guitar Pro's "both" ([ADR-0021](../decisions/0021-rhythm-on-the-standard-staff-in-both-mode.md), [ADR-0022](../decisions/0022-lane-effects-once-on-the-tab-in-both-mode.md)). Chord names, text and lyrics stay on the tab because the standard staff does not draw them.
- **Spacing.** A beat reserves its numbers and knockouts, grace columns, rest glyph, flag and dots either side of its onset, plus its chord name, text, lyrics, dynamic and effects (see [Note effects](#note-effects-wp-022)). Long notes follow the engine's curve (see [Spacing](#spacing-wp-020)).

## Rhythm notation (WP-021)

The beam-grouping and tuplet rules in `packages/layout/src/staves/rhythm/grouping.ts` are shared by the tab and the five-line staves. The drawing helpers beside them (`draw.ts`: stems, flags, horizontal beams, dots, tuplet marks and ties, taking x and y positions and a stem direction) serve the tab, which draws its rhythm when it is the track's only staff; `src/staves/standard/rhythm/` draws the five-line staves' sloped beams.

- **Stems** start 0.75 spaces past the outer string and are 3.25 spaces long, 0.12 thick (Bravura's `stemThickness`). A half note's stem is the outer 1.5 spaces only; a whole note has none. Each beam past the second lengthens a voice's stems by one beam pitch.
- **Flags** are the SMuFL flag glyphs for an unbeamed eighth or shorter, attached by their `stemDownSW` / `stemUpNW` anchor to the stem's end.
- **Beams are horizontal under tab**, never sloped, since every stem in a voice ends at the same height. Thickness 0.5, gap 0.25 (Bravura), so each further beam sits 0.75 towards the notes. A stem with more beams than its neighbours takes a partial beam 1.1 spaces long, pointing right on the group's first stem and left elsewhere.
- **Beam groups** never cross a rest, an empty beat or a longer note; a tuplet beams within itself; everything else beams within the spans of its time signature:

  | Signature                        | Eighths                        | Sixteenths and shorter |
  | -------------------------------- | ------------------------------ | ---------------------- |
  | 4/4                              | half bars (two quarters)       | quarters               |
  | other x/4                        | quarters                       | quarters               |
  | 6/8, 9/8, 12/8 (x/8, x/16 by 3s) | dotted quarters                | the same               |
  | 3/8                              | the whole bar                  | the same               |
  | other x/8 and x/16               | pairs, the last of three       | the same               |
  | x/2 and x/1                      | halves                         | quarters               |

  Once any beat in a run is a sixteenth or shorter, the whole run splits by the sixteenths' spans, its eighths included: in 4/4, `8 8 16 16 8` in the first half bar beams as `[8 8][16 16 8]`, not as one half-bar group.

- **Dots** sit 0.45 spaces right of the stem and 0.6 spaces past where it starts, 0.5 apart.
- **Tuplets** group consecutive beats of one ratio as alphaTab groups them, so brackets match Guitar Pro's: closed after `n` beats of one value, or once beats of unequal values add up to a plain note value times ⌊n/of⌋ (a quarter-and-eighth triplet is one group, the quarter triplets after it another). On the tab the number (SMuFL `tuplet` digits) is centred under the group, 1.45 spaces past the beams; a bracket (0.16 thick, 0.6-space hooks pointing back at the stems, broken 0.3 spaces around the number) is added unless one beam spans exactly the tuplet.
- **Ties** are filled crescents from the origin the model names (`tieOriginOf`: the last note on the string in the same voice within three bars, past rests and other strings) to the tied note's number (or the onset of a hidden one), just past the number on the stem side: height 0.12 of the span, kept between 0.3 and 0.6 spaces, Bravura's midpoint thickness of 0.22. The bar holding the tied note draws the tie: in one piece when the origin is in that bar or in the previous bar of the system, otherwise as a half from the bar's left edge, and a bar ending a system draws the other half to its right edge for each note a later bar continues.

## Standard staff (WP-023)

Fretted and pitched tracks. Pitches come from the model's `spellNote` and `staffPosition` with the clef in effect and `Track.display.octaveShift`; a `percussion` clef on a pitched track reads as treble.

- **Note heads** by duration: whole, half, black. A dead note has a cross head.
- **Chords** stack by staff position. A head a second (or a unison) from its neighbour goes to the other side of the stem, sharing it: right of an up stem, scanning from the bottom; left of a down stem, scanning from the top; right when there is no stem.
- **Accidentals** are what `spellNote` gives against the key, with measure memory: a printed accidental holds for its letter and octave until the bar line, so a repeat shows nothing and a return to the key's alteration shows a natural (or the key's sign). Grace notes count, in reading order, before their beat. A tied note prints nothing, but the alteration it carries in from the bar before holds until the next untied note of its letter and octave, which prints its own accidental when it differs (a natural after a tied-in sharp) and restates it when it is the same.
- **Courtesy accidentals** (on by default; `standardModule({ courtesyAccidentals: false })` turns them off): the first note of a letter and octave whose accidental the previous bar printed, and which no longer needs one, gets it again in parentheses.
- Accidentals of a chord stack in columns to the left of the heads, outermost first, alternating top and bottom, each in the nearest column where it does not collide vertically; they clear the ledger lines of a note off the staff.
- **Stems**: with one voice on the staff, up when the note furthest from the middle line is below it, down otherwise (a tie goes down); a beamed group takes the direction of its furthest note. With two or more voices, voices 1 and 3 stem up, 2 and 4 down, whatever the pitch. A stem is 3.5 spaces from the note nearest its tip, 0.75 more for each flag or beam past the second, and always reaches the middle line.
- **Flags** for unbeamed eighths and shorter; **beams** over runs of two or more eighths and shorter within the beam groups of the table under **Rhythm notation**, shared with the tab staff (4/4 eighths by the half bar, sixteenths by the quarter). Rests, quarters and longer break a beam; a tuplet is beamed only within itself. A stem alone at a beam level gets a partial beam, pointing right from the first stem and left elsewhere. Beams follow the first and last notes but rise or fall at most one staff space, are horizontal for repeated pitches or when an inner note is further out than both ends, and move out until no stem is shorter than 3 spaces (more with more beams). Thicknesses and spacing are Bravura's engraving defaults.
- **Rests**: a whole rest hangs from the fourth line, a half rest sits on the middle line, shorter rests centre on it. With two voices, voice 1's rests move up and voice 2's down. A rest alone in its voice is centred in the bar.
- **Ledger lines** at every even position past the staff, `legerLineExtension` beyond the heads.
- **Ties** are arcs from the head they continue to the tied head, on the side away from the stem (with two voices, towards it, so the voices' ties part); in a chord the upper half arcs up and the lower half down. A tie across a bar line in the same system is one arc; across a system break it is two halves, to the end of the first system and from the start of the next.
- **Dots** follow the rightmost head; a note on a line dots the space above (the space below for a stem-down voice when there are two).
- **Tuplets** are grouped by the shared rule under **Rhythm notation**. The number alone over a tuplet that is exactly one beamed group, otherwise a bracket open towards the notes with the number in a gap; on the stem side, past the stems and beams.
- **Grace notes** at 0.6 of the size, stems up, before the beat and its accidentals: a single one as an eighth with a slash, several beamed by their value.
- **Dynamics** in a lane below the staff, by the rule every staff shares (see [Dynamics](#dynamics-wp-022)); the glyphs are Bravura's precomposed dynamics (`dynamicPP` to `dynamicFFF`), as on the tab.
- **Fingering** above the staff, one per note top to bottom: left hand as `T 1 2 3 4`, right hand as `p i m a c`.

## Percussion staff (WP-023)

Drum tracks. Five lines, the percussion clef, no key signature and no accidentals.

- Each note's position and head come from `percussionInstrument(midi)`: crosses for hi-hats and cymbals, diamonds for bells, triangles where conventional, normal heads for drums. A note outside the GM2 map sits on the middle line with a normal head.
- Stems point up with one voice; with two, the file's voices decide: voice 1 up, voice 2 down.
- Rests, beams, flags, dots, ties, tuplets, grace notes and dynamics follow the standard staff.

## Both mode (WP-023)

A track shown as `both` has a standard staff above its tab staff (Guitar Pro's "both"). **Rhythm lives only on the standard staff**: stems, flags, beams, tuplets, rhythm dots, rests, dynamics and fingering are drawn there ([ADR-0021](../decisions/0021-rhythm-on-the-standard-staff-in-both-mode.md)). **Lane effects live only on the tab**: bends, palm mute, let ring, harmonic labels, vibrato, trills, whammy, pick strokes, fades, tapping, slapping and popping are drawn once, in the tab's lanes between the two staves ([ADR-0022](../decisions/0022-lane-effects-once-on-the-tab-in-both-mode.md)); articulations and tremolo strokes belong to the standard staff's heads and stems (#86). A staff module knows it is in both mode when `StaffBar.staves` holds two staves; what the tab staff still draws is in its **Both mode** bullet under [Tab staff](#tab-staff-wp-021).

## Dynamics (WP-022)

One rule for the tab, standard and percussion staves (`packages/layout/src/staves/dynamics.ts`):

1. A **played beat** has at least one note; its dynamic is its first note's.
2. Per voice, a played beat **writes** its dynamic when it differs from the previous played beat of the same voice, searching back across bar lines to the track's first bar. Before a voice's first played beat the dynamic is Guitar Pro's default `f`.
3. The comparison is always with what was played, never with what was written: a beat that writes nothing still becomes its voice's previous beat.
4. At one onset, only the lowest voice that writes a dynamic draws it.

The glyph is centred on its beat in the dynamics lane, its node the beat id. Measuring reads one bar only, so each voice's first played beat and every change within the voice reserve room for a glyph; whatever the rule writes is among them.

## Note effects (WP-022)

The tab staff draws every effect the model holds; the standard and percussion staves draw theirs from #86. The shared code is `packages/layout/src/staves/effects/`, the tab's on-string drawing `packages/layout/src/staves/tab/effects.ts`. Sizes are in staff spaces.

### Lanes

Everything above or below a staff that is not attached to a note head goes in a **lane**: one row per kind, in a fixed order nearest the staff first, as tall as the tallest request among the system's bars (the whole line in continuous mode). Every bar of a system draws a lane at the same y, so labels and lines join across bar lines. A lane exists only when a bar of the system uses it; rows are never shared between kinds.

| Above the staff, from the staff out | Lane | Height |
| --- | --- | --- |
| 0 | inner room: the tab's upper-voice rhythm (else 0.75), and H/P letters over the top string | measured |
| 1 | `bend` | 0.55 per quarter tone of the bar's highest bend, + 1.3 for its label |
| 2 | `articulation` (tab mode) | the stacked glyphs + 0.25 between + 0.4 |
| 3 | `pickStroke` | glyph height + 0.5 |
| 4 | `palmMute` | 1.4 |
| 5 | `letRing` | 1.4 |
| 6 | `harmonic` | 1.4 |
| 7 | `fade` | 1.9 |
| 8 | `tap` | 1.3 |
| 9 | `vibrato` | slight 1.0, wide 1.6 |
| 10 | `beatVibrato` | slight 1.2, wide 1.7 |
| 11 | `trill` | 2.0 |
| 12 | `whammy` | 5.0 |
| 13 | `chord` | 2.2 |
| 14 | `fingering` (tab mode) | 1.1 per row |
| 15 | `text` | 2.0 |
| 16 | `repeatCount`, the system's first staff | 1.6 |

| Below the staff, from the staff out | Lane | Height |
| --- | --- | --- |
| 0 | inner room: voice 1's rhythm in tab mode, and H/P letters under the bottom string | measured |
| 1 | `dynamics` | tab 2.4, five-line 2.9 |
| 2 | `lyrics` | 2.0 per line |

The room around a staff is the larger of its floor (tab 2 above and 1 below, five-line 1.5 each) and the inner room plus the lanes. In a lane, effect text (1.0 spaces) has its baseline 0.35 above the lane's bottom, a glyph its bottom edge 0.25 above it, a wave its centre line in the middle; dynamics hang 0.5 below the lane's top on one baseline.

### Effects on the tab

| Effect | Model | Drawn |
| --- | --- | --- |
| Bend, release, hold, pre-bend | `Note.bend` | From 0.15 right of the widest bent number of the beat to the next onset less 0.6 (at least 1.0 long; at least 2.2 of room right of a bent number). Every value above 0 is drawn 0.55 per quarter tone above the bend lane's bottom (its edge nearest the staff), as alphaTab measures from the staff top, so intermediate values stay above the staff; 0 is the note's string. A bent grace note keeps 1.2 of room right of its column and its bend stops 0.3 short of the next number, with no minimum length. A rise is a curved shaft (0.16) to a filled arrowhead (0.7 × 0.8) with the amount above: `¼ ½ ¾ full 1¼ 1½ 2`. A release is a shaft down to an arrowhead, at 0 ending 0.1 over the beat's topmost bent number (alphaTab's `maxStringNote`), labelled right of the tip otherwise. A hold is a dashed line. A pre-bend (first value above 0) is a vertical arrow from the number at the onset; a tied note continues its bend without one. Equal bends of a chord share their tip, arrowhead and label, and only the top note's pre-bend arrow is drawn. |
| Shift and legato slide | `Note.slide` on the origin | A line (0.12) from 0.15 right of the origin's number to 0.15 left of the next note on the string (in the voice, this bar or the next), rising by 0.6 towards a higher fret and falling towards a lower one. A legato slide adds an arc labelled `sl.`. |
| Slide into and out of | `Note.slide` | A 1.3 line ending 0.2 before the number (into, from below rising, from above falling), or starting 0.2 after it (out, down falling, up rising); 1.5 of room on that side. |
| Hammer-on, pull-off | `Note.hammerPull` on the target | An arc from the origin (the last grace column's note on the string, else the previous note on the string within three bars) to the target, up from the upper half of the strings and down from the rest; `H` (the target's fret is the same or higher) or `P` (1.0 text) 0.25 outside the apex on a paper knockout. Of a beat's arcs pointing one way only the outermost carries its letter. |
| Grace-note connections | the grace note's slide, the main note's hammer-on | From the last grace column into the main note on the string, in one piece. |
| Harmonics | `Note.harmonic` | A natural harmonic writes `<12>` (its node, `value` or the fret, one decimal at most) in place of the fret, `(<12>)` when ghost; the others write a small `<17>` (fret + `value`, 12 without one) at grace size after the number, on its own knockout. Runs of one kind are labelled `N.H.`, `A.H.`, `T.H.`, `P.H.`, `S.H.` or `Fdbk.` in the harmonic lane. |
| Trill | `Note.trill` | The other fret as a small `(7)` after the number (it takes the suffix's place from a harmonic); `tr` (`ornamentTrill`) in the trill lane at the run's first onset, then a wave. |
| Palm mute, let ring | `Note.palmMute`, `Note.letRing` | `P.M.` and `let ring` at the run's first onset, a dashed line (0.6 dash, 0.4 gap, 0.16 thick) to its last onset and an end tick 0.8 tall. A line shorter than 0.3 is left out, so a one-beat run is its label. |
| Vibrato | `Note.vibrato` | A wave from the onset to the run's end less 0.2: slight λ 0.9, amplitude 0.22; wide λ 1.4, amplitude 0.45. The widest in the run wins. |
| Whammy-bar vibrato | `Beat.effects.vibrato` | A sawtooth, slight λ 0.9, amplitude 0.35; wide λ 1.4, amplitude 0.6. |
| Whammy | `Beat.effects.whammy` | `w/bar` (0.9 text) at the run's first onset; per beat a polyline from its onset to the next onset less 0.3, 0.25 per quarter tone around a middle low enough that a label over the highest point clears `w/bar` (clamped at 4); labels (0.8 text) at the extreme point and at a non-zero final point that differs from it. |
| Tapping, slapping, popping | `Beat.effects` | `T`, `S` or `P` centred on the beat in the tap lane; the first of the three that is set. |
| Pick stroke | `Beat.effects.pickStroke` | `stringsDownBow` or `stringsUpBow`, centred. |
| Fade in, fade out, volume swell | `Beat.effects` | `guitarFadeIn`, `guitarFadeOut` or `guitarVolumeSwell`, centred. |
| Staccato, accent, heavy accent | `Note.staccato`, `Note.accent` | Tab mode only: in the articulation lane, a union over the onset's notes, staccato nearest the staff and the accent (or marcato) above it. |
| Tremolo picking | `Beat.effects.tremoloPicking` | Tab mode only: `tremolo1`, `2` or `3` (8, 16, 32) centred on the stem between 0.5 from the strings and the innermost beam or flag; a voice's stems lengthen together when the strokes and 1.0 of room do not fit. On a whole note, where the stem would be. |
| Arpeggio, brush | `Beat.effects.arpeggio`, `brush` | Left of the beat's numbers (1.0 of room, grace columns further left), spanning its strings ± 0.4: a vertical wave (arpeggio) or a line (brush), with an arrowhead towards string 1 for a down stroke and away from it for an up one. |
| Dead and ghost notes | `Note.dead`, `Note.ghost` | `x` and parentheses, as before (WP-021). |

Fermatas, hairpins, tenuto, staccatissimo and the other techniques the model does not hold are not drawn.

### Rules

- **Several voices, one onset.** A lane draws one item per onset: articulations are a union over the onset's notes, the other items come from the first voice that has them.
- **Reservation.** Every item centred on an onset (labels, glyphs, a run's first label, dynamics) reserves half its width + 0.2 either side of the onset; `w/bar` reserves its width to the right. The reservation joins the onset's other room, so items at different onsets cannot overlap. A note-attached extra widens its beat instead (slides, bends, suffixes, stroke arrows).
- **Runs** (palm mute, let ring, harmonics by kind, vibrato, whammy-bar vibrato, trills, whammy) merge the beats carrying the effect across voices on the onset grid: a beat without it, a rest or an empty beat breaks the run. A run that reaches a bar's end and starts the next bar is one run across the bar line: its line ends at the next bar's content and carries on there.
- **Labels at line starts.** A run continuing from the bar before repeats its label at the start of a paged line, not where a continuous line is cut into segments. A line that reaches a system break ends at the system's content end without an end tick.
- **Connections across bar lines** follow the tab's ties: the bar holding the target draws the slide or arc, in one piece when the origin is in this bar or the previous bar of the system and as a half from the bar's left edge otherwise; a bar ending a system draws the origin's half, to its right edge, when the target is in the next bar. Each half of a slide takes half its rise; the letter goes with the target's half.
- **Collisions** are avoided by construction: the lanes are disjoint rows, items at different onsets reserve their widths, and runs of one lane never overlap. H/P and `sl.` letters sit between two onsets and reserve nothing; letters over the top string or under the bottom one enlarge the inner room. Bend shafts and stroke arrows cross the rows between their note and their lane, as in Guitar Pro.

