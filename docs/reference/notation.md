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

Cancelling naturals on a key change are not drawn yet; the change leaves a staff space for them.

## Time signatures (WP-020)

- Shown at the first bar and wherever the signature changes, on every staff, tab included. Numerator above the middle, denominator below, each digit glyph centred on its row.
- On a tab staff the digits grow with the staff, up to half again their size, so they span it.

## Bar lines and repeats (WP-020)

- At the end of a bar, in priority order: a repeat end (light-heavy with dots in front), the score's final bar line (light-heavy), a double bar (two light lines), a single line. Thicknesses and separations are Bravura's engraving defaults.
- A start repeat (heavy-light with dots after) follows the bar's clef change, key and time signature.
- A system with two or more staves opens with a bar line joining them; a single staff starts without one.
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
