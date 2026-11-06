<!-- Title: a conventional commit line, e.g. `feat(formats): read gp5 voltas`. It becomes the squash commit. -->

Closes #{issue}

## What changed

- {change}

## How it was verified

<!-- Commands run and what they showed, manual checks, tests added. "Tests pass" alone is not enough. -->

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
- {check}

## Budget measurements

<!-- Required when the change touches anything in the Budgets table of docs/plans/roadmap.md. Paste the table `pnpm bench` prints, before and after. Otherwise write "Not applicable". -->

| Metric | Budget | Before | After |
| ------ | ------ | ------ | ----- |
|        |        |        |       |

## Screenshots

<!-- Required for UI changes: before and after, light and dark theme where relevant. Otherwise write "Not applicable". -->

## Deviations from the plan

<!-- Anything that differs from the work package, and why. If the plan itself should change, change it in this PR. Otherwise write "None". -->

## Open questions

<!-- Also posted as comments on the issue. Otherwise write "None". -->
