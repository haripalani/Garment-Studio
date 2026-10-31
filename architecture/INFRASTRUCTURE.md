# Infrastructure (Stage 2 draft)

Decisions: ADR-0013 (rendering), ADR-0014 (storage), ADR-0016 (hosting/CI), ADR-0017 (observability).
Domains are placeholders until the product name is final (ADR-0002).

## 1. System context

```mermaid
flowchart LR
  subgraph Clients["Clients (one editor bundle, ADR-0004)"]
    W[Web app<br/>app.domain]
    P[Installed PWA<br/>service worker + IndexedDB]
    D[Desktop app<br/>Tauri 2 · Win/macOS]
  end
  S[Marketing / account site<br/>Next.js]

  subgraph Edge["Cloudflare"]
    CDN[CDN + Pages<br/>static editor, garments, fonts, HDRI]
    R2[(R2 object storage<br/>assets · renders · thumbnails)]
  end

  subgraph Core["Fly.io (2 regions)"]
    API[NestJS API<br/>REST /v1 + WS /v1/ws]
    XW[CPU workers<br/>scan · thumbnails · exports · purge]
  end

  PG[(Neon PostgreSQL 16<br/>PITR)]
  RD[(Upstash Redis<br/>BullMQ · rate limits · pub/sub)]
  GPU[RunPod Serverless GPU<br/>render-worker: headless Chromium + path tracer]
  EM[Postmark email]
  OBS[Sentry + Grafana Cloud]
  BILL[Billing provider<br/>adapter, disabled until pricing is set]

  W & P & D -->|HTTPS| CDN
  W & P & D -->|REST + WS, JWT| API
  W & P & D -->|presigned PUT/GET| R2
  S --> API
  API --> PG
  API --> RD
  API -->|presign| R2
  API --> EM
  API -. webhooks .- BILL
  RD -->|render queue| GPU
  GPU -->|outputs| R2
  GPU -->|progress pub/sub| RD
  RD --> XW
  XW --> R2
  XW --> PG
  API & XW & GPU & W & D --> OBS
```

## 2. Render job sequence

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as API
  participant Q as Redis (BullMQ)
  participant G as GPU worker
  participant O as R2
  C->>A: POST /renders (Idempotency-Key)
  A->>A: entitlements.check(render.cloud, size, quality)
  A->>Q: enqueue {jobId, projectId, revision, params}
  A-->>C: 202 RenderJob(queued)
  G->>Q: claim job
  G->>A: (internal) fetch doc revision + signed asset URLs
  G->>O: GET garment, fonts, HDRI, artwork (CDN cached)
  loop every sample batch
    G->>Q: progress / heartbeat
    Q-->>A: pub/sub
    A-->>C: WS render.progress
    G->>Q: check cancel flag
  end
  G->>O: PUT png + webp
  G->>A: (internal) complete → UsageEvent "render:{jobId}" (charge once)
  A-->>C: WS render.finished
  C->>A: GET /assets/{id} → short-lived download URL
```

## 3. Sync sequence (ADR-0009)

```mermaid
sequenceDiagram
  participant E as Editor
  participant L as IndexedDB outbox
  participant A as API
  E->>L: autosave revision n+1 (dirty)
  L->>A: POST /assets/uploads … /complete (missing assets only)
  L->>A: POST /projects/{id}/versions {baseRevision:n}
  alt head == n
    A-->>L: 201 → mark clean
  else head > n
    A-->>L: 409 + head version
    L->>E: 3-way merge (base n, local, remote)
    alt clean merge
      E->>L: revision head+1 → push again
    else conflict
      E->>A: POST /projects (conflicted copy)
    end
  end
```

## 4. Environments

| | dev | preview (per PR) | staging | production |
|---|---|---|---|---|
| Editor/site | Vite dev server | Pages preview URL | Pages `staging` | Pages `main` |
| API | local Node | ephemeral Fly app | Fly `gs-api-stg` (1 region) | Fly `gs-api` (2 regions, min 2 machines) |
| Postgres | Docker postgres:16 | Neon branch | Neon `staging` | Neon `prod` (dedicated, PITR 7 d) |
| Redis | Docker redis:7 | Upstash free DB | Upstash fixed | Upstash fixed, TLS |
| Storage (private + public garment bucket, ADR-0019) | SeaweedFS (`infra/dev`) | R2 bucket `gs-preview` (TTL 7 d) | R2 `gs-stg` | R2 `gs-prod` (versioning on) |
| GPU render | local GPU or mock worker | mock worker | RunPod endpoint (min 0) | RunPod endpoint (min 1 in business hours) |
| Email | Mailpit | Mailpit | Postmark sandbox | Postmark |
| Billing | ManualProvider | ManualProvider | provider sandbox (when enabled) | provider live (when enabled) |

## 5. CI/CD pipeline

```mermaid
flowchart LR
  PR[Pull request] --> L[lint + typecheck]
  L --> U[unit + golden-image tests]
  U --> B[build editor, api, worker images]
  B --> OA[OpenAPI breaking-change check]
  B --> PV[deploy preview<br/>Pages + Fly + Neon branch]
  PV --> E2E[Playwright E2E + layout diff]
  E2E --> M{merge to main}
  M --> STG[deploy staging<br/>prisma migrate deploy → API → editor]
  STG --> SM[smoke: health, login, save, tiny render]
  SM --> GATE{manual approval}
  GATE --> PROD[deploy production<br/>migrate → canary 10 % → 100 %]
  T[tag desktop-v*] --> TB[Tauri matrix build<br/>windows-latest · macos-14]
  TB --> SG[sign: Azure Trusted Signing · Apple notarise]
  SG --> REL[GitHub Release + updater manifest on R2]
```

## 6. Backups and recovery

| Data | Mechanism | RPO | RTO |
|---|---|---|---|
| Postgres | Neon PITR (7 d) + nightly logical dump to a separate R2 bucket (30 d, encrypted) | ≤ 5 min | ≤ 1 h |
| Object storage | R2 object versioning (30 d) + weekly cross-account replica of `u/` prefix | 24 h (replica) | ≤ 4 h |
| Redis | Not a source of truth; queues rebuilt from `render_jobs` rows in `queued/running` | – | minutes |
| Client data | IndexedDB + desktop journal; projects can be exported as `.gsproj` | – | – |

A restore drill (staging, from the production dump) runs quarterly, plus once before launch (Stage 12).

## 7. Capacity assumptions (to be validated with load tests in Stage 12)

- API: one shared-cpu-2x machine handles about 300 req/s of mixed CRUD (to benchmark; no claims until measured).
- Document size ≤ 2 MB; typical 20–80 KB. Version rows are pruned to keep every revision for 30 days and then daily keyframes.
- Render cost driver: GPU seconds ≈ f(pixels × samples). Budget per job to be measured on L4 in Stage 7.

## 8. Rough monthly cost at launch (excluding GPU usage)

Cloudflare Pages/R2 ~$5–20 · Fly API (2× shared-2x + workers) ~$40–80 · Neon Launch ~$19–69 · Upstash ~$10–30 · Sentry Team ~$26 · Grafana Cloud free–$50 · Postmark ~$15 → **≈ $120–290 / month**, plus GPU at per-second rates. These are list-price estimates to confirm before Stage 8.

## Render workers (Stage 7, ADR-0020)
- **Process:** `node dist/render-worker.js` from `apps/api`, plus the built editor (`RENDER_PAGE_DIR`) and Playwright's Chromium in the image.
- **Capacity:** one job per GPU (BullMQ concurrency 1).
- **GPU backend:** set with `RENDER_CHROMIUM_ARGS`. On Linux NVIDIA nodes, validate `--use-angle=vulkan` (or EGL) on staging, and confirm the GPU line the worker logs at start isn't SwiftShader.
- **Shader cache:** keep `RENDER_PROFILE_DIR` on a persistent volume so the compiled-shader cache survives restarts; the first compile can take about a minute.
- **Readiness:** the worker renders a 1-sample warm-up frame before taking jobs.
