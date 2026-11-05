---
name: Work package
about: One work package from a phase plan in docs/plans, copied verbatim with its briefing list and rules.
title: 'WP-0NN: {title}'
labels: []
assignees: []
---

<!--
Fill every field from the work package in docs/plans/phase-N-*.md, then set:
- Labels: area:{package}, type:{feature|chore|test|contract|bug}, phase:{0-4}, lane:{score|audio|formats|app|lead}
- Milestone: the checkpoint this work package feeds
- Projects: Reprise (Backlog)
-->

Work package **WP-0NN** from [phase N: {name}](https://github.com/tomer-shvadron/reprise/blob/main/docs/plans/phase-N-{slug}.md). The text below is the plan verbatim; the plan file is the source of truth if they ever differ.

- **Lane**: {lead | score | audio | formats | app} · **Size**: {S | M | L | XL} · **Blocked by**: {WP-0NN, or none}
- **Packages**: `<path>`, `<path>`

**Deliverables**

- {deliverable}

**Acceptance criteria**

- {criterion}

## Briefing

Read before starting, in this order:

1. [Shared understanding](https://github.com/tomer-shvadron/reprise/blob/main/docs/specs/shared-understanding.md)
2. [Architecture](https://github.com/tomer-shvadron/reprise/blob/main/docs/specs/architecture.md)
3. Decision records for this work package:
   - [ADR-00NN {title}](https://github.com/tomer-shvadron/reprise/blob/main/docs/decisions/00NN-{slug}.md)
4. [Roadmap](https://github.com/tomer-shvadron/reprise/blob/main/docs/plans/roadmap.md), sections _Lane rules_ and _Budgets_
5. [Glossary](https://github.com/tomer-shvadron/reprise/blob/main/docs/reference/glossary.md)

## Blocked by

- Blocked by #{n} (WP-0NN)

## Rules for this issue

- Branch `wp-0NN-short-slug` off `main`, one PR, squash-merged. The PR links this issue and its description states what was verified and how.
- Touch only the packages listed above plus their tests and docs. A needed change to a frozen contract is a separate `type:contract` issue.
- Conventional commit messages. No samples, tabs, secrets or build output in git.
- Sizes are by scope; do not add time estimates to docs or code.
- Open questions go in this issue as comments, not as assumptions buried in code.
