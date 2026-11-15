# local-sounds

Downloaded SFZ sound packs, for manual testing and `pnpm sfz:check` only. Everything in this folder
except this README is gitignored and must never be committed: packs are large, and several licenses
(see [`docs/reference/sound-packs.md`](../docs/reference/sound-packs.md)) do not allow
redistribution.

Put each pack in its own folder and check it:

```sh
pnpm sfz:check local-sounds/<pack>
```

The check parses every `.sfz` under the folder and prints, per file, the regions, the sample files
with their formats and rates, and the opcodes the loader dropped, clamped or does not play. It
fails when the load lost data it should not lose (an unparsable value, an unresolved `#include`, a
path that leaves the pack, a hit work cap), when a sample file is missing (a case-only difference
is named, since packs made on Windows break on Linux) or when a sample header is not WAV, FLAC or
Ogg. Automated tests never read this folder; a bug a local pack exposes is reproduced with
generated samples first.
