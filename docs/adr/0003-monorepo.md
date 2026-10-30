# ADR-0003: pnpm + Turborepo monorepo, TypeScript strict

- **Status:** Accepted · 2026-10-30

## Decision
One repository:
```
apps/      editor (Vite SPA) · desktop (Tauri 2) · site (Next.js) · api (NestJS) · render-worker
packages/  core · engine-2d · engine-3d · ui · platform · api-client · garment-tools · config
```
- pnpm workspaces, Turborepo task graph with remote cache, TypeScript `strict` + `exactOptionalPropertyTypes`.
- ESLint (typescript-eslint) + Prettier; Vitest across packages; Changesets for versioning the desktop app and the API.
- Node 22 LTS, Rust stable (Tauri).

## Consequences
Shared types (`packages/core`) are imported by the client, API and worker, so document and DTO drift fails at compile time. CI caches the pnpm store and the Rust target dirs.
