# local-tabs

Tomer's downloaded Guitar Pro files, for manual testing only. Everything in this folder except this
README is gitignored and must never be committed: these tabs are someone else's work, usually
commercial, and their licenses do not allow redistribution.

Automated tests use the open-licensed corpus in [`fixtures/`](../fixtures/LICENSES.md) instead. If a
local tab exposes a bug, reproduce it in a fixture we can license (or one our own writer produces)
before writing the test.

`pnpm check:files local-tabs` runs the automated real-file pass over this folder; reports go to the
gitignored `.check-files/`, and the listening checklist is
[`docs/reference/player-checklist.md`](../docs/reference/player-checklist.md). Never name a tab in an
issue, a PR or a comment: refer to it by its label in `.check-files/summary.md` (`local-3 (sha256 …)`),
which is all the pass itself ever prints or writes about it.
