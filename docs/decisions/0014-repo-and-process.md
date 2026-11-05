# ADR-0014: Public repository, issue-driven work, PR review in GitHub

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The owner wants the project on their personal GitHub account, with issues and reviews tracked
in GitHub, and the shared understanding, plans and decisions kept in the repository under
`docs/`. Their two existing hobby repositories are public with issues and projects enabled.
Public repositories get unlimited GitHub Actions minutes, which matters for Electron builds
on macOS and Windows; private ones have a monthly cap. The owner's global rule: no commit
and no push without explicit permission for that specific change.

## Decision

- **Repository**: `tomer-shvadron/reprise`, public. The `gh-personal` alias switches the gh
  CLI to the personal account for GitHub operations.
- **Branching**: `main` is the default; short-lived branches per issue; pull requests are
  squash-merged; commit messages follow Conventional Commits.
- **Issues**: every unit of work is a GitHub issue first, self-contained enough for an agent
  to pick up. Labels in three families: `area` (model, formats, layout, audio, web, desktop,
  docs), `type` (feature, bug, chore, decision), `phase` (v1, phase-2, deferred). One
  milestone per checkpoint. One GitHub Projects board: Backlog, Ready, In progress, In
  review, Done.
- **Reviews**: an agent opens one PR per issue, linking the issue and stating what was
  verified. The owner reviews in GitHub; the agent addresses comments on the same branch.
  CI must be green: lint, typecheck, tests, build.
- **CI**: GitHub Actions on every PR. A release workflow on tags builds the Electron app for
  macOS and Windows and attaches installers to a GitHub Release.
- **Commits and pushes happen only with the owner's explicit go-ahead** for that change.
- **Docs tree**: `docs/decisions` (numbered ADRs), `docs/plans` (roadmap and per-checkpoint
  plans), `docs/specs` (shared understanding, feature specs), `docs/reference` (file-format
  notes, sound pack sources and licenses, shortcuts), `docs/research` (investigations).
- **No telemetry** (default unless revisited).

## Alternatives considered

- **Private repository**: nothing sensitive goes in and samples never live in git, so
  privacy buys nothing and costs CI minutes. Rejected.
- **Tracking work in the docs tree instead of issues**: the owner asked for GitHub issues and
  reviews explicitly; the docs hold the plan, the issues hold the work. Rejected.

## Consequences

- The implementation plan in `../plans/` is written as work packages that map one-to-one to
  issues, so issue creation is a mechanical step.
- Git identity: the owner's existing personal repositories commit with the work email; the
  choice of identity for this repository is left to the owner.
- No license file was chosen in the session; the existing hobby repositories have none. The
  owner decides.

## Related

- `../specs/shared-understanding.md`
- `0009-monorepo-pnpm-workspaces.md`
- `0016-build-order-and-parallel-lanes.md`
