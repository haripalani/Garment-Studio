# ADR-0013: Cloud rendering: BullMQ jobs, headless Chromium on GPU workers; RunPod first (D5)

- **Status:** Accepted · 2026-10-30

## Context
Catalogue renders are progressive path tracing (150–1500 samples) at up to 3840 px. They must match local renders.

## Decision
- **Job flow:** `POST /v1/renders` (idempotent) → the API validates entitlements, snapshots the project revision and enqueues on BullMQ `render` → the worker claims it → progress events go to Redis pub/sub → WS `render.progress` → the output is uploaded to object storage as an `Asset` → `render.finished`.
- **Worker:** `apps/render-worker` (Node 22) launches **headless Chromium (Playwright) with GPU** (`--use-gl=egl` / ANGLE-Vulkan on NVIDIA), loading a minimal page that imports `engine-3d` + `engine-2d` and runs the **same** path tracer. Garment, fonts and HDRI come from the CDN, with a local cache volume.
- **Provider:** **RunPod Serverless GPU** (L4 / RTX 4000 Ada class) at launch: scale to zero, per-second billing. It sits behind a `GpuPool` adapter so AWS g6 (ECS + capacity provider) can replace it without code changes.
- **Reliability:** per-job timeout (based on px × samples), 2 automatic retries with backoff, heartbeat every 5 s (a stalled job is re-queued), cancellation through a Redis flag checked between sample batches, and partial-progress checkpoints are not stored (renders are cheap to restart).
- **Exports** (ZIP/PDF/video) run client-side by default; a CPU `export` queue exists for large sublimation sets and offline-failed video encodes.
- Credits are charged **on success only**, through the usage ledger, keyed by job id (exactly once).

## Consequences
Pixel parity with local renders; cold starts of about 10–20 s on serverless GPUs, mitigated with a warm-pool minimum of 1 in production business hours.
