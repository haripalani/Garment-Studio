# ADR-0020: Rendering and export implementation (amends ADR-0013)

- **Status:** Accepted · 2026-10-31 (Stage 7)

## Context
Stage 7 added final renders (local and cloud) and the file exports. Building and measuring them settled these details.

## Decisions

1. **Path tracer: three-gpu-pathtracer (MIT) on WebGL 2.**
   - Its WebGL tracer is marked deprecated in favour of a WebGPU one. WebGPU is not reliably available in headless or software-rendered environments yet, so the WebGL tracer stays.
   - The deprecation notice is filtered from the console. Swapping engines later is contained in `packages/engine-3d/src/pathtrace.ts`.

2. **One scene, two renderers.** The path tracer and the off-screen views (video, spec sheet) render the live studio scene with their own WebGL contexts. GPU objects never cross contexts, which caused two bugs found in the browser:
   - The path tracer needs the studio environment as an **equirectangular float map with CPU pixels** (for importance sampling). The studio makes it once from the room environment and reads it back.
   - Each off-screen renderer builds **its own PMREM** copy of the environment.

3. **The inside face sits 0.4 mm behind the outside face.** Coincident surfaces are invisible to rasterisation (back faces are culled), but a path tracer hits either at random. That leaked light and shadow through the fabric as heavy speckle.

4. **Sampling loop.** Each sample is synced with a 1-pixel read, and the loop yields every ~30 ms through a `MessageChannel`, not `requestAnimationFrame`.
   - Browsers throttle rAF in background panes and tabs, which made renders about 9× slower in testing.
   - The GPU sync stops work queueing up and freezing the page.

5. **Render plans.**
   - Samples: draft 150, good 500, high 1000, max 1500.
   - Large frames render in tiles (one per 1280 px of the long side).
   - High and max use 2048 px texture layers and, above 2000 px, bake prints at 4 px/mm.

6. **Cloud worker = the editor's own render page in headless Chromium** (`apps/editor/render.html`), driven by `apps/api/src/render-worker.ts` (same codebase and config as the API, deployed as a separate process).
   - The worker serves the built editor to the browser locally.
   - It passes the revision's document, the garment and the image bytes.
   - It receives PNG/WebP bytes and stores them as `render` assets.
   - Both paths run the same code, so local and cloud renders match.

7. **Shader compilation is the dominant first-render cost.**
   - Measured on Windows (ANGLE → Direct3D 11, Quadro T1000): about 50 s for the first render.
   - The worker therefore uses a **persistent Chromium profile** (GPU program cache) and a **1-sample warm-up render** at start. After that, a 320 × 400 job took about 2 s in tests.
   - GPU flags are per platform (`RENDER_CHROMIUM_ARGS`): `--use-angle=d3d11` on Windows. Linux GPU nodes need validation in Stage 8 staging (expected: `--use-angle=vulkan`). Without flags, headless Chromium uses SwiftShader (software), which is far too slow for production renders.

8. **Charging and quotas.**
   - At create time: plan size and quality limits, plus the monthly cloud quota counting in-flight jobs, with render credits covering overflow.
   - The charge happens on success only, through the usage ledger keyed `render:{jobId}` (exactly once), consuming a credit when over quota.
   - Cancelled and failed jobs are never charged.
   - A retry is a new job (`retryOf`).

9. **Exports run in the browser.**
   - Print ZIP: transparent PNG per printed piece side, real size, DPI in a `pHYs` chunk, plus manifest and README.
   - Sublimation ZIP: every piece with fabric, bleed and an optional cut line.
   - Spec sheet: pdf-lib, standard fonts (WinAnsi only; other characters print as "?").
   - Turntable video: WebCodecs via mediabunny, MP4/H.264 where available, otherwise WebM VP9/VP8.
   - `POST /exports` records client exports for the monthly quota. Server-side exports answer `501` until a CPU export worker exists.

10. **Gobo on the backdrop only, also in final renders,** so the final image matches the live preview the user composed (ADR-0018 §3). A real light-blocking gobo is a later enhancement.

11. **Live events** go through Redis pub/sub to a plain WebSocket at `/v1/ws`. The first message authenticates (5 s limit). Events: `render.progress`, `render.finished` and `project.updated` (every pushed revision, for Stage 8 sync).

## Consequences
- **Local renders take minutes on modest GPUs** (measured: about 1.4 s per sample at 2000 × 2500 on a Quadro T1000, so Draft ≈ 3.5 min and Good ≈ 12 min). Cloud rendering on proper GPUs is the fast path.
- The path-tracing E2E test needs a GPU and runs in Chromium on Windows with ANGLE/D3D11. CI without a GPU skips it, and the API's render-worker tests cover the same pipeline with few samples.
