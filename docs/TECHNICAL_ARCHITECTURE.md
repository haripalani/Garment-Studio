# Technical Architecture (proposal: awaiting approval)

## 1. Principles
1. **One editor codebase.** It ships to web, PWA and Tauri desktop. Platform differences sit behind a small `platform` adapter (files, storage, auth redirect, notifications, updates).
2. **The document is the truth.** `ProjectDoc` (DATA_MODEL §1) drives the 2D canvas, the 3D textures and every export. Renderers are pure functions of document plus assets.
3. **Local-first.** Edits commit to IndexedDB first; sync pushes revisions; the server only rejects stale writes.
4. **The same render engine locally and in the cloud.** The cloud worker runs the identical engine headless on a GPU, so output matches.
5. **Swappable vendors.** Auth, billing, storage, email and queue sit behind interfaces.

## 2. Recommended stack (with deviations from the brief, justified)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm + Turborepo, TypeScript strict | Shared packages across web, desktop, api and worker |
| **Editor app** | **Vite + React 19 + TypeScript (SPA)** instead of Next.js | The editor is a fully client-side canvas/WebGL app. Tauri needs a static bundle, and Next.js SSR or server actions don't run inside Tauri. A Vite SPA gives one identical build for web, PWA and desktop, plus faster HMR. **Next.js is kept for the marketing/account site** (SEO, pricing, docs), as a separate app. |
| UI | Tailwind CSS v4 + Radix UI primitives + Lucide icons; tokens from DESIGN_SYSTEM.md as CSS variables | Accessible primitives (menus, dialogs, sliders) with exact visual control |
| State | Zustand (UI state) + an Immer-based **command store** for the document (undo/redo = inverse patches) | Patch-based history is cheap and serialisable for sync |
| **2D engine** | **Custom Canvas2D scene renderer** (not Fabric.js or Konva) | Requirements: mm-accurate piece frames, clipping to piece outlines, seam wrapping across pieces, outside/inside sides, and **the same draw code reused to bake 3D textures and print files at 300 DPI** in an OffscreenCanvas worker. Fabric and Konva own their object models and hit-testing, so they would have to be fought for seam-wrap and baking. A custom renderer with a thin interaction layer is less code overall and fully testable. |
| Text shaping | Canvas text + opentype.js for outlines (vector print export) | |
| **3D engine** | three.js r17x via **React Three Fiber** + drei; MeshPhysicalMaterial (sheen) with knit and wrinkle normal maps; N8AO/GTAO; RGBE/EXR HDRI; PMREM | Matches the reference's capabilities; R3F keeps the scene declarative |
| Path tracing (catalogue render) | **three-gpu-pathtracer** (progressive "passes"), shared by local and cloud | Same look everywhere; transparent background supported |
| Garment assets | Authored in CLO3D or Marvelous Designer → GLB (meshopt) with UV islands = pattern pieces at true scale + piece/seam JSON (DXF-AAMA import tool) | Accurate pattern-to-surface mapping is only possible with real cut-and-sewn meshes |
| Backend | **NestJS** (REST + OpenAPI via zod/nestjs-zod) + WebSocket gateway (render progress, sync nudges) | As requested; REST is enough for CRUD and job control |
| DB | PostgreSQL 16 + Prisma | As requested |
| Cache / queue | Redis 7 + **BullMQ** | Render, export, thumbnail, scan and purge queues |
| Object storage | S3-compatible (Cloudflare R2 or AWS S3) + CDN; presigned uploads | R2 has zero egress, which suits render downloads |
| Auth | Own NestJS auth module: argon2id passwords, magic link, OAuth (Google/Apple), short JWT access + rotating refresh; **desktop: OAuth PKCE in the system browser + deep link; refresh token in the OS keychain** (tauri-plugin-keyring) | No vendor lock-in; secure desktop flow |
| Billing (optional, D3) | Adapter interface; Paddle or Stripe implementation | Only if subscriptions are approved |
| Render workers | Node + headless Chromium (Playwright) with GPU (EGL/Vulkan) on GPU nodes (e.g. AWS g5/g6, Lambda, RunPod), running the same engine bundle | Pixel-parity with local render |
| Video (turntable) | WebCodecs in the browser (local); ffmpeg in the worker (cloud) | |
| PDF (spec sheet) | pdf-lib (client and worker) | |
| ZIP | fflate in a worker | |
| PWA | vite-plugin-pwa (Workbox): precached shell, runtime cache for garments/fonts/HDRI, Background Sync where supported | |
| Desktop | **Tauri 2**: same `dist/`, plugins fs, dialog, notification, updater, deep-link, keyring, single-instance, window-state; crash recovery via the IndexedDB journal | |
| Testing | Vitest (unit), Playwright (E2E plus visual diffs against reference screenshots), pixel-diff tests for texture baking, k6 (load), Tauri WebDriver smoke tests | |
| Observability | OpenTelemetry → Grafana (Tempo, Loki, Prometheus) or Sentry for errors; BullMQ dashboards | |
| CI/CD | GitHub Actions: lint, typecheck, test, build; Prisma migrate on deploy; Tauri matrix builds (windows-latest, macos-latest) with signing and notarisation; preview environments per PR | |
| Hosting | Web/PWA: Cloudflare Pages or Vercel (static). API: Fly.io / Render / AWS ECS. Postgres: Neon / RDS. Redis: Upstash / ElastiCache. GPU workers: autoscaled pool. | |

## 3. Repository layout
```
apps/
  editor/        Vite React SPA (web + PWA build targets)
  desktop/       Tauri 2 shell (src-tauri) loading apps/editor dist
  site/          Next.js marketing, pricing, account pages
  api/           NestJS
  render-worker/ Node + Playwright GPU worker (consumes BullMQ)
packages/
  core/          ProjectDoc types, zod schemas, migrations, units, commands, sync protocol
  engine-2d/     Pattern renderer, hit-testing, interaction controllers, texture/print baking (worker-safe)
  engine-3d/     Garment loader, materials, scene, camera rigs, path-trace renderer
  ui/            Design-system components (Tailwind + Radix)
  platform/      Adapters: web | tauri (fs, storage, auth, notify, update)
  api-client/    Generated OpenAPI client
  garment-tools/ CLI: DXF-AAMA + GLB → GarmentModel manifest, validation
```

## 4. 2D ↔ 3D pipeline
```
ProjectDoc ──► engine-2d.bakePiece(piece, side, dpi) ──► OffscreenCanvas (worker)
                    │ (dirty-rect, per piece, debounced)            │
                    ▼                                               ▼
             Pattern view (screen)                 Texture atlas: CanvasTexture / ImageBitmap → three.js
                                                    (UV islands = piece rects; only changed pieces re-upload)
Exports reuse bakePiece at 300 DPI (print ZIP), with bleed (sublimation), and as vectors (SVG/PDF).
```
- Coordinates: **mm** everywhere in the document. Screen px = mm × zoom × devicePixelRatio. UV = (mm − pieceOrigin) / pieceSize mapped into the island's `uvRect`. One function each way, unit-tested both directions.
- Seam wrap: overflow geometry is transformed across seam edge pairs (rigid transform per seam) and clipped to the neighbour piece; bleed extends the clip outward by `bleedMm`.

## 5. API surface (v1, REST, `/v1`)
| Method & path | Purpose |
|---|---|
| POST /auth/register · /auth/login · /auth/magic-link · /auth/refresh · /auth/logout · /auth/password/forgot · /auth/password/reset | Auth |
| GET/PATCH/DELETE /me · GET/PUT /me/settings | Profile, settings, account deletion |
| GET /projects · POST /projects · GET/PATCH/DELETE /projects/:id · POST /projects/:id/duplicate | Project CRUD |
| GET /projects/:id/versions · GET /projects/:id/versions/:rev · POST /projects/:id/versions (If-Match: baseRevision) → 201 or **409 conflict** | Versioned sync |
| POST /assets/uploads (presign) · POST /assets/:id/complete · GET /assets/:id | Content-addressed uploads, scan before use |
| GET /garments · GET /garments/:id | Catalogue |
| POST /renders · GET /renders/:id · POST /renders/:id/cancel · POST /renders/:id/retry · WS /ws (render.progress, project.updated) | Cloud rendering |
| POST /exports (print_zip / sublimation_zip / spec_pdf / video) · GET /exports/:id | Server-side exports (optional; the client can export offline) |
| GET /billing/plans · POST /billing/checkout · POST /billing/webhook | Only if D3 is approved |
Each endpoint in the OpenAPI spec documents auth, validation (zod), errors (RFC 7807), permissions (owner-only), and rate limits (per IP and per user, Redis token bucket).

## 6. Sync and conflicts
- Every save creates a revision locally (`revision = base + 1`, with `dirty`). The outbox pushes `POST /versions` with `If-Match: baseRevision`.
- On **409**, the client fetches the head and runs a three-way merge on layer granularity (layers keyed by id; property-level last-writer-wins only where both sides didn't touch the same layer). If unresolved, it keeps **both** ("Project (conflicted copy)") and never silently overwrites.
- Assets upload first (by sha256, so repeats dedupe); resumable multipart for large files.
- Status chip: Saved · Saving… · Offline (n changes pending) · Conflict.

## 7. Local vs. cloud capability split
| Capability | Local (web/PWA/desktop) | Cloud | Offline |
|---|---|---|---|
| Edit 2D, 3D preview, fabric, scene | ✓ | – | ✓ (cached garment) |
| 3D snapshot, print ZIP, sublimation ZIP, spec PDF | ✓ | optional | ✓ |
| Catalogue render (path-traced) | ✓ (GPU permitting; plan-gated if D3) | ✓ GPU workers | local only |
| Turntable video | ✓ (WebCodecs) | ✓ (ffmpeg) | local only |
| Project storage and cross-device sync | IndexedDB cache | ✓ source of record | queued |
| Auth, billing | – | ✓ | cached session only |

## 8. Security
argon2id; HttpOnly SameSite cookies on web, keychain on desktop; CSRF on cookie routes; strict CSP (no inline scripts); zod validation on every DTO; owner scoping enforced in a Prisma middleware and covered by tests; presigned URLs with short TTL; upload MIME sniffing plus size caps plus image re-encode plus ClamAV scan queue; SVG sanitising (DOMPurify on the server) before raster/vector use; rate limits; secrets in the cloud secret manager; encrypted backups (PITR) with tested restores; audit log of auth and destructive actions.
