# ADR-0018: Label families and repository credentials

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

ADR-0014 fixed three label families, `area`, `type` and `phase`, with `phase` taking the
values `v1`, `phase-2` and `deferred`, and said the `gh-personal` alias switches the gh CLI
to the personal account. Neither survived contact with the repository. The roadmap's "From
work package to issue" section and the issues created for phase 0 use four families: `phase`
numbers the roadmap phases `0` to `4` (scope is already recorded in `../specs/scope-v1.md`),
and a `lane` family carries the ownership the parallel phases are built on. `area` gained
`repo` for the root, `.github`, `scripts` and `fixtures`; `type` gained `test` and
`contract`, the latter being the lead-only label the lane rules depend on. WP-005 (PR #9)
wrote `scripts/github/bootstrap.sh` from the live state and asked whether ADR-0014 should be
superseded to match.

On credentials: the owner's machine holds two gh accounts, a work one and the personal
`tomer-shvadron`. `gh-personal` turned out to be a shell alias in `~/.zshrc`
(`gh auth switch --user tomer-shvadron`), not a gh alias, and it switches the whole CLI:
every other repository on the machine then runs as the personal account until it is switched
back. A git push, separately, uses whichever credential the helper chain answers with, which
is not necessarily the account gh is switched to.

## Decision

**Label families**, as the repository has them:

| Family  | Values                                                                  |
| ------- | ----------------------------------------------------------------------- |
| `area`  | `model`, `formats`, `layout`, `audio`, `web`, `desktop`, `repo`, `docs` |
| `type`  | `feature`, `chore`, `test`, `contract`, `bug`, `decision`               |
| `phase` | `0`, `1`, `2`, `3`, `4`                                                 |
| `lane`  | `lead`, `score`, `audio`, `formats`, `app`                              |

Written `family:value`. Milestones are the six checkpoints of ADR-0016: Player, Library,
Trainer, Editor, HQ Sound, Release. **`scripts/github/bootstrap.sh` is the source of truth**
for the names, colours and descriptions of labels and milestones and for the board's Status
options; a change to the set is a change to the script, run after it merges. The script is
idempotent and never deletes.

**Credentials.** This repository's local git config carries a credential helper that answers
every HTTPS push with the personal account's token, so pushes go out as `tomer-shvadron`
whichever gh account is active:

```
credential.helper=!f() { echo "username=tomer-shvadron"; echo "password=$(gh auth token --user tomer-shvadron)"; }; f
```

gh commands for this repository run with the token in the environment of that one command:
`GH_TOKEN=$(gh auth token --user tomer-shvadron) gh pr view 19`. The `gh-personal` shell
alias is no longer needed for this repository, and switching the CLI's active account is not
part of the workflow.

ADR-0014 keeps everything else: the public repository, branching, issue-driven work, PR
review in GitHub, CI, the docs tree and the no-telemetry default. Its status line records
that the label families and the credential notes are superseded here; its body is unchanged.

## Alternatives considered

- **Keep ADR-0014's three families and relabel the repository.** The `lane` family is what
  the lane rules and the issue template key on, and `phase:v1` conflated roadmap phase with
  scope. Rejected; the live state is the better design.
- **Rewrite ADR-0014 in place.** Breaks the append-only rule in `README.md`. Rejected.
- **Switch the CLI account per session with `gh-personal`.** Global to the machine, so a
  session in a work repository starts pushing as the personal account, or the reverse.
  Rejected in favour of a per-command `GH_TOKEN` and a per-repository git credential helper.
- **A separate `GH_CONFIG_DIR` for this repository.** Works, but every command in every shell
  must export it, and git still needs the credential helper. Rejected as heavier than the
  prefix.

## Consequences

- `../plans/roadmap.md` "From work package to issue" and the work-package issue template name
  the four families; an issue carries one label from each.
- Every script, skill or agent instruction that calls gh for this repository prefixes
  `GH_TOKEN=$(gh auth token --user tomer-shvadron)`; `CONTRIBUTING.md` carries the same note.
- Adding a label, milestone or Status option is a PR to `scripts/github/bootstrap.sh` plus a
  run of the script; nothing is created by hand in the GitHub UI.
- The helper runs `gh auth token` on every push, so the personal account must stay logged in
  to gh, even while it is not the active account.

## Related

- `0014-repo-and-process.md`
- `0016-build-order-and-parallel-lanes.md`
- `0019-review-by-a-stronger-model-before-merge.md`
- `../plans/roadmap.md`
