# Reprise documentation

Everything about how Reprise is planned, decided and built lives here. The code explains *how*; these documents explain *what* and *why*.

| Directory    | What goes here                                                                                               | Start with                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `specs/`     | The shared understanding, the v1 scope and the architecture: what we are building and how it fits together. | `specs/shared-understanding.md` |
| `decisions/` | Architecture decision records, one numbered file per decision. Append-only: supersede, never rewrite.        | `decisions/README.md`           |
| `plans/`     | The roadmap and the per-phase implementation plans. Every work package in a plan becomes one GitHub issue.   | `plans/roadmap.md`              |
| `reference/` | Durable facts: the score model, file-format notes, sound pack sources and licenses, the glossary, keyboard shortcuts, the player checklist. | `reference/glossary.md`         |
| `research/`  | Investigations and spikes, dated, each ending in a conclusion that a plan or an ADR then picks up.           | `research/README.md`            |

## Conventions

- **A new decision is a new ADR.** When a decision changes, write a new ADR that supersedes the old one and flip the old one's status. The history of why stays readable.
- **Plans record intent, GitHub records progress.** A plan lists work packages with acceptance criteria. The issue created from a work package is where status, discussion and the PR live. When a plan and an issue disagree, update the plan in the same PR that resolves the disagreement.
- **Review before merge.** Implementation agents run on Sonnet at medium effort; an Opus agent at high effort reviews every PR and posts its findings on the PR without changing the branch, a Sonnet agent at medium effort fixes the blockers and shoulds on the branch, and the lead merges in dependency order once CI is green (ADR-0020, ADR-0026).
- **No time estimates.** Work packages carry a size by scope (S, M, L, XL), never days or weeks. Agents do the implementation; the time that matters is spent on planning and review.
- **Briefing an agent.** An agent picking up an issue reads, in this order: `specs/shared-understanding.md`, `specs/architecture.md`, `reference/score-model.md` (the score model, frozen at WP-015, explained without the source), the ADRs the issue links, the work package in the phase plan, and the reference notes for its area. The issue body says which of these apply.
- **Lane ownership.** During a parallel phase each lane owns one package under `packages/` and, where it has UI, one feature folder under `apps/web/src/features/`. A change to a shared contract goes through the lead as its own issue, never as a side effect of lane work.
