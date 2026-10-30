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

## Test

```bash
corepack pnpm --filter @gs/api test
```

The suite runs against the services above and needs them running. It uses its own database (`gs_test`), Redis database 1 and the `gs-test*` buckets, all reset on each run.

Every HTTP response the tests receive is validated against `architecture/openapi.yaml`.

## Build

```bash
corepack pnpm --filter @gs/api build
```

This produces `dist/main.js`: one ESM bundle with npm dependencies kept external. Run it with `node --env-file=.env dist/main.js`.
