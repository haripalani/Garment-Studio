# Stage 4 Report: 2D Pattern Editor

- **Status:** awaiting approval
- **Date:** 2026-10-30
- **Screenshots:** `docs/screenshots/stage4-*`

## What was built

### `packages/core`
- **Geometry:** affine matrices, similarity transforms between segments, polygon tests, Bézier sampling
- **GarmentModel types** (pieces in mm, seams as sewn chord pairs, placement presets) and a **procedural development tee** (`createDevTee`):
  - 6 outside pieces (front, back, 2 sleeves, 2 neck ribs)
  - 9 inside pieces (front, back, 2 sleeves, label, 2 hem facings, 2 sleeve hem facings)
  - 8 seams; 9 placement presets
  - Marked `dev: true`; real garments replace it in Stage 5 (ADR-0007).
- **ProjectDoc v1** as zod schemas (image, text and shape layers; solid/linear/radial paints with ≤5 stops; crop; colour adjustments; wrap and bleed; content-addressed asset refs), with factories and `parseDoc`.

### `packages/engine-2d` (ADR-0005: custom Canvas2D engine)
- **View:** sheet mm ↔ screen px (3.75 px/cm at 100 %, like the reference), zoom-about-cursor, fit-to-sheet with UI insets.
- **Layout:** piece frames per side (inside faces mirrored); layer → piece → sheet transforms; piece and layer hit-testing; re-parenting that keeps the sheet position.
- **Wrap over seams:** a similarity transform per sewn chord in both directions, so artwork crossing a seam continues on the neighbouring piece (front ↔ back over shoulders and sides, armholes ↔ sleeve caps).
- **Drawing:** shapes (8 kinds, fill/outline/dashed), text (multi-line, letter spacing, line height, alignment, caps, italic, weight, gradient fill, scaled to its box), images (crop, mirror, invert, hue, saturation, fill colour; cached processing).
- **Renderers:** sheet (dots, fabric fill/gradient, clipping, centre-line markings, labels with real dimensions in the current unit), selection (overflow ghost, handles, rotate handle, size badge), crop overlay, shape draft, rulers in mm/cm/in with a cursor marker.
- **`bakePiece`:** renders any piece at any resolution with optional bleed, using the same draw code. This feeds the 3D textures (Stage 5) and print files (Stage 7).
- **Manipulation maths (pure, unit-tested):** scale from a corner (uniform or free), rotate with snapping, align to the piece, crop edges, pan under crop, trim and reset crop at a constant physical scale, preset placement.

### `apps/editor`
- **Document store:** Immer patches with undo/redo (200 steps). Drags, slider moves and typing each become **one** undo step (transactions); Escape cancels a gesture.
- **Assets:** type and size validation, SHA-256 content addressing (duplicates are stored once), originals kept in IndexedDB for print, downscaled display copies, SVG supported.
- **Autosave:** the working design is saved to IndexedDB 0.8 s after each change and on page hide, then restored on load (schema-validated; an unreadable copy is kept for recovery, not overwritten). The save state shows in the header.
- **Pattern canvas:**
  - select / move / scale / rotate, with moves crossing pieces
  - hand tool, Space-drag and middle-drag to pan; wheel to zoom
  - draw shapes (Shift keeps proportions); click to place text; image tool opens the file picker
  - drop image files on a piece
  - double-click: edit text, or toggle crop for images
  - cursor read-out "Piece · x × y"
- **Selected-item panel** (floats over the 3D stage in split view, like the reference):
  - text: text, font, weight, B/I/AA, alignment, line height, letter spacing, colour or gradient
  - shape: kind, colour or gradient, outline only, dashed, thickness
  - image: mirror, invert, crop (trim / reset / done), hue, saturation, fill colour, reset colours
  - all layers: copy, delete, wrap over seams with info and bleed, 9 placement presets
- **Inspector:**
  - Artwork buttons work; the subtitle shows the selected layer's name
  - Transform: width/height in the current unit, rotation, opacity, ±90°, align ×6
  - Layers: thumbnails, visibility, drag or Alt+↑/↓ to reorder, double-click to rename, type · side · "wraps seams"
- **Keyboard:**

  | Keys | Action |
  |---|---|
  | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | Undo / redo |
  | Ctrl+C / Ctrl+V | Copy / paste a layer (Ctrl+V also pastes an image from the clipboard) |
  | Ctrl+D | Duplicate |
  | Delete | Delete layer |
  | Arrows (Shift = 10 mm) | Nudge 1 mm |
  | Tab / Shift+Tab | Cycle layers |
  | `[` / `]` | Move down / up the stack |
  | Shift+R | Rotate 15° |
  | V / H / T / I / R / O / L | Tools: select, hand, text, image, rectangle, circle, line |
  | Ctrl+0 | Fit |
  | Esc | Cancel / leave crop / deselect |

- **Header:** live undo/redo, and New design (with confirmation).
- **Fonts:** 18 OFL families, self-hosted and lazy-loaded (Inter, Montserrat, Rubik, Roboto Condensed, Oswald, Bebas Neue, Anton, Archivo Black, Unbounded, Space Mono, Press Start 2P, Playfair Display, Cormorant Garamond, Permanent Marker, Caveat, Lobster, Pacifico, UnifrakturMaguntia).

## Verification

| Check | Result |
|---|---|
| `tsc`, 5 packages | ✅ 0 errors |
| Vitest | ✅ **66 / 66**: core 13, engine-2d 26, ui 6, editor 21 |
| `vite build` | ✅ editor chunk 241 kB (76 kB gzip); the largest vendor chunk is still react, 219 kB |
| Browser (Chromium, 1440×900) | ✅ See below |

### Checked in the browser
- add text and type → the box refits; panel and transform update
- move across pieces → re-parented to the back
- draw a rectangle across the front side seam with wrap on → the overflow appears on the back's side edge
- drop a PNG on a sleeve → crop mode → trim empty edges (width 5.10 → 2.29 in, as expected for the test image)
- "Printed label" preset → moved to the inside back, and the view switched to Inside (9 pieces)
- the undo chain steps back through placement, trim, add and wrap; redo works
- reload → the design is restored from IndexedDB; New design clears it
- gradient editor on a shape
- an error hook during a batch of interactions recorded no errors

### Bugs found and fixed during verification
1. Sleeve labels overlapped the body pieces. The development layout spacing is now increased.
2. New text was white on light fabric and invisible. New text and shapes now take a contrasting ink.
3. The floating panel covered the pattern in split view. It now floats over the 3D stage, as in the reference.
4. The panel's colour row overflowed.
5. The shortcut handler crashed on key events targeting `window` (a non-element); guarded.
6. A press-release without intermediate pointer moves didn't apply the final position; the release position is now applied too.

## Not done / known limitations (transparent)
- ~~Playwright E2E and visual baselines~~ **done after approval**: see TEST_REPORT.md (Chromium, Firefox, WebKit; axe accessibility).
- ~~Firefox and Safari not tested~~ Firefox and WebKit are now covered by E2E (see TEST_REPORT.md).
- OS clipboard image paste is implemented but not verified (it needs a real clipboard). Drag-and-drop is verified.
- Pieces come from the **development garment**; real garment patterns arrive with the asset pipeline (Stage 5).
- Fabric, light and scene settings still live in the "look" store. They move into ProjectDoc in Stage 5, when the 3D view consumes them.
- PDF/AI uploads are not accepted yet; SVG is drawn as an image (vector print pass-through is Stage 7).
- No snapping or alignment guides (not observed in the reference).
- Undo history is per session (not persisted across reloads); the document itself is persisted.
