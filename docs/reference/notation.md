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
- A section played more than twice shows `xN` above the end repeat.

## Header markings (WP-020)

Drawn above a system's first staff, in bands that exist only when a bar of the system needs them, top to bottom:

1. **Sections**: the letter boxed, then the name; a name without a letter is boxed itself.
2. **Tempo**: the mark's label, a metronome note for its unit (dotted for the dotted units) and `= n`, where `n` is the quarter-note `bpm` converted to the unit.
3. **Directions**: segno and coda symbols at the bar start (doubled for segno segno and double coda); `Fine` and the jump instructions (`D.S. al Coda`, `To Coda`, ...) in italics, right-aligned at the bar end, since jumps are read there.
4. **Voltas**: one bracket per run of bars with the same endings, labelled `1., 2.`, with a hook down at the start and, when the run ends on a repeat, at the end. A bracket that continues into the next system carries on without a hook or label.

## Spacing (WP-020)

- Every onset of every visible voice and track gets one column, so simultaneous beats align vertically across tracks and voices.
- The width from one onset to the next is logarithmic in the shortest beat starting at the onset (Gourlay): a 64th is one staff space and each doubling adds 0.7, scaled by the fraction of that beat before the next onset. Nothing is narrower than its contents need.
- A pickup bar (anacrusis) is as wide as what it holds; any other bar spans its whole time signature, so an incomplete bar keeps its empty space.

## Standard staff (WP-023)

Fretted and pitched tracks. Pitches come from the model's `spellNote` and `staffPosition` with the clef in effect and `Track.display.octaveShift`; a `percussion` clef on a pitched track reads as treble.

- **Note heads** by duration: whole, half, black. A dead note has a cross head.
- **Chords** stack by staff position. A head a second (or a unison) from its neighbour goes to the other side of the stem, sharing it: right of an up stem, scanning from the bottom; left of a down stem, scanning from the top; right when there is no stem.
- **Accidentals** are what `spellNote` gives against the key, with measure memory: a printed accidental holds for its letter and octave until the bar line, so a repeat shows nothing and a return to the key's alteration shows a natural (or the key's sign). Grace notes count, in reading order, before their beat. A tied note prints nothing and changes nothing, so the next untied note of that pitch prints again.
- **Courtesy accidentals** (on by default; `standardModule({ courtesyAccidentals: false })` turns them off): the first note of a letter and octave whose accidental the previous bar printed, and which no longer needs one, gets it again in parentheses.
- Accidentals of a chord stack in columns to the left of the heads, outermost first, alternating top and bottom, each in the nearest column where it does not collide vertically; they clear the ledger lines of a note off the staff.
- **Stems**: with one voice on the staff, up when the note furthest from the middle line is below it, down otherwise (a tie goes down); a beamed group takes the direction of its furthest note. With two or more voices, voices 1 and 3 stem up, 2 and 4 down, whatever the pitch. A stem is 3.5 spaces from the note nearest its tip, 0.75 more for each flag or beam past the second, and always reaches the middle line.
- **Flags** for unbeamed eighths and shorter; **beams** over runs of two or more eighths and shorter within a beam window: a beat in simple time (at most a quarter), a dotted quarter in compound time, pairs of eighths in other eighth-based meters with the odd one joining the last pair (5/8 as 2+3). Rests, quarters and longer break a beam; a tuplet is beamed only within itself. A stem alone at a beam level gets a partial beam, pointing right from the first stem and left elsewhere. Beams follow the first and last notes but rise or fall at most one staff space, are horizontal for repeated pitches or when an inner note is further out than both ends, and move out until no stem is shorter than 3 spaces (more with more beams). Thicknesses and spacing are Bravura's engraving defaults.
- **Rests**: a whole rest hangs from the fourth line, a half rest sits on the middle line, shorter rests centre on it. With two voices, voice 1's rests move up and voice 2's down. A rest alone in its voice is centred in the bar.
- **Ledger lines** at every even position past the staff, `legerLineExtension` beyond the heads.
- **Ties** are arcs from the head they continue to the tied head, on the side away from the stem (with two voices, towards it, so the voices' ties part); in a chord the upper half arcs up and the lower half down. A tie across a bar line in the same system is one arc; across a system break it is two halves, to the end of the first system and from the start of the next.
- **Dots** follow the rightmost head; a note on a line dots the space above (the space below for a stem-down voice when there are two).
- **Tuplets**: the number alone over a tuplet that is exactly one beamed group, otherwise a bracket open towards the notes with the number in a gap; on the stem side, past the stems and beams.
- **Grace notes** at 0.6 of the size, stems up, before the beat and its accidentals: a single one as an eighth with a slash, several beamed by their value.
- **Dynamics** below the staff, where a note's dynamics differ from the note sounding before it in reading order. Only the bar before is consulted (so a bar is measured from itself and its predecessor); with no note there, the model's default `f` is assumed.
- **Fingering** above the staff, one per note top to bottom: left hand as `T 1 2 3 4`, right hand as `p i m a c`.

## Percussion staff (WP-023)

Drum tracks. Five lines, the percussion clef, no key signature and no accidentals.

- Each note's position and head come from `percussionInstrument(midi)`: crosses for hi-hats and cymbals, diamonds for bells, triangles where conventional, normal heads for drums. A note outside the GM2 map sits on the middle line with a normal head.
- Stems point up with one voice; with two, the file's voices decide: voice 1 up, voice 2 down.
- Rests, beams, flags, dots, ties, tuplets, grace notes and dynamics follow the standard staff.

## Both mode (WP-023)

A track shown as `both` has a standard staff above its tab staff (Guitar Pro's "both"). **Rhythm lives only on the standard staff**: stems, flags, beams, tuplets, rhythm dots and rests are drawn there, and the tab staff shows fret numbers (and effects) without rhythm notation. A staff module knows it is in both mode when `StaffBar.staves` holds two staves; the tab module reads `staves.includes('standard')` as the signal to leave rhythm out. Dynamics and fingering are drawn by the standard staff in this mode, so the tab staff should leave them out too.
