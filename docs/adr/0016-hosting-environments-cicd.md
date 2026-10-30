# ADR-0016: Hosting, environments and CI/CD

- **Status:** Accepted · 2026-10-30

## Decision
| Component | Service | Notes |
|---|---|---|
| Editor (web/PWA) + site | **Cloudflare Pages** | Static editor; site on Pages Functions or Vercel if SSR needs grow |
| API + workers (CPU) | **Fly.io** Machines (2+ regions) | Docker images; autoscale on concurrency |
| PostgreSQL 16 | **Neon** (prod: dedicated compute, PITR 7 days) | Branch-per-PR databases for previews |
| Redis 7 | **Upstash Redis** (prod: fixed plan, TLS) | BullMQ-compatible |
| Object storage + CDN | **Cloudflare R2** + Cloudflare CDN | |
| GPU render | **RunPod Serverless** (ADR-0013) | |
| Email | Postmark (adapter) | |
| Secrets | Fly secrets / Cloudflare secrets, sourced from **Doppler** | No secrets in the repo |
| Error tracking / traces | Sentry + Grafana Cloud (ADR-0017) | |

- Environments: `dev` (docker-compose: Postgres, Redis, MinIO, Mailpit), `preview` (per PR: Pages preview + Neon branch + ephemeral Fly app), `staging`, `production`.
- **GitHub Actions:** lint → typecheck → unit → build → E2E (Playwright vs. preview) → OpenAPI breaking-change check → deploy. Prisma `migrate deploy` runs as a release step before traffic shifts; migrations must be backward-compatible (expand/contract).
- **Rollback:** Fly keeps the previous image (`fly deploy --image` previous); Pages instant rollback; DB rollbacks via forward-fix migrations + PITR as a last resort.
- **Desktop releases:** a tag `desktop-v*` → matrix (windows-latest, macos-14 universal) → Tauri build → **Windows Authenticode** signing (Azure Trusted Signing) and **macOS Developer ID + notarisation** → MSI/NSIS + DMG → updater JSON + signatures published to R2 → GitHub Release with notes (Changesets).

## Consequences
Low fixed cost at launch with managed services; every piece speaks a portable protocol (Postgres, Redis, S3, Docker) so it can move to AWS later.
