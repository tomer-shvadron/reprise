# Research

Investigations and spikes. One file per question, named `YYYY-MM-DD-short-slug.md`, ending in a **Conclusion** section that says what was decided and which ADR or work package picked it up. A spike's code lives on a branch that is deleted once the conclusion is recorded; the write-up is what survives.

Template:

```
# <question>

- **Date**: YYYY-MM-DD
- **Asked by**: <work package or ADR>

## Question
## What was tried
## Findings
## Conclusion
```

Candidates already identified during planning:

- Which Vitest environment runs Web Audio reliably in CI (browser mode versus a polyfill): needed by WP-001 and WP-035.
- Whether an existing SF2 parser fits the package boundary rules or a minimal one must be written: WP-032.
- Whether a dependency-free XML parser is fast enough for large `gpif` files: WP-042.
- How Guitar Pro 8 reacts to a `.gp` zip that contains only `score.gpif` and `VERSION`: WP-044.
- Licensing of the Unreal Instruments packs and whether direct download is permitted: WP-091.
