# ADR-0006: three.js via React Three Fiber; a shared path tracer for renders

- **Status:** Accepted · 2026-10-30

## Decision
- `packages/engine-3d` on three.js (pinned minor) + React Three Fiber + drei.
- Real-time look: MeshPhysicalMaterial (sheen for knits), per-garment normal and knit-mask maps, tiling knit/wrinkle normal maps per material, N8AO ambient occlusion (the "fold shadows" toggle), PMREM'd HDRI with intensity and rotation, a shadow-catching backdrop, a gobo light (SpotLight with a projected texture map), and hanger and neck-label meshes.
- Textures: one texture per **piece × side**, fed by the engine-2d bake worker. Only dirty pieces re-upload, with no scene rebuild.
- Adaptive quality: DPR 0.5× while interacting, full when idle; fixed Full / Half / Quarter options.
- Catalogue render: **three-gpu-pathtracer**, progressive samples (Draft 150 / Good 500 / High 1000 / Max 1500), optional transparent background. The **identical bundle** runs headless in the cloud worker (ADR-0013).
- Turntable video: frames from a render target → WebCodecs → MP4 via mp4-muxer, with an ffmpeg server fallback.

## Consequences
Real-time and catalogue renders share materials and lights. Local path-trace speed depends on the user's GPU; the cloud is the fallback.
