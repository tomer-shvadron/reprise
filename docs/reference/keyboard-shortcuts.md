# Keyboard shortcuts

Shortcuts follow Guitar Pro where Guitar Pro has one.

The table below is checked against the command registry in `apps/web` by `apps/web/src/app/shortcut-doc.test.ts`, which fails on any difference and prints the table to paste in. WP-101 adds the script that writes it, the contexts and the cheat sheet. Until then, edit it only by pasting the table that test prints.

- A bare key (no Cmd or Ctrl) never fires while typing in a text field.
- Arrows, Home and End stay with a text field or a control that uses them (a slider, a menu); elsewhere they move the playhead.
- Undo and redo in a focused text field undo the field's typing, not the score.
- Space and Enter on a focused button or toggle activate that control; transport buttons do not take focus on click, so Space keeps playing after one.

<!-- shortcuts:start -->
| Command | Category | Context | macOS | Windows |
| ------- | -------- | ------- | ----- | ------- |
| Show command palette | App | Global | ⌘K | Ctrl+K |
| Open file… | File | Global | ⌘O | Ctrl+O |
| Save | File | Global | ⌘S | Ctrl+S |
| Save as… | File | Global | ⇧⌘S | Ctrl+Shift+S |
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
<!-- shortcuts:end -->
