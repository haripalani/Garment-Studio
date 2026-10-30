# ADR-0001: Record architecture decisions

- **Status:** Accepted · 2026-10-30

## Context
This is a multi-stage, approval-gated build across web, PWA, desktop and cloud. Decisions must survive between sessions and contributors.

## Decision
Use lightweight ADRs (Context / Decision / Consequences) in `docs/adr/NNNN-title.md`. A superseded ADR is kept and marked `Superseded by ADR-XXXX`. Each approval gate lists the ADRs it accepted in `docs/PROGRESS.md`.

## Consequences
Every non-obvious technical choice gets an ADR before code depends on it.
