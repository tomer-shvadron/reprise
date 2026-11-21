# Releasing Reprise

Installers are built by [`.github/workflows/release.yml`](../../.github/workflows/release.yml). The builds are unsigned and not notarized ([ADR-0003](../decisions/0003-desktop-only-electron.md)), so the install notes in [`.github/release/install.md`](../../.github/release/install.md) tell people how to get past the first-launch warning.

## What the workflow does

It runs on a `v*` tag, on `workflow_dispatch`, on every PR that touches what the desktop build reads, and on every push to `main` that does (the same paths list, one anchor in the workflow): the desktop app, the release scripts, the workflow itself, the renderer's entry and config (`apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/public/**`, `csp.ts`), `scripts/sounds/**`, `scripts/desktop/**`, the root `package.json`, the lockfile and `.nvmrc`. A PR that changes only the web app's other source or `packages/**` does not run it, so a green PR run says little about the commit you tag: step 1 of cutting a release runs it on that commit. On a PR or a push to `main` nothing is released. A PR packages `mac-arm64` and `windows-x64` only; `mac-x64`, the slowest job, runs on pushes to `main`, tags and dispatches (a PR that needs it can run all three first: `gh workflow run release.yml --ref <branch>`), so the lead checks the `Release` run on `main` after merging a desktop PR.

The `package (...)` checks are path-filtered and not required: only `ci` gates a merge. A red `package` check on a desktop PR still blocks the lead's merge by decision ([AGENTS.md](../../AGENTS.md#github)).

**`gate`**, first on every run: reads the version (a tag goes through `scripts/release/version.ts`, anything else gets `0.0.0-ci.<run>`) and on a tag fails if the tag's commit is not on `main` or if a release for the tag already exists, before any runner minutes are spent.

**`package`**, one job per target, each building its own arch natively and smoking what it built:

| Runner           | Builds                                                    |
| ---------------- | --------------------------------------------------------- |
| `macos-15`       | `Reprise-<v>-mac-arm64.dmg` and `.zip`                    |
| `macos-15-intel` | `Reprise-<v>-mac-x64.dmg` and `.zip`                      |
| `windows-2025`   | `Reprise-<v>-windows-x64-setup.exe` (NSIS, per-user)      |

Per job: install, resolve the version, build with `electron-builder` (`--publish never`, no signing identity), on macOS `codesign --verify --deep --strict` on the app, then `pnpm desktop:smoke` with `REPRISE_EXPECTED_VERSION`. The smoke checks the shipped fuses, that the sandbox holds, that the version is the one built, then opens a fixture, plays it, copies a bar as ASCII tab and the selection as ASCII tab and as an image and reads them back from the system clipboard, edits, kills the app, recovers the draft, closes the window and expects exit code 0; on Windows it also starts the tuner on Chromium's fake microphone. The installers are uploaded as the artifact `installers-<target>` for 14 days, so a PR's installer can be tried before any tag exists.

**`release`**, only on a `v*` tag, with `contents: write` (every other job has `contents: read`):

1. Checks the downloaded files are exactly the five above for that version, and writes `SHA256SUMS.txt`.
2. Creates a **draft** release with `install.md` first and then the generated notes. A version with a pre-release part (`v1.0.0-rc.1`) is also marked prerelease, so it never becomes "Latest".

The version comes from the tag through `scripts/release/version.ts`, which accepts `v<major>.<minor>.<patch>` with an optional `-<prerelease>` and nothing else, and reaches the app through `-c.extraMetadata.version`: the artifact names, `app.getVersion()`, About and the file versions follow it, and no file in the checkout changes. A local `pnpm desktop:build` stays `0.0.0` and packages the host arch only.

## Cutting a release

1. On the exact commit to be tagged, run the workflow by hand and wait for all three `package` jobs to be green: `gh workflow run release.yml --ref main`, then `gh run watch`. Check `git rev-parse origin/main` is that commit. The PR runs are path-filtered and may be weeks old.
2. Tag that commit and push the tag. Never move or reuse a tag.

   ```sh
   git tag v1.0.0-rc.1 origin/main && git push origin v1.0.0-rc.1
   ```

3. Wait for the run, then open the draft (`gh release view v1.0.0-rc.1`): five installers, `SHA256SUMS.txt`, the install notes and the generated notes.
4. Try it (the owner's checklist below). If something is wrong, fix it on `main` and tag the next candidate (`rc.2`). A failed draft can be deleted with `gh release delete v1.0.0-rc.1 --cleanup-tag`.
5. If the tag's run fails or is re-run after the draft exists, the `gate` job stops it ("a release for the tag already exists"). Delete the draft and re-run the failed run: `gh release delete v1.0.0-rc.1` (without `--cleanup-tag`, which would delete the tag the run needs), then "Re-run all jobs". A run that failed before the `release` job needs no deletion.
6. For the final version, tag `v1.0.0` the same way, then the owner publishes the draft by hand: `gh release edit v1.0.0 --draft=false --latest`.

## Owner's checklist on a release candidate

CI cannot do these; the Intel Mac build is only checked by its runner's smoke.

1. Download the macOS dmg in a browser, so it is quarantined, and drag the app to Applications. Launch it: on macOS 15 and later the route is System Settings → Privacy & Security → Open Anyway, as the notes say. It must not say "damaged".
2. About Reprise shows the version. The icon looks right in the dmg, the Dock, Finder and ⌘-Tab.
3. With the light theme set, a relaunch shows no dark flash.
4. The tuner asks for the microphone with its usage text, then reads a real instrument.
5. Sound Packs: download a curated pack, install it, assign it to a track and play.
6. Open a local tab, play it, loop, print ([player checklist](player-checklist.md)).
7. With a Windows machine: SmartScreen → Run anyway, install, the tuner with a real microphone, uninstall.

## First-launch wording

[ADR-0003](../decisions/0003-desktop-only-electron.md) says "right-click → Open". That route stopped working in macOS 15; the install notes carry the Privacy & Security → Open Anyway route for macOS 15 and later, and keep right-click → Open for macOS 14 and earlier. The ADR is append-only and left as written.
