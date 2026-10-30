# Stage 5 Report: 3D Engine

- **Status:** awaiting approval
- **Date:** 2026-10-30
- **Decisions:** ADR-0018 (amends ADR-0006/0007)

## What was built

### Document model v2 (`packages/core`)
- Fabric, key light and studio scene ("the look") moved **into ProjectDoc** (schema v2, zod-validated), with a **v1 → v2 migration**. Older saved designs open with the factory look.
- Look edits are **undoable**. Rapid changes to the same setting (slider drags) merge into one undo step; time-based, 800 ms.
- Fixed a latent bug: no-op edits created history entries and marked the design unsaved (every edit also stamped `updatedAt`).

### `packages/engine-3d`
- **Garment from the pattern:** front and back bodies plus both sleeves are built from the pattern pieces.
  - Every panel's UVs are its piece's own frame, so `engine-2d`'s `bakePiece` textures land exactly where the artwork sits on the pattern, including **wrap-over-seams** artwork.
  - Sleeves attach through the garment's seam table (armhole ↔ cap).
  - Inside faces show the inside prints.
  - Pillow inflation, folds (wrinkles) and baked edge/fold AO.
- **Materials:** 9 knits with procedurally generated normal maps (jersey, interlock, sport knit, piqué, rib, waffle, fleece, mesh, cotton blend), with roughness, sheen, texture strength, knit size, brightness and contrast.
- **Studio:**
  - Key light (side, height, power) with soft shadows; studio HDRI (generated room environment) with intensity and rotation.
  - Backdrop colour, brightness, contrast and shadow; 8 procedural gobo patterns plus invert.
  - Hanger and colour; neck label (5 shapes, colour); neck rib.
- **Turntable rig:** the lights and backdrop follow the camera, so Back and Side are lit like the front.
- **Camera:** orbit and zoom, Front/Back/Side animated presets, Reset view, auto-rotate.
- **Quality:** Adaptive (half resolution while dragging) / Full / Half / Quarter.
- **3D snapshot:** a PNG at 2400 px on the long side, from the header and the export menu.

### Editor integration
- The 3D view replaces the placeholder. Textures are **re-baked only for pieces whose inputs changed**, throttled to 120 ms (250 ms during drags). Edits show up live.
- three.js is lazy-loaded in its own chunk (main editor chunk 109 kB; three.js 574 kB / 142 kB gzip, only when the 3D view opens).
- The garment picker shows the development tee (marked **Dev**) with a note about the catalogue.
- Robustness: WebGL failure shows a message; a failed bake never takes the editor down; a root error screen replaces any blank page.

## Measured and fixed during Stage 5

| # | Finding | How found | Fix |
|---|---|---|---|
| 1 | Navy fabric rendered light blue: the projected gobo spotlight lit the garment (centre (104,128,181) vs fabric (38,54,90)) | Pixel measurement while toggling lights | Gobo became a backdrop-only shadow overlay; lights rebalanced → (41,58,100) |
| 2 | Back view dark, with no backdrop | Browser | Turntable rig |
| 3 | Back panel and one sleeve per side facing inward (prints hidden) | Browser, then a unit test | Winding accounts for view mirroring and reflecting maps; face-orientation unit test |
| 4 | Clamped-texture fringe past the seams | Review of the UV contract | Outline-snapped vertices (UVs in [0, 1]); unit test |
| 5 | Camera never refitted after the garment loaded or on resize | Browser | Fit keeps direction and applies distance |
| 6 | **WebKit: the whole editor blank** (`OffscreenCanvas` missing in that build) | WebKit E2E | Canvas fallback; bake errors contained; root error screen |
| 7 | Garment pill `aria-label` didn't contain its visible text | axe (Firefox) | Visible text is the name |
| 8 | `PCFSoftShadowMap` removed in three r186 | Console warning | `PCFShadowMap` |

## Verification

| Check | Result |
|---|---|
| Typecheck (6 packages + e2e) | ✅ 0 errors |
| Unit tests | ✅ **81 / 81**: core 15, engine-2d 26, **engine-3d 11** (geometry, UV range, face orientation, seam meeting, sleeve attachment, AO/folds, helpers), ui 6, editor 23 |
| E2E (Chromium / Firefox / WebKit), incl. **6 new 3D tests** | ✅ **96 passed**, 6 skipped (visual baselines are Chromium-only). Chromium 34/34 in two consecutive runs; Firefox 31 + 3 skipped; WebKit 31 + 3 skipped |
| Build | ✅ |

**New 3D E2E tests:**
- renders with colour fidelity (navy within tolerance)
- a 2D rectangle appears on the 3D chest
- Back / Side / Reset camera presets
- the quality setting halves the pixel ratio
- the snapshot downloads a real PNG over 20 kB
- hanger/label toggles undo

The 3D canvas is masked in pixel baselines because GPU/software rasterisation varies.

## Not done / limitations (transparent)
- **Real garments:** only the procedural development tee. The engine's UV contract is ready for CLO3D / Marvelous Designer exports, but **no garment assets exist yet**.
  - The reference's 28 models are proprietary and are not used (ADR-0002/0007).
  - The **garment-tools CLI** (DXF-AAMA + GLB import) is deferred until the first real files arrive, so it can be verified honestly.
- Gobo light falls on the backdrop only, not on the garment (that comes with the path tracer in Stage 7).
- The procedural tee is a flat lay; draped and on-body poses need real simulated meshes.
- Texture baking runs on the main thread (2 px/mm preview); a worker is deferred until profiling shows a need (Stage 12).
- The heaviest E2E test (32 pointer moves with live 3D re-render in software WebGL) is marked `test.slow()`.
