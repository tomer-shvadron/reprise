# ADR-0020: Plan and review with Opus at xhigh effort

- **Status**: Accepted
- **Date**: 2026-11-06
- **Deciders**: Tomer Shvadron, with Claude

## Context

ADR-0019 has every PR reviewed by a Fable agent, a stronger model than the Opus agent that
wrote it, and has that reviewer fix the blockers and shoulds on the branch itself. Two things
have moved since.

- **The task workflow.** When `AGENTS.md` was added (#78), it carried the owner's five-step
  rule for a coding task: an issue, a plan posted on the issue, an implementation, a review
  that posts findings as PR review comments, and a fix of those comments by a separate agent.
  That rule brought in the separate plan step and split the reviewer from the fixer: the
  reviewer changes nothing on the branch. ADR-0019 predates it and still describes a reviewer
  that fixes.
- **The model.** On 2026-11-06 the Fable monthly limit ran out, and the owner gave the
  instruction in #83: "update the agentic workflow definition - instead of using fable - use
  opus xhigh".

ADR-0019 rejected "a reviewer on the same model as the author" because "the point of the
second pass is a different and stronger reader". This record takes up that alternative, so it
has to answer the rejection rather than step around it.

## Decision

Each part has its own source, named in its bullet. It supersedes ADR-0019's reviewer, fixer
and cost clauses; the rest of ADR-0019 stands.

- **Planning and review run on Opus at xhigh effort; implementation and fixing run on Opus at
  medium effort.** Fable is not used unless the owner says so. This is the model change: the
  owner's instruction in #83, given on 2026-11-06 when the Fable limit ran out.
- **The reviewer posts findings only and changes nothing on the branch.** A separate fixer
  applies the `[blocker]` and `[should]` items in new commits and answers each review thread
  with what it did or why not. This split, and the plan step before implementation, come from
  the owner's five-step rule in `AGENTS.md` (#78), not from the model change.
- **The five steps apply to coding tasks, and a Markdown-only change skips the plan step.**
  The owner's rule says "coding task" without defining it; the definition and the exception
  are the lead's ruling on PR #84, which the owner can overrule. They are stated once in
  `../../AGENTS.md` ("Task workflow"); this record does not restate them.

### Same-model review

What changed is the owner's decision once Fable was no longer available: the stronger reader
of ADR-0019 is not on offer, and the choice is between a same-model review and none.

Effort is now the differentiator. The reviewer runs at xhigh effort against the writer's
medium, so it spends more reasoning on the same diff: re-running checks, reopening the
questions the writer settled, and walking reference sources.

The risk that stays is the one ADR-0019 named when it rejected self-review: writer and
reviewer share a model, so their blind spots are correlated, and a mistake the model makes
confidently can pass both. The mitigations:

- **Evidence over reading.** The reviewer verifies claims by running things, not by agreeing
  with the prose: probes against the reference implementations, renders, and measured checks
  against the budgets.
- **xhigh effort** on the review, above the medium effort of the writing.
- **A separate fixer**, so the reviewer is not anchored on edits of its own and its findings
  stay a reading of the author's work.
- **The lead's merge gate**: the lead rules on items marked for it and merges only when every
  `[blocker]` and `[should]` is resolved and CI is green.

## Alternatives considered

- **Keep Fable for review.** Not available until the limit resets, and the owner chose Opus
  over waiting. The owner can still name Fable for a given task.
- **Opus at the same effort for writing and review.** Gives up the one remaining difference
  between the two passes. Rejected.
- **The reviewer fixes on the branch, as ADR-0019 had it.** Contradicts the owner's five-step
  rule, and anchors the reviewer on its own edits. Rejected.

## Consequences

- ADR-0019's resolution table is superseded: the fixer answers each review thread instead, and
  those replies are the record of what was fixed and what was deferred.
- ADR-0019's price line is superseded: a review pass per PR is an Opus xhigh review run plus an
  Opus medium fix run, rather than a Fable run.
- Same-model blind spots are an accepted risk. A defect found after merge that the review
  should have caught is a reason to revisit this record.
- ADR-0019's title still reads "a stronger model"; its status line points here.
- `../README.md` "Conventions", `../plans/roadmap.md` lane rule 6 and `../../AGENTS.md` "Task
  workflow" point here.

## Related

- `0014-repo-and-process.md`
- `0016-build-order-and-parallel-lanes.md`
- `0019-review-by-a-stronger-model-before-merge.md`
