# @gs/api

NestJS 11 (Fastify) REST API: auth, accounts, projects and versions, assets, garments, entitlements (ADR-0010 … 0014, 0019).

## Run locally

```bash
docker compose -f infra/dev/compose.yaml up -d
```
```bash
cp apps/api/.env.example apps/api/.env
```
```bash
corepack pnpm --filter @gs/api keys
```
Paste the two printed lines into `apps/api/.env`, then:
```bash
corepack pnpm --filter @gs/api db:migrate
```
```bash
corepack pnpm --filter @gs/api db:seed
```
```bash
corepack pnpm --filter @gs/api dev
```

The API listens on http://localhost:4000/v1. Health is at `/v1/health`.

| Service | Local address |
|---|---|
| Postgres 17 | `127.0.0.1:55432` (user `gs`) |
| Redis 7 | `127.0.0.1:56379` |
| S3 (SeaweedFS) | `127.0.0.1:58333` (bucket `gs-dev`, public bucket `gs-dev-public`) |
| Mailpit (all outgoing email) | http://localhost:58025 |
| ClamAV | `127.0.0.1:53310` (the first start downloads signatures) |

`SEED_ADMIN_EMAIL=you@example.com corepack pnpm --filter @gs/api db:seed` promotes an existing account to admin (needed to assign plans).

## Render worker (cloud renders, ADR-0013/0020)

The worker is a separate process from the same codebase. It drives the editor's render page (`apps/editor/render.html`) in headless Chromium on the GPU.

```bash
corepack pnpm --filter @gs/editor build
```
```bash
corepack pnpm --filter @gs/api build
```
```bash
node --env-file=apps/api/.env apps/api/dist/render-worker.js
```

- `RENDER_PAGE_DIR` points at `apps/editor/dist`.
- `RENDER_CHROMIUM_ARGS` selects the GPU backend: `--use-angle=d3d11` on Windows; Linux GPU nodes are to be validated on staging.
- Without a GPU flag, Chromium falls back to software rendering, which is far too slow for real renders.
- The worker logs the GPU it found, then does a 1-sample warm-up render so the path tracer's shader is compiled before the first job.

## Test

```bash
corepack pnpm --filter @gs/api test
```

The suite runs against the services above and needs them running. It uses its own database (`gs_test`), Redis database 1 and the `gs-test*` buckets, all reset on each run.

Every HTTP response the tests receive is validated against `architecture/openapi.yaml`.

The render tests start the worker in-process against a fresh editor build (the setup runs `vite build`), with 4 samples per render. They use the machine's GPU when `RENDER_CHROMIUM_ARGS` is set in `.env`.

## Build

```bash
corepack pnpm --filter @gs/api build
```

This produces `dist/main.js` (the API) and `dist/render-worker.js` (the render worker): ESM bundles with npm dependencies kept external. Run the API with `node --env-file=.env dist/main.js`.
