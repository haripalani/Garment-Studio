# ADR-0008: Versioned JSON document in millimetres; command/patch history

- **Status:** Accepted · 2026-10-30

## Decision
- `ProjectDoc` (DATA_MODEL.md §1) is the single source of truth. All geometry is stored in **millimetres** in the piece's local frame; mm/cm/in are display-only.
- zod schemas in `packages/core` validate the document on load (client), on write (API) and in the worker.
- Every edit is a **command** producing Immer patches + inverse patches. Undo/redo replays inverse/forward patches. Slider and drag gestures coalesce into one history entry (committed on pointer-up / change end).
- `schemaVersion` with a pure migration chain `migrate_vN_to_vN+1(doc)`, golden-file tested. A document from a future version opens read-only.
- Assets are content-addressed by SHA-256; layers reference `assetId`, never inline data.

## Consequences
History is cheap and serialisable. The patches are also the unit the sync merge reasons about (ADR-0009).
