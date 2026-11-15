# Sounds

**Owner**: the audio lane (`[P:audio]`). **Filled by**: WP-091 (sound pack manager) and WP-094
(memory UI and tuning). The engine work of WP-090, WP-092 and WP-093 lands in `packages/audio`.

Today it holds only the entry points the lead stubbed in WP-056:

| Export                          | What it is                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `SoundManager`                  | A placeholder naming WP-091. The app shows it over the score while `ui.screen` is `'sounds'`. |
| `soundsCommands` (`./commands`) | `sounds.show` ("Show sound manager"), which sets the screen.                                  |

## What it can rely on

- `ui.screen` and `ui.setScreen`: the sound manager is a full-window screen.
- `playback.memory` mirrors the engine's memory report, for the readout of WP-094.
- `platform().dataDir()` for `sounds/<id>/`.

Per-track sound assignment shows in the mixer (`features/tracks`, the lead's); WP-091 adds the
control through a small export that the lead wires, not by editing the mixer. Needing a shared
store field is a `type:contract` issue for the lead.
