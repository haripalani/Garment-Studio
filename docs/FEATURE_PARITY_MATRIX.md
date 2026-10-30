# Feature Parity Matrix

Status values: **Implemented and verified** · **Implemented but not verified** · **Partially implemented** · **Not implemented** · **Inaccessible in reference** · **Not applicable**.
IDs map to FEATURE_INVENTORY.md. Nothing is built yet (Stage 1), so every accessible feature is *Not implemented*. Target stage in brackets.

| ID | Feature | Reference access | Status | Stage |
|---|---|---|---|---|
| A1 | View modes pattern/split/3D | Observed | **Implemented and verified** (tests + browser) | 3 |
| A2 | Light/dark theme | Observed | **Implemented and verified** | 3 |
| A3 | i18n EN/FR/ZH/RU | Present | Partially implemented (EN; keys in place) | 3 (EN) / later |
| A4 | Quick tour | Observed | **Implemented and verified** | 3 |
| A5 | Undo/redo | Observed | **Implemented and verified** (patch history, gestures = 1 step) | 4 |
| A6 | New design | Present | **Implemented and verified** (local; cloud projects in 8) | 4 |
| A7 | Project browser | **Inaccessible** (login) | Not implemented, independent design | 8 |
| A8 | Save project (cloud) | **Inaccessible** (login) | Partially implemented: API **verified** (versions, optimistic concurrency, trash, duplicate); editor wiring in Stage 8 | 6/8 |
| A9 | 3D snapshot | Present | Not implemented | 5 |
| A10 | Export menu | Observed | Not implemented | 7 |
| A11 | Auth modal (password, magic link, reset, sign-up) | UI observed, flow inaccessible | Partially implemented: modal UI (Stage 3) + API flows **verified** (Stage 6); modal→API wiring in Stage 8; Google/Apple need credentials | 6/8 |
| A14 | Mobile gate | Observed | Not implemented (we'll offer a viewer mode instead) | 9 |
| B1–B7 | Pattern pieces, sides, rulers, units, cursor read-out, zoom, markings | Observed | **Implemented and verified** on the development garment (real garments: Stage 5) | 4 |
| B8–B10 | Tools, shapes, transform handles | Observed | **Implemented and verified** (manipulation maths unit-tested; handles checked in browser) | 4 |
| B11 | Move between pieces | Observed | **Implemented and verified** | 4 |
| B12–B13 | Paste / drag-drop images | Present / inferred | Drop: **verified**. Clipboard paste: implemented but not verified (needs a real OS clipboard) | 4 |
| C1–C9 | Layers, transform, align, mirror/copy/delete, presets | Observed | **Implemented and verified** | 4 |
| C10 | Wrap over seams + bleed | Observed | 2D: **implemented and verified**. Bleed is stored and used by `bakePiece`; the print output is verified in Stage 7 | 4 (2D) / 5 (3D) |
| C11 | Multi-select / grouping | Not present in reference | Not applicable (candidate enhancement) | – |
| D1–D6 | Image upload, invert, crop/trim, hue/sat, fill, reset | Observed | **Implemented and verified** (pixel ops unit-tested; crop/trim in browser) | 4 |
| D7 | Vector (SVG/PDF/AI) print pass-through | Inferred | SVG upload works (drawn as an image); vector print pass-through not implemented; PDF/AI not accepted yet | 7 |
| E1–E7 | Text properties | Observed | **Implemented**: text, 18 fonts, weight, B/I/AA, align, line height, letter spacing, solid/gradient. Verified in browser except per-font rendering of every family | 4 |
| F1–F4 | Shape kinds, gradient editor, outline, dashed | Observed | **Implemented and verified** (gradient editor: add/move/remove stops, linear/radial, angle) | 4 |
| G1–G2 | Fabric colour / gradient | Observed | **Implemented and verified** (2D + 3D, colour-fidelity E2E) | 5 |
| G3 | 9 knit materials | Observed | **Implemented** (procedural normal maps); visual quality to be reviewed on real garments | 5 |
| G4–G7 | AO, wrinkles, texture, knit size, brightness, contrast | Observed | **Implemented**; AO/fold geometry unit-tested | 5 |
| G8 | Key light | Observed | **Implemented** (side, height, power, soft shadow) | 5 |
| G9 | Look defaults (save/reset/factory) | Observed | **Implemented and verified** (stored on device) | 3 |
| H1–H3 | Camera, presets, quality, auto-rotate | Observed | **Implemented and verified** (E2E) | 5 |
| H4 | Garment catalogue (28 models) | Observed; **assets proprietary, not reused** | Partially implemented: picker UI, catalogue API (public, cacheable) and the procedural development tee; real garments need our own or licensed models (D2) | 5+ |
| H5–H10 | HDRI, backdrop, gobos (30), hanger, neck label, markings | Observed | **Implemented**: generated HDRI, backdrop, 8 procedural gobos (reference: 30), hanger, 5 label shapes, markings | 5 |
| I1 | Catalogue render dialog | UI observed | Not implemented | 7 |
| I2 | Cloud / local render execution | **Inaccessible** (plan) | Not implemented, independent design | 7 |
| I3 | Save PNG / WebP / transparent | UI observed | Not implemented | 7 |
| I4 | Print files ZIP | Present, not run | Not implemented; output format to be specified by us | 7 |
| I5 | Sublimation panels ZIP | Present, not run | Not implemented | 7 |
| I6 | Spec sheet PDF | Present, not run | Not implemented; layout to be designed by us | 7 |
| I7 | Turntable video | Present, not run | Not implemented | 7 |
| I8 | Watermark (Free) | Inferred | Not implemented (depends on D3) | 7 |
| J1 | Account auth flows | **Inaccessible** | API **implemented and verified**, independent design (password, magic link, verify, reset, sessions, desktop PKCE, deletion, data export). OAuth providers: not configured | 6 |
| J2–J5 | Plans, packs, quotas, grace | Inferred from public config | Partially implemented: entitlements engine, plans as data, quotas (402), credits, signed offline snapshot **verified**; prices/provider depend on D3 | 6+ |
| – | Cloud sync across devices | Inaccessible in reference | Not implemented (new requirement) | 8 |
| – | Offline editing, PWA install | Not offered by reference | Not implemented (new requirement) | 9 |
| – | Desktop app (Win/macOS) | Not offered by reference | Not implemented (new requirement) | 10 |
