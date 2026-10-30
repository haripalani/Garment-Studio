# ADR-0018: 3D studio implementation choices (amends ADR-0006 and ADR-0007)

- **Status:** Accepted · 2026-10-30 (Stage 5)

## Context
ADR-0006 proposed React Three Fiber and a SpotLight-projected gobo. ADR-0007 called for a procedural fallback garment until real assets exist. Building and measuring Stage 5 changed four details.

## Decisions

1. **Imperative three.js `Studio` class instead of React Three Fiber.** The same class must run headless in the render worker (ADR-0013), where React is unwanted. Per-piece texture updates are imperative anyway. React integration is one small component (`ViewerCanvas`).

2. **Turntable rig.** The key light, backdrop, gobo and HDRI rotation follow the camera's azimuth. Turning the view behaves like turning the garment on a turntable, so any angle (Back, Side) is lit and backed like the front, which is what product photography needs. With world-fixed lights the back view was dark and had no backdrop (found in the browser).

3. **Gobo as a backdrop shadow overlay, not a projected SpotLight.** Measured in the browser: the projected spotlight was the dominant light on the *garment* (centre pixel (104,128,181) for navy (38,54,90)). With it removed, the garment rendered at (41,58,100), true to the fabric colour. The pattern now only darkens the backdrop. Contrast controls its strength and Invert swaps light and shadow.

4. **Procedural flat-lay tee from the pattern (ADR-0007 fallback) with a hard UV contract.**
   - Each 3D panel's UVs are its pattern piece's own frame, so engine-2d's `bakePiece` output maps 1:1.
   - Sleeves attach through the garment's seam table (armhole chord ↔ cap chord, an affine map).
   - Inside faces use the inside bake, flipped to the outside frame.
   - Outline-snapped vertices keep the UVs in [0, 1] (no clamped-edge fringe).
   - Winding accounts for view mirroring and reflecting maps; unit tests check face orientation.
   - Real CLO3D/MD meshes must honour the same contract (UV islands = pieces), and the `Studio` swaps geometry without other changes.

5. **Texture baking on the main thread for now** (2 px/mm preview, throttled to 120 ms, re-baking only pieces whose inputs changed). Moving the bake to a worker (ADR-0005) is deferred until profiling shows a need. Measuring that is part of the Stage 12 performance work.

## Consequences
- The 3D view is colour-accurate and consistent from every angle.
- Gobo light on the garment itself (dappled light) is not simulated; it can return in the path tracer (Stage 7), where it is physically correct.
- The garment-tools CLI (DXF-AAMA + GLB import) waits for the first real garment files; without sample assets it cannot be built and verified honestly.
