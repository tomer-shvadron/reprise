# Keyboard shortcuts

Shortcuts follow Guitar Pro where Guitar Pro has one.

## Changing keys

Settings, Keyboard (⌘, or Ctrl+,) lists every command with its key. Click a key, press the new one; Escape cancels and Tab leaves. A key can be cleared (the × button) or reset to its default (↺), and "Restore defaults" resets them all. Your keys are stored on this machine as the `keyboard.shortcuts` setting, one entry per changed command.

The table below lists the Guitar Pro defaults. The cheat sheet, the command palette, the tooltips and the context menus show your keys. The desktop menu shows them too, except a key with neither Cmd/Ctrl nor Alt (a bare letter, Space, Enter, an arrow, Shift alone): the renderer sends the menu no key for those, so a menu accelerator can never swallow typing in a text field. F-keys are the exception and go to the menu. The renderer still runs those keys itself.

- A key another command holds in the same context is offered as a swap: the other command takes this command's old key (or none). A key held by a command in the other context (an editing key over a global one) is allowed; the editing key wins while editing.
- Not changeable: copy, cut and paste (the browser's), Escape (it always backs out and cancels recording), and the fret digits (typed values, not shortcuts). Each alias (a second key for one command) is its own key in the command's row.
- Refused when recording, because the system keeps them: on every platform Cmd or Ctrl with Q, W, H or M, and Cmd or Ctrl+Alt+H (the desktop menu keeps these for its own roles); on macOS also any Control combination, ⌘Space and ⌘`; on Windows also any Windows-key combination, Alt+F4, Ctrl+F4, Alt+Space and F10; everywhere select all (⌘A, Ctrl+A) and the copy, cut and paste keys. Keys the browser or the operating system never pass to the page (⌘N, Ctrl+T) cannot be recorded; the recorder keeps waiting.
- A recorded key matches the way the defaults do: the printed character, with a letter or digit falling back to the physical key on a layout that prints something else (Hebrew, an Option symbol on macOS), and brackets by physical key. The physical key's code is stored beside it for #242, which may change how keys match on other layouts.
- A change of the Settings data later: an entry for a command that no longer exists stays stored and is ignored; a PR that renames a command id carries the old id's entry across in `apps/web/src/app/keymap.ts`. A new default that collides with a user's key loses to it.
- Not configurable, because they are not commands: the palette's Enter and ⌘Enter, the chord field's Tab, the library list's keys, the track list's own keys and the dialogs' keys.

The table is generated from the command registry in `apps/web`, always with the defaults: `apps/web/src/app/shortcut-doc.test.ts` fails on any difference, and `pnpm shortcuts:write` regenerates it, so never edit it by hand. The in-app cheat sheet (`?` or ⌘/, Ctrl+/ on Windows) filters by command, category or key. The desktop menu takes its accelerators from the same registry: the renderer sends them over `menu:set-keys` once the settings load, and again on every change, and `apps/desktop/src/main/menu.ts` keeps labels only, so the menu shows no keys for a moment at launch. The same test fails when two commands share a key in one context.

- Palette prefixes (#338): the first character typed in the command palette picks what it searches, and it stays in the input, so Backspace takes it away. `>` or nothing is commands; `#` is the song's section markers; `@` is its tracks (a number picks the track with that number); `/` is the library's songs; a number alone is a bar. Enter goes to a section or bar, selects a track or opens a song; ⌘Enter (Ctrl+Enter on Windows) does the alternate: loops the section or bar, shows only that track, or, for a command or a song, the same as Enter. The footer names both keys for the selected row. ⌘G (Ctrl+G) opens the palette locked to bar mode, and Go to section…, Go to track… and Open song from library… reach the other modes without the prefix character.
- Practice mode (#341): F11 enters and leaves it and Escape leaves it, the pair Guitar Pro 8 uses for full screen. Escape goes to an open dialog, popover or field first, so a first press may only close that. Every other shortcut works inside the mode. On macOS, F11 is Show Desktop unless it is turned off in System Settings (Keyboard, Keyboard Shortcuts, Mission Control); the header's Practice segment and the command palette reach the mode without it. In the web build the page gets F11 first and the mode takes it, except while the browser itself is in full screen, when the browser keeps the key (not checked in a browser tab; the segment, the palette and Focus on loop do not depend on it). Starting the speed trainer, the click or the tuner (⌥S, ⌥B) from inside the mode opens no panel, which would end it.
- The Context column is Global, or Editing for a binding that works only in edit mode and wins over a Global binding of the same key.
- Browsers reserve Ctrl+N and ⌘N (as they do Ctrl+T and Ctrl+W) and never pass them to the page in a normal tab, so in the web build New song is reached from the command palette; the desktop app gets the key from its File menu.
- A bare key (no Cmd or Ctrl) never fires while typing in a text field.
- Arrows, Home and End stay with a text field or a control that uses them (a slider, a menu); elsewhere they move the playhead.
- Backspace and Delete stay with a text field whatever the modifiers, so Cmd+Backspace in the palette's input deletes text and never runs an editor command.
- While a modal dialog is open (a dialog, an alert dialog, the command palette), no shortcut and no native menu command runs, except Space for play and pause over the Library and Sounds sheets (not in a text field), and a dialog's own toggle when that dialog is the only modal (Cmd or Ctrl+K closes the palette, Cmd or Ctrl+G switches it to a bar number, `?` or Cmd or Ctrl+/ closes the cheat sheet, and neither opens over another dialog), and a focused text field's own undo and redo. Escape stays with the dialog. This holds wherever focus is, including on the page behind the dialog. The rules live in the dispatcher's doc comment, `apps/web/src/app/shortcut-dispatcher.ts`.
- In edit mode, ⌘C, ⌘X and ⌘V (Ctrl on Windows) copy, cut and paste notes, beats or whole bars, through the browser's own clipboard events: the key is left to the browser, which is why Copy, Cut and Paste show their keys here but the dispatcher never runs them. Paste follows the status bar's insert or overwrite mode; Paste as insert and Paste over, in the palette, choose one. Text fields and dialogs keep their own copy, cut and paste, and so does selected text anywhere on the page.
- Undo and redo in a focused text field undo the field's typing, not the score. The palette and the desktop Edit menu name the step: "Undo Insert bar", "Redo Paste"; Show history opens a panel listing every step, where a click or Enter jumps to that point.
- In edit mode a digit that can start a two-digit fret on the track's neck (1 and 2 on 24 frets) waits 500 ms for a second digit; any other key, a click or moving the cursor commits it at once, and Escape cancels it. Digits never move the cursor, so more digits on the same beat make a chord (with ↑ and ↓ between them); → moves on, and appends a bar past the end of a full last bar.
- The library's song list takes its own keys while it has focus: the arrows, Home, End, Page Up and Page Down move, Enter opens, Delete or Backspace deletes, and L opens the song's practice log. Escape closes the log page first, then the Library sheet.
- The tracks list takes its own keys while a track's name has focus: Up, Down, Home and End move between tracks, Enter selects, and M and S mute and solo that track. Shift+F6 moves focus from the score to the current track in the list and back. Alt+1 to Alt+9 jump straight to a track by the number the list shows. Alt+1 to Alt+4 depart from Guitar Pro 8, where they are Move Voice; Reprise has no voice move yet, and one that arrives takes another key. Cmd/Ctrl+1 and Cmd/Ctrl+2 are the edit voices.
- Shift+F10 opens the context menu of the focused control, and so does the Menu key on a keyboard that has one: Windows and Linux raise the menu themselves, so the key is left to the browser there, and on macOS the app opens it. A right-click opens the same menu at the pointer. Escape closes it and returns focus to the control that had it.
- Space and Enter on a focused button or toggle activate that control; transport and header buttons do not take focus on click, so Space keeps playing after one.
- The effect keys are Guitar Pro 8's and work in edit mode only. Each toggles: when every note it acts on already has the effect it comes off all of them, otherwise it goes on the notes that lack it, as one undo step labelled with the effect. A note effect goes on the notes picked, or on every note of the beat the cursor or range is on; a beat effect (tapping, tremolo picking, fades, pick strokes, brush, arpeggio, whammy-bar vibrato) goes on the beat. H marks the note as the origin of a hammer-on or pull-off, so it sets the flag on the next note on that string. A refusal reads in the status bar.
- The punctuation effect keys (`;` `:` `!` `"` `)` `$` `<` `>`) are bound in both spellings, shifted and unshifted, because US needs Shift for most of them and other layouts do not; the table lists the character once, as you type it. On French and Belgian AZERTY two of the unshifted spellings never fire, because `$` is the physical `]` key (repeat end) and `"` is the physical `3` key (the fret digit), and those commands come first. A physical-key fallback for non-Latin layouts is tracked under #242, and until it lands those keys are reachable through Shift on US and through the command palette everywhere. The effects that take a choice open a modal dialog, so no key reaches the score under it: B (bend), ⇧S (slide kinds), ⌥Y (harmonic kinds), ⌥V (whammy bar), and G or ⌥G (a grace note before the beat or on it). Arrows move over the choices, Enter or Space applies and closes, Escape cancels. Up and Down move by row, Left and Right in reading order. Focus goes back to where it was; after a click on the panel's button it stays with the score. N is Guitar Pro's trill key: it takes the trill off when every note has one, and otherwise opens the trill dialog (how many frets above each note to trill to, two by default, and the speed). The tremolo speed (8th, 16th, 32nd) and dynamics dialogs have no key, as Guitar Pro has none; the panel and the command palette open them. "Toggle effects panel" has no key; it is in the command palette, and the right panel shows every effect as a button with its state.
- Transposition and string moves (WP-085): ⌥⇧↑ and ⌥⇧↓ move the selected notes (the range's, the picked ones, or the note under the cursor) one semitone along their own strings, as Guitar Pro 8 does, and change nothing else: chord names and the key move only through Transpose… in the command palette, which asks for −24 to +24 semitones over the selection, the current track or all tracks, and offers the key only when every pitched track is in scope. ⌥↑ and ⌥↓ move the selected notes to the string above or below, keeping their pitch; with one note under the cursor the cursor follows it, so the key repeats. A note that would leave the neck, or an occupied string, refuses the whole move with a sentence naming the bar, and nothing changes. Each press is one undo step. A text field keeps these keys when it has focus.
- The chord, text and lyrics field (A, T and ⌥L) is a text field over the score at the beat it edits, so it keeps the bare keys while open and nothing else acts under it. Its own keys: Tab and ⇧Tab commit and move to the next or previous beat, Enter commits and closes, Escape drops what was typed and closes, and clicking away commits. In lyrics, Space (or `-`, which keeps a hyphen on the syllable) commits and moves to the next played beat of voice 1, Space in an empty field leaves the beat empty, ⇧Space types a space inside a syllable, ↑ and ↓ switch among the five lyric lines, and Backspace in an empty field steps back a beat. In a chord name, ↑ and ↓ walk the names the song already uses and Enter or Tab takes the highlighted one. Each committed beat is one undo step.

<!-- shortcuts:start -->
| Command | Category | Context | macOS | Windows |
| ------- | -------- | ------- | ----- | ------- |
| Show command palette | App | Global | ⌘K | Ctrl+K |
| Go to bar… | App | Global | ⌘G | Ctrl+G |
| Go to section… | App | Global | — | — |
| Go to track… | App | Global | — | — |
| Open song from library… | App | Global | — | — |
| Show keyboard shortcuts | App | Global | ? or ⌘/ | ? or Ctrl+/ |
| Open context menu | App | Global | ⇧F10 | Shift+F10 |
| Settings… | App | Global | ⌘, | Ctrl+, |
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
| Toggle right panel | View | Global | — | — |
| Toggle page and continuous view | View | Global | F4 | F4 |
| Follow playback | View | Global | — | — |
| Toggle practice mode | View | Global | F11 | F11 |
| Leave practice mode | View | Global | Escape | Escape |
| Focus on loop | View | Global | — | — |
| Toggle multitrack view | View | Global | F3 | F3 |
| Play or pause | Transport | Global | Space | Space |
| Stop | Transport | Global | ↩ | Enter |
| Play from start | Transport | Global | ⇧Space | Shift+Space |
| Toggle loop | Transport | Global | F9 | F9 |
| Play from selection | Transport | Global | — | — |
| Loop selection | Transport | Global | — | — |
| Loop this section | Transport | Global | — | — |
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
| Go to track 1 | Track | Global | ⌥1 | Alt+1 |
| Go to track 2 | Track | Global | ⌥2 | Alt+2 |
| Go to track 3 | Track | Global | ⌥3 | Alt+3 |
| Go to track 4 | Track | Global | ⌥4 | Alt+4 |
| Go to track 5 | Track | Global | ⌥5 | Alt+5 |
| Go to track 6 | Track | Global | ⌥6 | Alt+6 |
| Go to track 7 | Track | Global | ⌥7 | Alt+7 |
| Go to track 8 | Track | Global | ⌥8 | Alt+8 |
| Go to track 9 | Track | Global | ⌥9 | Alt+9 |
| Move focus between the tracks list and the score | Track | Global | ⇧F6 | Shift+F6 |
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
| Start or stop tuner | Trainer | Global | — | — |
| Show metronome | Trainer | Global | — | — |
| Start or stop standalone metronome | Trainer | Global | ⌥B | Alt+B |
| Toggle fretboard | Trainer | Global | — | — |
| Speed trainer on selection | Trainer | Global | — | — |
| Show fretboard | Trainer | Global | — | — |
| Toggle edit mode | Editor | Global | ⌘E | Ctrl+E |
| Edit here | Editor | Global | — | — |
| Show history | Editor | Global | — | — |
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
| Type fret digit | Editor | Editing | 0–9 | 0–9 |
| Longer duration | Editor | Editing | - | - |
| Shorter duration | Editor | Editing | = or + | = or + |
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
| Insert bar before | Editor | Editing | ⌘+ or ⌘= | Insert |
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
| Toggle heavy accent | Editor | Editing | : | : |
| Toggle staccato | Editor | Editing | ! | ! |
| Toggle natural harmonic | Editor | Editing | Y | Y |
| Toggle tremolo picking | Editor | Editing | " | " |
| Toggle tapping | Editor | Editing | ) | ) |
| Toggle slap | Editor | Editing | $ | $ |
| Toggle pop | Editor | Editing | — | — |
| Toggle pick stroke down | Editor | Editing | ⇧D | Shift+D |
| Toggle pick stroke up | Editor | Editing | ⇧U | Shift+U |
| Toggle fade in | Editor | Editing | < | < |
| Toggle fade out | Editor | Editing | > | > |
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
| Bend… | Editor | Editing | B | B |
| Slide… | Editor | Editing | ⇧S | Shift+S |
| Harmonic… | Editor | Editing | ⌥Y | Alt+Y |
| Whammy bar… | Editor | Editing | ⌥V | Alt+V |
| Trill… | Editor | Editing | N | N |
| Tremolo picking speed… | Editor | Editing | — | — |
| Dynamics… | Editor | Editing | — | — |
| Grace note… | Editor | Editing | G | G |
| Grace note on the beat… | Editor | Editing | ⌥G | Alt+G |
| Toggle effects panel | Editor | Global | — | — |
| Copy | Editor | Editing | ⌘C | Ctrl+C |
| Cut | Editor | Editing | ⌘X | Ctrl+X |
| Paste | Editor | Editing | ⌘V | Ctrl+V |
| Paste as insert | Editor | Editing | — | — |
| Paste over | Editor | Editing | — | — |
| Copy bars | Editor | Global | — | — |
| Transpose… | Editor | Editing | — | — |
| Transpose up a semitone | Editor | Editing | ⌥⇧↑ | Alt+Shift+Up |
| Transpose down a semitone | Editor | Editing | ⌥⇧↓ | Alt+Shift+Down |
| Move to the string above | Editor | Editing | ⌥↑ | Alt+Up |
| Move to the string below | Editor | Editing | ⌥↓ | Alt+Down |
| Chord name | Editor | Editing | A | A |
| Beat text | Editor | Editing | T | T |
| Lyrics | Editor | Editing | ⌥L | Alt+L |
| Show sound manager | Sounds | Global | — | — |
<!-- shortcuts:end -->
