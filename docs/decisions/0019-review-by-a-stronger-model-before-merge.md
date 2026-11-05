# ADR-0019: Review by a stronger model before merge

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

ADR-0014 and ADR-0016 have the owner reviewing every PR in GitHub. Phase 0 and the model's
first work package produced eight PRs in one day, all written by agents, and the owner's
time turned out to be the scarce resource: a diff of a thousand lines or more needs a reader
who will re-run the checks, measure the claims and walk the reference implementations, not a
skim. The review of WP-010 (PR #19) is the case that settled it. A review by a stronger model
than the author found eighteen items, among them a chord-diagram shape that admitted an
illegal state, a duration range that stopped short of what gpif files carry and a lost tempo
display unit, each found by walking alphaTab's parsers rather than from memory, and it fixed
the ones the lead ruled on in two commits on the same branch.

The same day showed what not to do with stacked branches. PR #12 was stacked on the web
shell's branch; when that branch was squash-merged and deleted, GitHub closed #12, and the
work had to be reopened as #20 with its review left behind on the closed PR.

## Decision

Taken by the owner on 2026-11-05.

- **Implementation agents run on Opus at medium effort**, one per issue, in a worktree, as
  ADR-0016 describes.
- **Every PR is reviewed by a Fable agent before merge.** The reviewer reads the issue, the
  briefing and the diff, re-runs the checks, verifies measured claims, and walks the reference
  sources for anything factual. It posts its findings on the PR as a review with the
  **Comment** verdict, ranked `[blocker]`, `[should]` and `[nit]`: the author of a PR cannot
  approve it, and author and reviewer share the owner's account. It then **fixes every
  blocker and should on the branch with new commits**, never by amending or force-pushing,
  posts a resolution comment with a table of what was done and what is left, and reports to
  the lead with the items that need a ruling.
- **The lead merges**, in dependency order, once CI is green, using **auto-merge behind the
  strict up-to-date rule** on `main`: a PR behind `main` is brought up to date first.
- **Stacked branches are brought up to date by merging `main` in, never by rewriting
  history.** Before a base branch is squash-merged, which deletes it, every PR stacked on it is
  retargeted to `main` and then `main` is merged into it, so the review's commit references and
  the PR itself survive.

## Alternatives considered

- **The owner reviews every PR**, the earlier default of ADR-0014 and ADR-0016. It does not
  scale to the rate at which agents produce PRs, and a human reading eight agent-written PRs in a day cannot re-run every check and walk every
  reference implementation, which the reviewer agent does. Rejected; the owner reads the review's findings and rules on
  the items marked for the lead, which is the part only the owner can do.
- **The implementing agent reviews its own PR.** It shares its own blind spots and has
  already decided the questions the review should reopen. Rejected.
- **A reviewer on the same model as the author.** Cheaper, and catches the mechanical
  findings, but the point of the second pass is a different and stronger reader. Rejected.
- **An approving review.** Not available to the account that opened the PR; the Comment
  verdict plus the lead's merge carries the same decision.
- **Rebasing stacked branches onto `main`.** Rewrites history under an open review, so the
  commit hashes in the review and resolution comments stop resolving, and it needs a
  force-push. Rejected.

## Consequences

- Each PR carries two comments beyond its description, the review and the resolution table.
  Together they are the record of what was verified, what was fixed and what was deferred.
- Items a review marks "for the lead" become a ruling comment on the PR, a note in the plan,
  or a follow-up issue; they do not get lost in the PR thread.
- Branch protection on `main` requires the `ci` check and an up-to-date branch; a PR that
  falls behind is updated by a merge commit from `main`, which the squash merge then folds
  away.
- A review pass per PR is a Fable run per PR, accepted as the price of merging agent-written
  code without the owner reading every line.
- `../README.md` "Conventions" and `../plans/roadmap.md` "Lane rules" state the policy in one
  sentence each and point here.

## Related

- `0014-repo-and-process.md`
- `0016-build-order-and-parallel-lanes.md`
- `0018-label-families-and-repository-credentials.md`
