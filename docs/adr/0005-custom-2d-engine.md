# ADR-0005: Custom Canvas2D pattern engine (not Fabric.js or Konva)

- **Status:** Accepted · 2026-10-30

## Context
Requirements: millimetre-accurate piece frames; artwork clipped to piece outlines; moving artwork between pieces; outside/inside sides; **wrap over seams** (overflow continues on the neighbouring piece through a seam transform); bleed; and the **same drawing** used for the on-screen view, the 3D textures and 300 DPI print/sublimation files rendered inside a worker.

## Options
| | Fabric.js | Konva | Custom |
|---|---|---|---|
| Object model | its own (duplicates ProjectDoc) | its own | ProjectDoc is the model |
| Bakes inside an OffscreenCanvas worker | awkward | partial | by design |
| Seam-wrap clip transforms | custom anyway | custom anyway | native |
| Bundle size | ~300 KB | ~150 KB | ~30–50 KB |

## Decision
`packages/engine-2d`:
- `render(doc, garment, view, ctx)`: a pure function drawing to any 2D context (screen, OffscreenCanvas, print).
- `bakePiece(pieceId, side, dpi, { bleedMm })` runs in a Web Worker and returns an ImageBitmap (for 3D) or a Blob (for export).
- `hitTest` plus interaction controllers (select, move, scale, rotate, crop, draw-shape, pan, zoom) that emit **commands** and never mutate the document directly.
- Text via loaded FontFaces; vector export via opentype.js glyph paths.
- Image adjustments (invert, hue, saturation, fill) are per-pixel passes cached by (assetId, params) hash.

## Consequences
We own hit-testing and handles (about 1–2 weeks), and get exact parity between screen, 3D and print. Engine tests are golden-image comparisons at fixed DPI.
