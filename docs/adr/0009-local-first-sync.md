# ADR-0009: Local-first storage with revisioned sync and conflict copies

- **Status:** Accepted · 2026-10-30

## Context
Users edit on desktop, PWA (possibly offline) and web, and must never lose work. The brief forbids overwriting newer cloud data with older local copies.

## Decision
- **Local store:** IndexedDB via Dexie (the Tauri webview uses the same; desktop also mirrors to `appDataDir` as a crash-recovery journal). Tables: `projects`, `versions`, `assets`, `outbox`, `garmentCache`, `settings`.
- **Autosave:** debounced 1.5 s after the last command → a new local revision (`dirty = true`).
- **Push:** the outbox uploads missing assets (presigned, resumable), then `POST /v1/projects/{id}/versions` with `baseRevision`. The server accepts only if `baseRevision == head` (otherwise **409** with the head).
- **Merge on 409:** a three-way merge (base, local, remote) at **layer granularity**. Layers keyed by id merge cleanly when touched by one side; a conflicting edit to the same layer, or a garment change on both sides, is unresolvable → the client keeps the remote as head and saves the local result as **"‹name› (conflicted copy)"**. Nothing is silently dropped.
- **Pull:** on focus, on a WebSocket `project.updated` nudge, and every 60 s while online.
- **Status chip:** Saved · Saving… · Offline, n pending · Conflict.
- Signed-out users work purely locally; sign-in offers to upload local projects.

## Consequences
The server stays simple (optimistic concurrency only). Real-time co-editing is out of scope (the reference has none); it could be added later with CRDTs if needed.
