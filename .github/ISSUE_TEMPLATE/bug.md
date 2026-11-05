---
name: Bug
about: Something Reprise does wrong.
title: '{what is wrong, in one line}'
labels: ['type:bug']
assignees: []
---

<!--
Also set an area:{package} label if you know where the bug lives, and the milestone of the checkpoint it breaks.
Never attach copyrighted tabs or samples; describe the file or point at one under fixtures/ instead.
-->

## What happened

{What you saw.}

## What should have happened

{What you expected, and why: a spec, an ADR, Guitar Pro's behaviour.}

## Steps to reproduce

1. {step}
2. {step}

**File**: {fixture name, or the format and features of the file (gp5, repeats, bends), or "any file"}

## Environment

- **Build**: {desktop app version or commit, or `pnpm dev` at commit ...}
- **OS**: {macOS 26.1 arm64, Windows 11 x64, ...}
- **Sound tier**: {GM | HQ: pack name | not relevant}

## Evidence

{Screenshots, console output, a stack trace. Optional.}
