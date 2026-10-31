# Garment Studio (working name)

A garment design and visualisation platform: a 2D sewing-pattern editor, a live 3D preview, and rendering and print exports. It ships as a web app, an installable PWA and a Tauri desktop app.

- Progress and approval gates: [docs/PROGRESS.md](docs/PROGRESS.md)
- Architecture decisions: [docs/adr/](docs/adr)
- API contract: [architecture/openapi.yaml](architecture/openapi.yaml) · DB: [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)
- API (Stage 6): [apps/api/README.md](apps/api/README.md), local services in [infra/dev/compose.yaml](infra/dev/compose.yaml)
- Staging (Stage 8): replica in [infra/staging](infra/staging), deployment runbook [infra/DEPLOY.md](infra/DEPLOY.md), CI in [.github/workflows/ci.yml](.github/workflows/ci.yml)

## Develop

Requires Node 22+. pnpm runs through Corepack (pinned in `package.json`).

```bash
corepack pnpm install
```
```bash
corepack pnpm dev
```

| Command | What it does |
|---|---|
| `corepack pnpm dev` | Editor on http://localhost:5173 (design system at `/ui`) |
| `corepack pnpm typecheck` | TypeScript across all packages |
| `corepack pnpm test` | Vitest across all packages |
| `corepack pnpm build` | Production build |

## Layout
```
apps/editor        Vite + React SPA (web / PWA / desktop bundle) + render.html (cloud render page)
apps/api           NestJS (Fastify) REST API + WebSocket, and the GPU render worker (render-worker.ts)
infra/dev          Docker Compose: Postgres, Redis, S3 (SeaweedFS), Mailpit, ClamAV
packages/core      shared domain code: units, geometry, ProjectDoc schema, garment model, dev garment, API contracts
packages/engine-2d pattern renderer, hit-testing, seam wrapping, manipulation maths, piece baking (also print files)
packages/platform  platform adapters (web now, Tauri in Stage 10)
packages/ui        design system (Tailwind v4 tokens + Radix + Lucide)
```
