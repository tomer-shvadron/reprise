# Keyboard shortcuts

Shortcuts follow Guitar Pro where Guitar Pro has one.

The table below is checked against the command registry in `apps/web` by `apps/web/src/app/shortcut-doc.test.ts`, which fails on any difference and prints the table to paste in. WP-101 adds the script that writes it and the cheat sheet. Until then, edit it only by pasting the table that test prints.

- The Context column is Global, or Editing for a binding that works only in edit mode and wins over a Global binding of the same key.
- Browsers reserve Ctrl+N and ⌘N (as they do Ctrl+T and Ctrl+W) and never pass them to the page in a normal tab, so in the web build New song is reached from the command palette; the desktop app gets the key from its File menu.
- A bare key (no Cmd or Ctrl) never fires while typing in a text field.
- Arrows, Home and End stay with a text field or a control that uses them (a slider, a menu); elsewhere they move the playhead.
- Backspace and Delete stay with a text field whatever the modifiers, so Cmd+Backspace in the palette's input deletes text and never runs an editor command.
- While a modal dialog is open (a dialog, an alert dialog, the command palette), no shortcut and no native menu command runs, except Cmd or Ctrl+K when the palette is the only modal (it closes the palette but opens none over another dialog), and a focused text field's own undo and redo. Escape stays with the dialog. This holds wherever focus is, including on the page behind the dialog. The rules live in the dispatcher's doc comment, `apps/web/src/app/shortcut-dispatcher.ts`.
- Undo and redo in a focused text field undo the field's typing, not the score.
- In edit mode a digit that can start a two-digit fret on the track's neck (1 and 2 on 24 frets) waits 500 ms for a second digit; any other key, a click or moving the cursor commits it at once, and Escape cancels it. Digits never move the cursor, so more digits on the same beat make a chord (with ↑ and ↓ between them); → moves on, and appends a bar past the end of a full last bar.
- The library's song list takes its own keys while it has focus: the arrows, Home, End, Page Up and Page Down move, Enter opens, Delete or Backspace deletes, and L opens the song's practice log. Escape closes the log page.
- Space and Enter on a focused button or toggle activate that control; transport buttons do not take focus on click, so Space keeps playing after one.
- The effect keys are Guitar Pro 8's and work in edit mode only. Each toggles: when every note it acts on already has the effect it comes off all of them, otherwise it goes on the notes that lack it, as one undo step labelled with the effect. A note effect goes on the notes picked, or on every note of the beat the cursor or range is on; a beat effect (tapping, tremolo picking, fades, pick strokes, brush, arpeggio, whammy-bar vibrato) goes on the beat. H marks the note as the origin of a hammer-on or pull-off, so it sets the flag on the next note on that string. A refusal reads on the edit status line.
- The punctuation effect keys (`;` `:` `!` `"` `)` `$` `<` `>`) are bound in both spellings, shifted and unshifted, because US needs Shift for most of them and other layouts do not; the table lists the shifted one first. On French and Belgian AZERTY two of the unshifted spellings never fire, because `$` is the physical `]` key (repeat end) and `"` is the physical `3` key (the fret digit), and those commands come first. A physical-key fallback for non-Latin layouts is tracked under #242, and until it lands those keys are reachable through Shift on US and through the command palette everywhere. The bend and whammy presets are palette-only until the effects panel (WP-082 PR B) adds the pickers (B, ⇧S, ⌥Y, ⌥V, N, G and ⌥G).

<!-- shortcuts:start -->
| Command | Category | Context | macOS | Windows |
| ------- | -------- | ------- | ----- | ------- |
| Show command palette | App | Global | ⌘K | Ctrl+K |
| New song | File | Global | ⌘N | Ctrl+N |
| Open file… | File | Global | ⌘O | Ctrl+O |
| Save | File | Global | ⌘S | Ctrl+S |
| Save as… | File | Global | ⇧⌘S | Ctrl+Shift+S |
| Export as Guitar Pro… | File | Global | ⇧⌘E | Ctrl+Shift+E |
| Close file | File | Global | — | — |
| Show import details | File | Global | — | — |
| Print… | File | Global | ⌘P | Ctrl+P |
| Undo | Edit | Global | ⌘Z | Ctrl+Z |
| Redo | Edit | Global | ⇧⌘Z | Ctrl+Shift+Z or Ctrl+Y |
| Zoom in | View | Global | ⌘= | Ctrl+= |
| Zoom out | View | Global | ⌘- | Ctrl+- |
| Actual size | View | Global | ⌘0 | Ctrl+0 |
| Toggle light and dark theme | View | Global | ⇧⌘L | Ctrl+Shift+L |
| Toggle tracks | View | Global | — | — |
| Toggle mixer | View | Global | F8 | F8 |
| Toggle page and continuous view | View | Global | F4 | F4 |
| Follow playback | View | Global | — | — |
| Toggle multitrack view | View | Global | F3 | F3 |
| Play or pause | Transport | Global | Space | Space |
| Stop | Transport | Global | ↩ | Enter |
| Play from start | Transport | Global | ⇧Space | Shift+Space |
| Toggle loop | Transport | Global | F9 | F9 |
| Toggle count-in | Transport | Global | ⌥C | Alt+C |
| Toggle metronome | Transport | Global | ⌥M | Alt+M |
| Metronome volume… | Transport | Global | ⌥⇧M | Alt+Shift+M |
| Master volume… | Transport | Global | ⌥⇧V | Alt+Shift+V |
| Set tempo… | Transport | Global | ⌥T | Alt+T |
| Slow down 5% | Transport | Global | [ | [ |
| Speed up 5% | Transport | Global | ] | ] |
| Toggle relative speed | Transport | Global | ⌘F9 | Ctrl+F9 |
| Announce position | Transport | Global | ⌥P | Alt+P |
| Previous beat | Transport | Global | ← | Left |
| Next beat | Transport | Global | → | Right |
| Previous bar | Transport | Global | ⌘← | Ctrl+Left |
| Next bar | Transport | Global | ⌘→ | Ctrl+Right |
| Start of bar | Transport | Global | ↖ | Home |
| First bar | Transport | Global | ⌘↖ | Ctrl+Home |
| Last bar | Transport | Global | ⌘↘ | Ctrl+End |
| Extend selection to previous bar | Transport | Global | ⇧⌘← | Ctrl+Shift+Left |
| Extend selection to next bar | Transport | Global | ⇧⌘→ | Ctrl+Shift+Right |
| Previous track | Track | Global | ⌘↑ | Ctrl+Up |
| Next track | Track | Global | ⌘↓ | Ctrl+Down |
| Mute or unmute current track | Track | Global | — | — |
| Solo or unsolo current track | Track | Global | — | — |
| Unmute and unsolo all tracks | Track | Global | — | — |
| Show all tracks | Track | Global | — | — |
| Show current track as tab | Track | Global | — | — |
| Show current track as standard notation | Track | Global | — | — |
| Show current track as tab and standard notation | Track | Global | — | — |
| Track properties… | Track | Global | F6 | F6 |
| Add track… | Track | Global | ⌥⌘N | Ctrl+Shift+Insert |
| Remove track… | Track | Global | — | — |
| Move track up | Track | Global | — | — |
| Move track down | Track | Global | — | — |
| Show library | Library | Global | — | — |
| Import files to library… | Library | Global | — | — |
| Import folder to library… | Library | Global | — | — |
| Open without importing… | Library | Global | — | — |
| Open recent song… | Library | Global | — | — |
| Show speed trainer | Trainer | Global | — | — |
| Start, hold or resume speed trainer | Trainer | Global | ⌥S | Alt+S |
| Mark speed trainer pass missed | Trainer | Global | ⌥X | Alt+X |
| Reset speed trainer | Trainer | Global | ⌥⇧S | Alt+Shift+S |
| Show tuner | Trainer | Global | — | — |
| Show metronome | Trainer | Global | — | — |
| Start or stop standalone metronome | Trainer | Global | ⌥B | Alt+B |
| Toggle fretboard | Trainer | Global | — | — |
| Toggle edit mode | Editor | Global | ⌘E | Ctrl+E |
| Cursor to previous beat | Editor | Editing | ← | Left |
| Cursor to next beat | Editor | Editing | → | Right |
| Cursor up a string | Editor | Editing | ↑ | Up |
| Cursor down a string | Editor | Editing | ↓ | Down |
| Cursor to start of bar | Editor | Editing | ↖ | Home |
| Cursor to end of bar | Editor | Editing | ↘ | End |
| Cursor to previous bar | Editor | Editing | ⌘← | Ctrl+Left |
| Cursor to next bar | Editor | Editing | ⌘→ | Ctrl+Right |
| Cursor to start of score | Editor | Editing | ⌘↖ | Ctrl+Home |
| Cursor to end of score | Editor | Editing | ⌘↘ | Ctrl+End |
| Cursor to previous system | Editor | Editing | PageUp | PageUp |
| Cursor to next system | Editor | Editing | PageDown | PageDown |
| Extend selection to previous beat | Editor | Editing | ⇧← | Shift+Left |
| Extend selection to next beat | Editor | Editing | ⇧→ | Shift+Right |
| Extend selection to previous track | Editor | Editing | ⇧↑ | Shift+Up |
| Extend selection to next track | Editor | Editing | ⇧↓ | Shift+Down |
| Extend selection to previous bar | Editor | Editing | ⇧⌘← | Ctrl+Shift+Left |
| Extend selection to next bar | Editor | Editing | ⇧⌘→ | Ctrl+Shift+Right |
| Clear selection | Editor | Editing | Escape | Escape |
| Type fret digit | Editor | Editing | 0 or 1 or 2 or 3 or 4 or 5 or 6 or 7 or 8 or 9 | 0 or 1 or 2 or 3 or 4 or 5 or 6 or 7 or 8 or 9 |
| Longer duration | Editor | Editing | - | - |
| Shorter duration | Editor | Editing | = or ⇧+ or + | = or Shift++ or + |
| Toggle dot | Editor | Editing | . | . |
| Toggle double dot | Editor | Editing | ⌘. | Ctrl+. |
| Toggle triplet | Editor | Editing | / | / |
| Toggle tie | Editor | Editing | L | L |
| Rest | Editor | Editing | R | R |
| Insert beat after | Editor | Editing | ↩ | Enter |
| Delete note | Editor | Editing | Backspace or Delete | Backspace or Delete |
| Delete beat | Editor | Editing | ⇧Backspace | Shift+Delete |
| Edit voice 1 | Editor | Editing | ⌘1 | Ctrl+1 |
| Edit voice 2 | Editor | Editing | ⌘2 | Ctrl+2 |
| Toggle insert mode | Editor | Editing | — | — |
| Insert bar before | Editor | Editing | ⌘+ or ⇧⌘+ or ⇧⌘= | Insert |
| Insert bar after | Editor | Editing | — | — |
| Delete bars | Editor | Editing | ⌘Backspace | Ctrl+Delete |
| Toggle repeat start | Editor | Editing | [ | [ |
| Toggle repeat end | Editor | Editing | ] | ] |
| Bar properties… | Editor | Editing | ⌘T | Ctrl+T |
| Key signature… | Editor | Editing | — | — |
| Tempo change… | Editor | Editing | — | — |
| Repeats and endings… | Editor | Editing | — | — |
| Directions… | Editor | Editing | D | D |
| Section… | Editor | Editing | — | — |
| Toggle legato slide | Editor | Editing | S | S |
| Toggle hammer-on or pull-off | Editor | Editing | H | H |
| Toggle vibrato | Editor | Editing | V | V |
| Toggle wide vibrato | Editor | Editing | ⇧V | Shift+V |
| Toggle palm mute | Editor | Editing | P | P |
| Toggle palm mute on the beat | Editor | Editing | ⇧P | Shift+P |
| Toggle let ring | Editor | Editing | I | I |
| Toggle dead note | Editor | Editing | X | X |
| Toggle ghost note | Editor | Editing | O | O |
| Toggle accent | Editor | Editing | ; | ; |
| Toggle heavy accent | Editor | Editing | ⇧: or : | Shift+: or : |
| Toggle staccato | Editor | Editing | ⇧! or ! | Shift+! or ! |
| Toggle natural harmonic | Editor | Editing | Y | Y |
| Toggle tremolo picking | Editor | Editing | ⇧" or " | Shift+" or " |
| Toggle tapping | Editor | Editing | ⇧) or ) | Shift+) or ) |
| Toggle slap | Editor | Editing | ⇧$ or $ | Shift+$ or $ |
| Toggle pop | Editor | Editing | — | — |
| Toggle pick stroke down | Editor | Editing | ⇧D | Shift+D |
| Toggle pick stroke up | Editor | Editing | ⇧U | Shift+U |
| Toggle fade in | Editor | Editing | ⇧< or < | Shift+< or < |
| Toggle fade out | Editor | Editing | ⇧> or > | Shift+> or > |
| Toggle volume swell | Editor | Editing | — | — |
| Toggle whammy-bar vibrato | Editor | Editing | W | W |
| Toggle wide whammy-bar vibrato | Editor | Editing | ⌥W | Alt+W |
| Toggle brush down | Editor | Editing | ⌘D | Ctrl+D |
| Toggle brush up | Editor | Editing | ⌘U | Ctrl+U |
| Toggle arpeggio down | Editor | Editing | ⇧⌘D | Ctrl+Shift+D |
| Toggle arpeggio up | Editor | Editing | ⇧⌘U | Ctrl+Shift+U |
| Bend: ¼ bend | Editor | Editing | — | — |
| Bend: ¼ bend and release | Editor | Editing | — | — |
| Bend: ¼ prebend | Editor | Editing | — | — |
| Bend: ¼ prebend and release | Editor | Editing | — | — |
| Bend: ½ bend | Editor | Editing | — | — |
| Bend: ½ bend and release | Editor | Editing | — | — |
| Bend: ½ prebend | Editor | Editing | — | — |
| Bend: ½ prebend and release | Editor | Editing | — | — |
| Bend: Full bend | Editor | Editing | — | — |
| Bend: Full bend and release | Editor | Editing | — | — |
| Bend: Full prebend | Editor | Editing | — | — |
| Bend: Full prebend and release | Editor | Editing | — | — |
| Whammy: ½ step dive | Editor | Editing | — | — |
| Whammy: ½ step dip | Editor | Editing | — | — |
| Whammy: ½ step release up | Editor | Editing | — | — |
| Whammy: Whole step dive | Editor | Editing | — | — |
| Whammy: Whole step dip | Editor | Editing | — | — |
| Whammy: Whole step release up | Editor | Editing | — | — |
| Whammy: 2 steps dive | Editor | Editing | — | — |
| Whammy: 2 steps dip | Editor | Editing | — | — |
| Whammy: 2 steps release up | Editor | Editing | — | — |
| Show sound manager | Sounds | Global | — | — |
<!-- shortcuts:end -->
