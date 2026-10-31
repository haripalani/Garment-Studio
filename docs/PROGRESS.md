# Progress Tracker

| Stage | Status | Gate | Artefacts |
|---|---|---|---|
| 1 Discovery | ✅ Approved 2026-10-30 | passed | `docs/*.md` (12), `docs/screenshots/` (19) |
| 2 Architecture | ✅ Approved 2026-10-30 | passed | `docs/adr/` (17 ADRs; 19 by Stage 6), `architecture/openapi.yaml`, `architecture/api-docs.html`, `architecture/prisma/schema.prisma` + `migrations/0001_init`, `architecture/INFRASTRUCTURE.md` |
| 3 Design system and shell | ✅ Approved 2026-10-30 | passed | monorepo, `packages/{core,platform,ui}`, `apps/editor` (shell + `/ui` gallery), 18 tests, `docs/STAGE3_REPORT.md` |
| 4 2D editor | ✅ Approved 2026-10-30 | passed | `packages/engine-2d`, document model + dev garment in `packages/core`, editor canvas/panels/history/autosave, 66 tests, `docs/STAGE4_REPORT.md` |
| E2E + accessibility testing | ✅ Done 2026-10-30 | (requested before Stage 5) | `apps/editor/e2e` (28 tests × 3 browsers), `docs/TEST_REPORT.md` |
| 5 3D engine | ✅ Approved 2026-10-30 | passed | `packages/engine-3d`, ProjectDoc v2 (look), viewer + snapshot, 81 unit + 96 E2E, `docs/STAGE5_REPORT.md`, ADR-0018 |
| 6 Backend | ✅ Approved 2026-10-31 | passed | `apps/api` (46 operations), `infra/dev/compose.yaml`, `packages/core` API contracts + canonical JSON, OpenAPI draft.2, 75 API tests (contract-checked) + 82 unit, `docs/STAGE6_REPORT.md`, ADR-0019 |
| 7 Rendering and export | ✅ Approved 2026-10-31 | passed | path tracer (`engine-3d/pathtrace.ts`), render dialog, print/sublimation/spec/video exports, renders + exports API, render worker (`render-worker.ts`), `/v1/ws`, `docs/STAGE7_REPORT.md`, ADR-0020 |
| 8 Cloud app (staging) | 🟡 Awaiting approval | **open** | editor cloud layer (`apps/editor/src/cloud`), local library + sync + merge, project browser, cloud renders, Docker images, staging replica (`infra/staging`), CI workflow (not yet run), `infra/DEPLOY.md`, `docs/STAGE8_REPORT.md`, ADR-0021. Real staging deploy waits for owner accounts |
| 9 PWA | ⏳ | – | – |
| 10 Desktop | ⏳ | – | – |
| 11 Integration | ⏳ | – | – |
| 12 Production | ⏳ | – | – |

## Decisions log
| ID | Decision | ADR |
|---|---|---|
| D1 | Own identity ("Garment Studio" working name); the reference used for layout and interaction only | 0002 |
| D2 | Garments from CLO3D/MD → GLB + DXF-AAMA via garment-tools; launch set: Tee flat, Tee on body, Hoodie flat | 0007 |
| D3 | Entitlements engine from day 1; billing provider adapter, enabled later | 0012 |
| D4 | Editor = Vite + React SPA; Next.js for the site only | 0004 |
| D5 | RunPod Serverless GPU first, behind a `GpuPool` adapter | 0013 |
| D6 | English at launch; i18n keys from day 1 | 0015 |

## Stage 2 verification
- `prisma validate` (Prisma 6.16.2): **valid**. `prisma migrate diff --from-empty` generated `0001_init` (18 tables, citext extension).
- `redocly lint` (1.34.5, recommended ruleset + `architecture/redocly.yaml`): **valid, 0 errors, 0 warnings**. Two rules are turned off with reasons in that file.
- Mermaid diagrams in INFRASTRUCTURE.md: **not machine-validated** (they render in GitHub/VS Code previews).

## Open items for Stage 3 kickoff
- Choose the final accent colour and logo for the working brand.
- Start commissioning the 3 launch garments (asset lead time).
- Create the GitHub repo, Cloudflare/Fly/Neon/Upstash/RunPod accounts. **Needs you**: accounts and billing are yours to create.
