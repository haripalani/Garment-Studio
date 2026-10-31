# Stage 7 Report: Rendering and Export

- **Status:** awaiting approval
- **Date:** 2026-10-31
- **Decisions:** ADR-0020 (amends ADR-0013)

## What was built

### Final renders: path tracing (`packages/engine-3d`)
- **Engine:** progressive path tracing of the live studio scene with three-gpu-pathtracer (MIT, WebGL 2). It covers fabric, prints, sheen and normal maps, the key light, studio environment light, soft-contact shadows, the backdrop with gobo pattern, the hanger and the label.
- **Render plans per quality:** draft 150 / good 500 / high 1000 / max 1500 samples. Large frames render in tiles. High and max use 2048 px textures and, above 2000 px, prints baked at 4 px/mm.
- **Framing:**
  - "As in 3D preview": the current view, re-fitted to the output aspect.
  - Front, back and side: the whole garment, framed for any size.
  - Cloud jobs carry the exact camera (orbit).
- **Transparent background:** the backdrop is removed; the studio light is kept.

### Render dialog (editor)
- **Preview:** a live path-traced frame preview (48 samples) that updates when size, frame or background changes.
- **Local render** at any listed size (up to 3840 px):
  - progress bar with passes done and time left
  - cancel
  - "preparing the renderer" notice while the shader compiles
  - Save PNG / Save WebP (if the browser can't write WebP, a PNG is saved instead and you're told so)
- **Cloud render** is wired in the API but disabled in the editor until signing in arrives (Stage 8). The button explains this.

### Exports (editor, built in the browser, work offline)
- **Print files (ZIP):** one PNG per printed piece side, at real size (150 or 300 DPI, written into the file's `pHYs` chunk), on a transparent background with selectable bleed. Also a `manifest.json` (piece, side, mm and px) and a README.
- **Sublimation panels (ZIP):** every pattern piece as a full panel (fabric colour or gradient plus artwork) with bleed and an optional cut line. Pieces cut more than once get one file per copy.
- **Spec sheet (PDF):**
  - page 1: front and back views, garment, fabric and summary
  - placements table: piece, side, position, size and rotation in mm, cm or in, with font, colour or image details
  - printed-piece previews
- **Turntable video:** one full turn at 30 fps, 1080 × 1080 / 1080 × 1920 / 1920 × 1080, 4–20 s. MP4 (H.264) where the browser can encode it, otherwise WebM (VP9 or VP8). Cancellable.
- **Loading:** export and render code loads on demand. The editor's main bundle stays at 113 kB, against 109 kB in Stage 5 and 779 kB before splitting.

### Cloud rendering (`apps/api`, ADR-0013 / 0020)
- **API:**
  - `POST /renders` is idempotent and checks the plan's size, quality and monthly quota (in-flight jobs count; render credits cover overflow).
  - Also: list (cursor, project filter), get (outputs with short-lived URLs), cancel (queued or running), retry (a new job).
- **Render worker** (`dist/render-worker.js`, separate process):
  - BullMQ consumer, one job per GPU.
  - Runs the **editor's own render page** in headless Chromium on the GPU, so local and cloud renders use the same code.
  - Uploads PNG/WebP as render assets.
  - Charges exactly once on success (ledger key `render:{jobId}`, credit when over quota); cancelled and failed jobs are free.
  - Retries with backoff; timeout scales with size × samples.
  - Persistent shader cache and a warm-up render before taking jobs.
- **Live events:** WebSocket `/v1/ws` (authenticated by the first message; Redis pub/sub across processes): `render.progress`, `render.finished`, `project.updated` (every pushed revision, for Stage 8 sync).
- **Export records:** `POST /exports` counts client exports against the monthly quota (export credits cover overflow, idempotent). `GET /exports/{id}`. Server-side exports answer 501.
- **Database:** migration `0002_render_outputs` adds render outputs and the retry link.

## Measured and fixed during Stage 7

| # | Finding | How found | Fix |
|---|---|---|---|
| 1 | **Sublimation/bleed output erased the piece**, leaving only the bleed band (two `destination-in` passes kept their intersection). A latent Stage 4 bug, first exercised by real exports | Browser, pixel check | One combined mask; E2E pixel regression test |
| 2 | Path-traced garment covered in speckle; light and shadow leaked through the fabric (inside and outside faces were coincident surfaces) | Browser, side-by-side with the raster view | Inside face 0.4 mm behind the outside face |
| 3 | Path-traced shadows pure black and image 30% too dark: the environment map lived in another WebGL context | Pixel means vs the raster view | CPU equirect environment for the path tracer |
| 4 | Spec sheet and video frames too dark (same cross-context cause) | PDF in the browser | Each off-screen renderer builds its own environment |
| 5 | Renders ~9× slower in a background pane (rAF throttling) | Timing: 65 s → 7 s for the same render | GPU-synced 30 ms slices, `MessageChannel` yields |
| 6 | Path-traced image came back blank (GPU context released before reading) | Pixel stats | Result copied to a 2D canvas first |
| 7 | Cloud worker took ~60 s per job (shader compile in a fresh profile; software GL by default) | API test timing | Persistent profile, warm-up render, GPU flags. Jobs ~2 s after warm-up |
| 8 | Editor main bundle grew to 779 kB (PDF, video and path tracer loaded at start-up) | Build output | Loaded on demand; back to 113 kB |
| 9 | Spec-sheet summary ran off the page | PDF in the browser | Stacked layout |
| 10 | Clicking "Render" right after changing the size could be cancelled by the scheduled frame preview | Full E2E run (Chromium) | A running render owns the canvas; pending previews are dropped |
| 11 | The dev server found the on-demand libraries late, re-optimised and reloaded every open page (broke unrelated E2E tests mid-step) | Full E2E run | Pre-bundled in `optimizeDeps` |

**Path tracer vs live view:** at 2000 × 2500, the brightness of the path-traced front view is within about 6% of the rasterised live view (mean 192 vs 205; the path tracer adds real interreflection and soft contact shadows).

## Verification

| Check | Result |
|---|---|
| Typecheck (7 packages, editor E2E, API tests) | ✅ 0 errors |
| OpenAPI (Redocly) | ✅ valid, 0 warnings |
| Unit | ✅ **96**: core 16, engine-2d 26, **engine-3d 15** (+4 render plan and framing), ui 6, **editor 29** (+6 PNG DPI, print targets, durations) |
| API (real Postgres/Redis/S3/SMTP/ClamAV, **GPU render worker in headless Chromium**) | ✅ **84 / 84**, every response contract-checked. All 53 HTTP operations exercised (109 operation + status pairs); the WebSocket is tested separately |
| Editor E2E (Chromium / Firefox / WebKit) | ✅ **109 passed**, 8 skipped by design (visual baselines Chromium-only ×6, GPU render in Firefox/WebKit ×2), 18.3 min. Clean after the stability fixes (#10–11 and isolating the heavy tests); the three full runs before them had 3, 2 and 1 load timeouts |
| Builds (editor incl. `render.html`; API and worker bundles) | ✅ |

**New tests:**
- **API (9):**
  - an end-to-end cloud render: PNG size and real content, WebP header, opaque corner, progress and finished events, charged once
  - a transparent "preview" render with camera (corner alpha 0)
  - cancel queued plus retry; cancel running between samples
  - list and pagination; plan size, quality and quota limits with credits
  - missing project or revision
  - export quota with credits and idempotency
  - WebSocket auth timeout, bad token, ping, and `project.updated`
- **E2E (5):**
  - print ZIP (DPI in every file, real size, manifest)
  - sublimation ZIP with a pixel check (fabric fill, transparent outside)
  - spec PDF (3 pages, title)
  - turntable video (MP4 or WebM header; a clear message where encoding is impossible)
  - path-traced preview plus local render plus Save PNG (Chromium with GPU)

## Not done / limitations (transparent)
- **Cloud render from the editor** waits for sign-in (Stage 8). The pipeline is built and tested through the API and the worker.
- **Render speed on modest GPUs:** about 1.4 s per sample at 2000 × 2500 on a Quadro T1000, so Draft ≈ 3.5 min and Good ≈ 12 min locally. The first render of a session also waits for the shader compile (up to about a minute on Windows). No denoiser yet.
- **Linux GPU workers:** the GPU flag for Linux NVIDIA nodes (`--use-angle=vulkan` expected) is not yet validated; staging, Stage 8. Without it, Chromium silently uses software rendering. The worker logs the GPU so this is visible.
- **Path-tracing E2E** needs a GPU: it runs in Chromium on Windows and is skipped in Firefox and WebKit (software WebGL compiles the shader too slowly). The API worker tests cover the same pipeline.
- **Gobo:** light pattern on the backdrop only, in final renders too (matches the live preview); a real light-blocking gobo is a later enhancement.
- **Watermark** for plans with `watermark: true` is not applied yet: the editor has no plan context until sign-in (Stage 8).
- **Spec sheet** uses standard PDF fonts (Latin only; other characters print as "?").
- **Print files:** one PNG per piece side at piece size (artwork placed as on the piece); artwork-trimmed files are a possible addition.
- **Very large exports:** 300 DPI front panels are about 50 MP canvases, fine in Chrome, Firefox and Safari on desktop but beyond mobile browser canvas limits.
- **Server-side exports** (`ranOn: server`) answer 501.
- **Video in WebKit:** Playwright's WebKit build on Windows has no WebCodecs, so the video export shows "this browser cannot encode video" there. Measured: Chromium and Firefox (headless) both encode H.264 and produce MP4. Real Safari has WebCodecs, but it isn't verified here.
- **One unit-test flake:** one engine-3d test failed once under heavy parallel load (three E2E browsers running); it didn't recur in four reruns, three of them under the same load.
- Heavy E2E projects depend on the interaction tests: if one of those fails, Playwright skips the export tests in that run.
- Nothing from Stage 7 is committed yet.
