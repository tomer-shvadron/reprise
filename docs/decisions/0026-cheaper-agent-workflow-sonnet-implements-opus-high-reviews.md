# ADR-0026: Sonnet implements and fixes; Opus at high effort plans and reviews

- **Status**: Accepted
- **Date**: 2026-11-08
- **Deciders**: Tomer Shvadron, with Claude

## Context

ADR-0020 put every step of the workflow on Opus, with plan and review at xhigh effort. On
2026-11-08 `/usage` showed general-purpose sub-agents at 99% of usage, and the weekly spend
limit ran out mid-phase. The owner's instruction in #132: "update the rules to match your
proposed plan".

## Decision

It supersedes ADR-0020's model and effort clauses; the rest of ADR-0020 stands (a reviewer
that changes nothing, a separate fixer, the Markdown-only exception, the lead's merge gate).

| Step      | Model      | Effort                                                                                  |
| --------- | ---------- | --------------------------------------------------------------------------------------- |
| Plan      | Opus       | high; skipped for size-S issues (the implementer plans inline) and Markdown-only changes |
| Implement | Sonnet 5.5 | medium                                                                                  |
| Review    | Opus       | high; stays the quality gate                                                            |
| Fix       | Sonnet 5.5 | medium, or resume the implementer while its context is warm                             |

Fable stays unused unless the owner says so.

### Wiring

- Named agent types in `.claude/agents/` (`planner`, `implementer`, `reviewer`, `fixer`), each
  with `model` and `effort` in its frontmatter, so `/usage` reports cost per step.
- `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL` to `sonnet`, so an untyped
  sub-agent defaults to Sonnet instead of inheriting the lead's Opus.
- A lead session started outside the repo does not load these files; it passes `model` and
  `effort` on each launch.

### Cost rules for every sub-agent

- Run only the affected tests locally; the pre-commit hook already runs related tests. The
  full suite, e2e, bench and visual runs are left to CI unless the task is about them.
- Send command output to a uniquely named log file and read the tail.
- Reviewers read the diff, the plan comment and the spec sections the diff touches, not the
  whole repo.
- At most three agents run at once.

### Transition

Agents stopped by the limit mid-task (the #107, #123 and #124 implementers) are resumed on
Opus to finish, because a fresh agent would re-read everything. New launches, including the
#98 plan, follow the new rule.

## Alternatives considered

- **Keep Opus for every step at lower effort.** The implement and fix steps write the most
  tokens; moving them to Sonnet saves the most. Rejected as the smaller saving.
- **Sonnet for review too.** Writer and reviewer would share a model, and ADR-0019 rejected
  that. Review stays on Opus, a stronger model than the writer.

## Consequences

- ADR-0020's table of models and efforts is superseded; its status line points here.
- ADR-0020's mitigation "xhigh effort on the review" becomes "a stronger model at high
  effort": the reviewer is no longer the same model as the writer.
- `../../AGENTS.md` "Task workflow" and "Quota", `../README.md` and `../plans/roadmap.md`
  lane rule 6 describe the new mapping.

## Related

- `0019-review-by-a-stronger-model-before-merge.md`
- `0020-plan-and-review-with-opus-at-xhigh-effort.md`
