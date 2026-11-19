# Releasing Reprise

Installers are built by [`.github/workflows/release.yml`](../../.github/workflows/release.yml). The builds are unsigned and not notarized ([ADR-0003](../decisions/0003-desktop-only-electron.md)), so the install notes in [`.github/release/install.md`](../../.github/release/install.md) tell people how to get past the first-launch warning.

## What the workflow does

It runs on a `v*` tag, on `workflow_dispatch`, and on every PR that touches the desktop app, the release scripts, the workflow itself or the files the packaged renderer depends on (`apps/web/index.html`, `theme-bootstrap.js`, `csp.ts`, `pnpm-lock.yaml`). On a PR nothing is released; the run is the proof that the installers build and the packaged app works on every target.

**`package`**, one job per target, each building its own arch natively and smoking what it built:

| Runner           | Builds                                                    |
| ---------------- | --------------------------------------------------------- |
| `macos-15`       | `Reprise-<v>-mac-arm64.dmg` and `.zip`                    |
| `macos-15-intel` | `Reprise-<v>-mac-x64.dmg` and `.zip`                      |
| `windows-2025`   | `Reprise-<v>-windows-x64-setup.exe` (NSIS, per-user)      |

Per job: install, resolve the version, build with `electron-builder` (`--publish never`, no signing identity), on macOS `codesign --verify --deep --strict` on the app, then `pnpm desktop:smoke` with `REPRISE_EXPECTED_VERSION`. The smoke checks the shipped fuses, that the sandbox holds, that the version is the one built, then opens a fixture, plays it, edits, kills the app, recovers the draft, closes the window and expects exit code 0; on Windows it also starts the tuner on Chromium's fake microphone. The installers are uploaded as the artifact `installers-<target>` for 14 days, so a PR's installer can be tried before any tag exists.

**`release`**, only on a `v*` tag, with `contents: write` (every other job has `contents: read`):

1. Fails unless the tag's commit is on `main`.
2. Checks the downloaded files are exactly the five above for that version, and writes `SHA256SUMS.txt`.
3. Creates a **draft** release with `install.md` first and then the generated notes. A version with a pre-release part (`v1.0.0-rc.1`) is also marked prerelease, so it never becomes "Latest".

The version comes from the tag through `scripts/release/version.ts`, which accepts `v<major>.<minor>.<patch>` with an optional `-<prerelease>` and nothing else, and reaches the app through `-c.extraMetadata.version`: the artifact names, `app.getVersion()`, About and the file versions follow it, and no file in the checkout changes. A local `pnpm desktop:build` stays `0.0.0` and packages the host arch only.

## Cutting a release

1. Check `main` is green and the PR runs of `release.yml` passed on all three runners.
2. Tag a commit on `main` and push the tag. Never move or reuse a tag.

   ```sh
   git tag v1.0.0-rc.1 origin/main && git push origin v1.0.0-rc.1
   ```

3. Wait for the run, then open the draft (`gh release view v1.0.0-rc.1`): five installers, `SHA256SUMS.txt`, the install notes and the generated notes.
4. Try it (the owner's checklist below). If something is wrong, fix it on `main` and tag the next candidate (`rc.2`). A failed draft can be deleted with `gh release delete v1.0.0-rc.1 --cleanup-tag`.
5. For the final version, tag `v1.0.0` the same way, then the owner publishes the draft by hand: `gh release edit v1.0.0 --draft=false --latest`.

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
